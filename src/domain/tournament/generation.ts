import { emptySchedule } from './empty-schedule';
import { parseEliminationTargets } from './elimination-targets';
import { seedFromGroupStageRound } from './pooling';
import { validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { randomSeed, recordRoomHistory } from './seeding';
import { buildScheduleRounds } from './schedule-generation';
import { planTournament } from './generation-plan';
import type { GenerationForm } from './generation-plan-types';
import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { settingsFromForm } from './tournament-settings';
import type { TournamentRuntime } from './runtime';
import type { MaterializedGamemodeConfig, TournamentState } from './types';

type GenerateTournamentResult =
  { status: 'generated'; state: TournamentState } | { status: 'invalid'; message: string };

function generationError(message: string): GenerateTournamentResult {
  return { status: 'invalid', message };
}

export function generateTournament(
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): GenerateTournamentResult {
  const planned = planTournament(form, current);
  if (!planned.ok) return generationError(planned.message);
  const {
    format,
    chosen,
    schedule,
    unitPlural,
    matchConfig,
    config,
    oddCountStrategy,
    roomSize,
    layeredPlay,
    qualRounds,
    swissRounds,
    nonCountingRounds,
    bracketEntryCount,
    waterfallGraph,
    positionalPointsTable,
    matchResults,
    semisOverride,
    finalOverride,
    semisDefault,
    grandFinalWbTarget,
    grandFinalLbTarget,
    prospectiveFinalSize,
    lbQualifiers,
    winnersQualifiers,
  } = planned.plan;

  // Elimination round-target override: an ordered list of exact survivor
  // counts, replacing the automatic geometric-decay curve entirely for the
  // WB elimination rounds leading into Semis (single-elimination) / the
  // shared Final (double-elimination-shared-final). Its own length is the
  // round-count override for these two formats -- no separate field needed.
  const usesEliminationTargetOverrides =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final';
  const parsedTargets = parseEliminationTargets(form.eliminationRoundTargets, {
    schedule,
    bracketEntryCount,
    entryLabel:
      config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `registered ${unitPlural}`,
    semisSize: semisOverride || semisDefault,
    winnersQualifiers: winnersQualifiers ?? 0,
    finalSize: prospectiveFinalSize,
    lbQualifiers: lbQualifiers ?? 0,
  });
  if (!parsedTargets.ok) return generationError(parsedTargets.error);
  const explicitTargets = parsedTargets.values;

  // Elimination seeding-weight override: an ordered list of fixed reseed
  // modes, index-aligned with eliminationRoundTargets -- only meaningful
  // once that list pins down which round is which, since round identity
  // doesn't exist before generation otherwise.
  let explicitSeedingOverrides: Array<'diversity' | 'balance' | 'random' | undefined> | undefined;
  if (form.eliminationSeedingOverrides.trim() && usesEliminationTargetOverrides) {
    if (!explicitTargets) {
      return generationError(
        'Elimination seeding overrides require elimination round targets to also be set — seeding-override positions are addressed by that same ordered round list.',
      );
    }
    const parts = form.eliminationSeedingOverrides.split(',').map((part) => part.trim());
    if (parts.length !== explicitTargets.length) {
      return generationError(
        `Elimination seeding overrides (${parts.length} entries) must have exactly as many entries as elimination round targets (${explicitTargets.length}) — leave an entry blank to keep that round's reseed automatic.`,
      );
    }
    const validModes = new Set(['', 'diversity', 'balance', 'random']);
    if (parts.some((part) => !validModes.has(part))) {
      return generationError(
        `Each elimination seeding override must be blank (automatic), "diversity", "balance", or "random" — got "${form.eliminationSeedingOverrides}".`,
      );
    }
    explicitSeedingOverrides = parts.map((part) =>
      part === '' ? undefined : (part as 'diversity' | 'balance' | 'random'),
    );
  }

  const gamemodeConfig: MaterializedGamemodeConfig = {
    qualRounds,
    swissRounds,
    nonCountingRounds,
    teamScoringRule: format.teamSize ? form.teamScoringRule || 'sum-members' : 'sum-members',
    ...(oddCountStrategy ? { oddCountStrategy } : {}),
    roomSize,
    semisSize: semisOverride || semisDefault,
    finalSize: finalOverride || roomSize.ideal,
    scoring: config.scoring,
    ...(positionalPointsTable !== undefined ? { positionalPointsTable } : {}),
    ...(matchResults ? { matchResultPoints: matchResults.points, tieMargin: matchResults.tieMargin } : {}),
    pointsVersion: 2,
    cutVersion: 2,
    groupAverageVersion: 2,
    absenceVersion: 4,
    vacantSlotVersion: 1,
    dependencyPlayVersion: 1,
    ...(chosen === 'upper-lower' ? { upperLowerVersion: 1 as const } : {}),
    ...(layeredPlay !== undefined ? { layeredVersion: 1 as const, layeredPlay } : {}),
    drawPublication: config.drawPublication,
    ...(lbQualifiers !== undefined ? { lbQualifiers } : {}),
    ...(explicitTargets !== undefined ? { explicitTargets } : {}),
    ...(explicitSeedingOverrides !== undefined ? { explicitSeedingOverrides } : {}),
    ...(waterfallGraph !== undefined ? { graph: waterfallGraph } : {}),
    bracketPhase: schedule,
    ...matchConfig,
    grandFinalWbTarget,
    grandFinalLbTarget,
  };
  const roster = rosterKeys(current.players);
  const progression = buildScheduleRounds({
    bracketPhase: schedule,
    poolingPhase: config.poolingPhase,
    config,
    format: gamemodeConfig,
    roster,
  });
  if (!progression.ok) return generationError(progression.error);
  const roomCapError = validateRoomCap(progression.rounds, format);
  if (roomCapError) return generationError(roomCapError);
  if (matchResults) {
    const longMatch = progression.rounds.find(
      (round) => (round.isGroupStage || round.isQual || round.isSwiss) && (round.bestOf ?? 0) > 3,
    );
    if (longMatch) {
      return generationError(
        `Match results scoring can't score a Best of ${longMatch.bestOf} ${longMatch.isGroupStage ? 'group' : 'pooling'} round yet — use a Best of 3, summed games, or another scoring system.`,
      );
    }
  }

  const groups = progression.groups;
  const groupStandings = Object.fromEntries(
    groups.map((group) => [
      group.label,
      group.members.map((name) => ({
        name,
        totalFP: null,
        totalScore: 0,
        played: 0,
      })),
    ]),
  );
  const {
    scoring: _scoring,
    drawPublication: _drawPublication,
    finalsGames: _finalsGames,
    semisGames: _semisGames,
    ...storedConfig
  } = config;
  const state: TournamentState = {
    ...current,
    ...emptySchedule(),
    rounds: progression.rounds,
    luckyLosers: progression.rounds.map(() => []),
    byes: progression.rounds.map(() => []),
    qualTable: roster.map((name) => ({
      name,
      totalFP: null,
      totalScore: 0,
      played: 0,
    })),
    groups,
    groupStandings,
    gamemodeConfig,
    // Not cleared by a generation (`withoutDrawnSchedule` clears both): the back marks and the Final's aliases stay.
    backFromAbsence: current.backFromAbsence,
    anonymousFinalists: current.anonymousFinalists,
    reserveOpen: true,
    tournamentId: current.tournamentId ?? runtime.ids.tournamentId(),
    cfg: storedConfig,
    scheduleLogic: schedule,
    gameFormat: form.gameFormat,
    settings: settingsFromForm(form),
  };
  const initialPool = rosterKeys(state.players);
  if (gamemodeConfig.drawPublication === 'fixed') {
    state.assignments[0] = state.rounds[0].fixedRoomAssignments ?? [];
    state.byes[0] = state.assignments[0].filter((entry) => entry.room === null).map((entry) => entry.name);
  } else if (config.poolingPhase === 'group-stage') {
    state.assignments[0] = seedFromGroupStageRound(state.rounds[0]);
    state.byes[0] = [...(state.rounds[0].groupByes ?? [])];
  } else if (state.rounds[0].byeCount > 0) {
    const firstBye = initialPool[0];
    state.byes[0] = [firstBye];
    state.poolingByeCounts[firstBye] = 1;
    state.assignments[0] = randomSeed(initialPool.slice(1), state.rounds[0].rooms, runtime.random);
    state.assignments[0].push({
      name: firstBye,
      room: null,
      isLucky: false,
    });
  } else {
    state.assignments[0] = randomSeed(initialPool, state.rounds[0].rooms, runtime.random);
  }
  state.roomHistory = recordRoomHistory(state.roomHistory, state.assignments[0], 0);
  if (gamemodeConfig.drawPublication === 'fixed') {
    // The rest of the fixed schedule (rounds 1+) is already fully decided at
    // this point -- fold it into roomHistory/poolingByeCounts now too, so
    // the live transition OUT of the pooling phase (into the bracket-phase
    // cut round) correctly avoids rematches/repeat-byes against pairs who
    // already played during the fixed rounds. state.assignments itself
    // stays empty for these rounds until actually reached -- see
    // TournamentRound.fixedRoomAssignments and transitions.ts.
    for (const [roundIndex, round] of state.rounds.entries()) {
      if (!round.fixedRoomAssignments) continue;
      for (const entry of round.fixedRoomAssignments) {
        if (entry.room === null) {
          state.poolingByeCounts[entry.name] = (state.poolingByeCounts[entry.name] ?? 0) + 1;
        }
      }
      if (roundIndex > 0) {
        state.roomHistory = recordRoomHistory(state.roomHistory, round.fixedRoomAssignments, roundIndex);
      }
    }
  }
  return { status: 'generated', state: withFinalistAliasesForLineup(state) };
}
