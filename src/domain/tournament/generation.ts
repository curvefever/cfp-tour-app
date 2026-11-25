import { resolveBracketEntryCount } from './bracket-entry';
import { emptySchedule } from './empty-schedule';
import { parseEliminationTargets } from './elimination-targets';
import { seedFromGroupStageRound } from './pooling';
import { MAX_KINGS_VALLEY_ROUNDS, kingsValleyMaxEntrants } from './kings-valley';
import { validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { randomSeed, recordRoomHistory } from './seeding';
import { defaultSemisSize } from './single-elimination';
import { buildScheduleRounds, getMinimumBracketUnits } from './schedule-generation';
import { planTournament } from './generation-plan';
import { resolveWaterfallGraph } from './generation-plan-shape';
import type { GenerationForm } from './generation-plan-types';
import {
  type MatchResultPoints,
  matchResultsAllowed,
  parseMatchResultPoints,
  resolveTieMargin,
} from './match-results';
import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { wholeNumber } from './round-match-formats';
import { settingsFromForm } from './tournament-settings';
import type { TournamentRuntime } from './runtime';
import type { MaterializedGamemodeConfig, TournamentState } from './types';

type GenerateTournamentResult =
  { status: 'generated'; state: TournamentState } | { status: 'invalid'; message: string };

function generationError(message: string): GenerateTournamentResult {
  return { status: 'invalid', message };
}

function kingsValleyTooLargeMessage(input: {
  limit: number;
  entrants: number;
  unitPlural: string;
  formatLabel: string;
  hasQualification: boolean;
}): string {
  const fix = input.hasQualification
    ? 'Lower "Advance to bracket", or add a qualification phase.'
    : 'Add a qualification phase to cut the field first, or pick another schedule logic.';
  return `Kings Valley can take at most ${input.limit} ${input.unitPlural} into the ladder in ${input.formatLabel}: it has to reach the Final within ${MAX_KINGS_VALLEY_ROUNDS} rounds, and ${input.entrants} would enter. ${fix}`;
}

export function generateTournament(
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): GenerateTournamentResult {
  const planned = planTournament(form, current);
  if (!planned.ok) return generationError(planned.message);
  const { format, chosen, schedule, floorMin, unitPlural } = planned.plan;
  const { matchConfig, config, oddCountStrategy, roomSize, graphText, layeredPlay } = planned.plan;
  const { graphHasQualSource, graphHasGroupsSource } = planned.plan;
  const { qualRounds, swissRounds, nonCountingRounds } = planned.plan;
  let { waterfallGraph } = planned.plan;

  // The number of units that will actually enter the bracket phase (see
  // bracket-entry.ts; Group Stage derives it independently of config.qualAdv,
  // matching groupStagePoolingPhase's own seedTotal formula). Every validation
  // below that needs the real entrant count should use this, not
  // config.qualAdv, which is meaningless for Group Stage.
  // With a Qual source only the routed (non-eliminated) ranks enter the bracket.
  const bracketEntryCount = waterfallGraph?.qualRoutes
    ? waterfallGraph.qualRoutes.filter((destination) => destination !== 'eliminated').length
    : resolveBracketEntryCount({
        poolingPhase: config.poolingPhase,
        confirmedCount: config.n,
        qualAdv: config.qualAdv,
        groupSize: config.groupSize,
        qualifiersPerGroup: config.qualifiersPerGroup,
        groupExit: config.groupExit,
      });

  // Waterfall's whole schedule is the organiser's own hand-authored graph. Without a Qual source,
  // rule 9 checks the graph's declared entry total against bracketEntryCount, the real
  // post-pooling entrant count computed just above -- not config.qualAdv, which is meaningless
  // for Group Stage.
  if (schedule === 'waterfall-bracket' && !graphHasQualSource && !graphHasGroupsSource) {
    const resolved = resolveWaterfallGraph(graphText, {
      roomSize,
      entrantCount: bracketEntryCount,
    });
    if (!resolved.ok) return generationError(resolved.message);
    waterfallGraph = resolved.graph;
  }

  let positionalPointsTable: number[] | undefined;
  if (config.scoring === 'positional-points') {
    if (!form.positionalPointsTable.trim()) {
      return generationError(
        'Positional-points scoring needs a rank-to-points table — enter one value per rank, highest rank first (e.g. "10,8,6,5,4,3,2,1").',
      );
    }
    const parts = form.positionalPointsTable.split(',').map((part) => part.trim());
    const values = parts.map((part) => Number.parseInt(part, 10));
    const isValidInteger = (value: number, part: string) =>
      Number.isFinite(value) && value >= 0 && String(value) === part;
    if (values.some((value, index) => !isValidInteger(value, parts[index]))) {
      return generationError(
        `Positional-points table must be a comma-separated list of non-negative whole numbers — got "${form.positionalPointsTable}".`,
      );
    }
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[index - 1]) {
        return generationError(
          `Positional-points table must not increase from rank to rank — got ${values.join(',')}.`,
        );
      }
    }
    if (values.length < roomSize.max) {
      return generationError(
        `Positional-points table needs at least ${roomSize.max} entries (the largest possible room size for this format) — got ${values.length}.`,
      );
    }
    positionalPointsTable = values;
  }

  let matchResults: { points: MatchResultPoints; tieMargin: number } | undefined;
  if (config.scoring === 'match-results') {
    if (!matchResultsAllowed(config.poolingPhase, form.gameFormat, form.oddCountStrategy)) {
      return generationError(
        'Match results scoring is only available for a Group Stage, or for Swiss or a qualification table when every room holds two units (a head-to-head format without Flex) — pick Standard points or a Custom points table.',
      );
    }
    const points = parseMatchResultPoints(form.matchResultPoints);
    if (!points.ok) return generationError(points.message);
    const tieMargin = resolveTieMargin(form.tieMargin, form.gameFormat, format.label);
    if (!tieMargin.ok) return generationError(tieMargin.message);
    matchResults = { points: points.value, tieMargin: tieMargin.value };
  }

  // Defense-in-depth: the Setup UI only ever offers 'double-elimination' as
  // an option when the format/odd-count-strategy combination is compatible,
  // but a stale selection can survive an odd-count-strategy change made
  // after schedule logic was picked (the option disappears from the
  // dropdown without resetting the already-selected value). Catch it here
  // with a clear message instead of the raw exception this would otherwise
  // hit two calls deep inside doubleEliminationBracketPhase.
  if (schedule === 'double-elimination') {
    if (format.idealRoomSize !== 2) {
      return generationError(
        `Double elimination isn't available for ${format.label} — it requires a head-to-head room shape (exactly 2 units per room). Pick "Double elimination — FFA/Team" instead.`,
      );
    }
    if (oddCountStrategy === 'flex') {
      return generationError(
        `Double elimination doesn't support the "Flex" odd-count strategy — a 3-unit room isn't double elimination. Pick "None" or "Bye" instead, or switch to "Double elimination — FFA/Team".`,
      );
    }
  }
  // Defense-in-depth, same shape as the double-elimination gate above: the
  // Setup UI only ever offers 'kings-valley' when the format isn't
  // head-to-head, but a stale selection can survive a format change made
  // after schedule logic was picked (the option disappears from the
  // dropdown without resetting an already-selected value). Head-to-head
  // Kings Valley tournaments generated before this gate keep working --
  // this only blocks new generation.
  if (schedule === 'kings-valley' && format.idealRoomSize === 2) {
    return generationError(
      `Kings Valley isn't available for ${format.label} — a head-to-head room shape (exactly 2 units per room) cuts only one unit per round, too slow to reach a Final. Pick another schedule logic.`,
    );
  }
  if (schedule === 'kings-valley') {
    const limit = kingsValleyMaxEntrants(roomSize);
    if (bracketEntryCount > limit) {
      return generationError(
        kingsValleyTooLargeMessage({
          limit,
          entrants: bracketEntryCount,
          unitPlural,
          formatLabel: format.label,
          hasQualification: config.poolingPhase !== 'none',
        }),
      );
    }
  }
  if (format.supportedOddCountStrategies && oddCountStrategy === 'none') {
    const ideal = format.idealRoomSize as number;
    if (config.poolingPhase !== 'none' && config.poolingPhase !== 'group-stage' && config.n % ideal !== 0) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      return generationError(
        `With "None" selected as the odd-count strategy, the registered ${unitPlural} must be an exact multiple of ${ideal} (this format's room size) so the pooling phase itself can pair everyone cleanly — got ${config.n}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
    const eliminationEntryCount = bracketEntryCount;
    const isMultiple = eliminationEntryCount % ideal === 0;
    const isPowerOfTwo =
      eliminationEntryCount > 0 && (eliminationEntryCount & (eliminationEntryCount - 1)) === 0;
    const needsPowerOfTwo = schedule === 'double-elimination';
    if (!(needsPowerOfTwo ? isMultiple && isPowerOfTwo : isMultiple)) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      const requirement = needsPowerOfTwo
        ? 'must be an exact power of 2 (double elimination halves the field every round)'
        : `must be an exact multiple of ${ideal} (this format's room size)`;
      return generationError(
        `With "None" selected as the odd-count strategy, the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `registered ${unitPlural}`} ${requirement} — got ${eliminationEntryCount}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
  }

  const semisOverride = schedule === 'single-elimination' ? wholeNumber(form.semisOverride, 0) || null : null;
  const finalOverride =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final'
      ? wholeNumber(form.finalOverride, 0) || null
      : null;
  // wholeNumber()'s `|| fallback` only replaces a falsy (zero/NaN) parse result --
  // a negative value like "-5" parses successfully and stays truthy, so it
  // slips straight through. Reject explicitly rather than let a negative
  // override reach distributeRooms() (which returns [] for a non-positive
  // count) and divide-by-zero into Infinity/NaN baked silently into round data.
  if (semisOverride !== null && semisOverride < 1) {
    return generationError(`Semis size override must be a positive number — got ${semisOverride}.`);
  }
  if (finalOverride !== null && finalOverride < 1) {
    return generationError(`Final size override must be a positive number — got ${finalOverride}.`);
  }
  const overrideEntryCount = bracketEntryCount;
  const semisDefault =
    schedule === 'single-elimination' ? defaultSemisSize(roomSize, bracketEntryCount) : 2 * roomSize.ideal;
  if (
    schedule === 'single-elimination' &&
    config.poolingPhase === 'group-stage' &&
    bracketEntryCount < floorMin
  ) {
    return generationError(
      `Group stage sends ${bracketEntryCount} ${unitPlural} to the bracket; single elimination needs at least ${floorMin} (Semis needs 2 rooms of at least ${roomSize.min}). Increase the group count or qualifiers per group.`,
    );
  }
  if (semisOverride && finalOverride && finalOverride > semisOverride) {
    return generationError(
      `Final size override (${finalOverride}) can't exceed the Semis size override (${semisOverride}) — there can't be more finalists than Semis participants.`,
    );
  }
  if (semisOverride && semisOverride > overrideEntryCount) {
    return generationError(
      `Semis size override (${semisOverride}) can't exceed the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket (' : 'registered count ('}${overrideEntryCount}) — there'd be nothing left to eliminate down to it.`,
    );
  }
  // An oversized finalOverride is checked against semisOverride when that is set;
  // with no semisOverride it is checked against the derived default Semis size.
  if (schedule === 'single-elimination' && finalOverride && !semisOverride) {
    if (finalOverride > semisDefault) {
      return generationError(
        `Final size override (${finalOverride}) can't exceed the default Semis size (${semisDefault}) — there'd be nothing left to eliminate down to it. Set a Semis size override too if you want a larger Semis.`,
      );
    }
  }

  // Defense-in-depth: bracketEntryCount already reflects the real post-pooling
  // entrant count (including Group Stage's independent groups×qualifiers
  // formula), so this catches e.g. Group Stage + Double Elimination with too
  // few qualifiers reaching the bracket. It is checked here so the organiser
  // gets a clear message, not the "at least 2 winners-bracket rounds" throw of
  // raceDoubleEliminationBracketPhase through the generic catch-all below.
  if (schedule === 'double-elimination') {
    const doubleElimFloor = getMinimumBracketUnits(schedule, roomSize);
    if (bracketEntryCount < doubleElimFloor) {
      const adjustHint =
        config.poolingPhase === 'group-stage'
          ? 'Increase the group count or qualifiers per group.'
          : config.poolingPhase !== 'none'
            ? 'Increase "Advance to bracket."'
            : `Add more registered ${unitPlural}.`;
      return generationError(
        `Can't build a double-elimination bracket — only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase (needs at least ${doubleElimFloor}). ${adjustHint}`,
      );
    }
  }
  // Only meaningful for the race variant's grand-final (computeGrandFinalRaceState
  // only activates for a bracket:'grand-final' round, which only
  // raceDoubleEliminationBracketPhase ever produces) -- scoped to schedule
  // here to match, so a stale value left over from a different schedule
  // logic never blocks an otherwise-unrelated generation.
  const grandFinalWbTarget = wholeNumber(form.grandFinalWbTarget, 2);
  const grandFinalLbTarget = wholeNumber(form.grandFinalLbTarget, 3);
  if (schedule === 'double-elimination' && (grandFinalWbTarget < 1 || grandFinalLbTarget < 1)) {
    return generationError(
      `Grand Final win targets must be positive — got WB ${grandFinalWbTarget}, LB ${grandFinalLbTarget}.`,
    );
  }
  const prospectiveFinalSize = finalOverride || roomSize.ideal;
  let lbQualifiers: number | undefined;
  let winnersQualifiers: number | undefined;
  if (schedule === 'double-elimination-shared-final') {
    lbQualifiers = wholeNumber(form.lbQualifiers ?? '2', 0);
    if (!(lbQualifiers >= 1) || !(lbQualifiers < prospectiveFinalSize)) {
      return generationError(
        `LB qualifiers into the Final (${lbQualifiers}) must be at least 1 and less than the Final size (${prospectiveFinalSize}).`,
      );
    }
    // The winners-bracket side of the Final also needs to be reachable --
    // it can't ask for more WB qualifiers than actually entered the bracket
    // phase. It is checked here so the organiser gets a clear message, not the
    // "requestedRounds < 1" throw of sharedFinalDoubleEliminationBracketPhase
    // through the generic catch-all below.
    winnersQualifiers = prospectiveFinalSize - lbQualifiers;
    if (winnersQualifiers >= bracketEntryCount) {
      return generationError(
        `Final size override (${prospectiveFinalSize}) needs ${winnersQualifiers} winners-bracket qualifiers, but only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase — there wouldn't be enough winners-bracket rounds to produce them. Lower the Final size override, raise LB qualifiers, or increase how many ${unitPlural} advance into the bracket.`,
      );
    }
  }

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
