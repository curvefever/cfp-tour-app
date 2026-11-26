import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { emptySchedule } from './empty-schedule';
import type { GenerationForm, TournamentPlan } from './generation-plan-types';
import { seedFromGroupStageRound } from './pooling';
import { rosterKeys } from './roster';
import type { TournamentRuntime } from './runtime';
import type { ScheduleRounds } from './schedule-generation';
import { randomSeed } from './seeding';
import { recordRoomHistory } from './room-history';
import { settingsFromForm } from './tournament-settings';
import type { TournamentState } from './types';

/** Draws the first round into the new state, with its byes and the room history a fixed schedule already decides. */
function drawFirstRound(state: TournamentState, plan: TournamentPlan, runtime: TournamentRuntime): void {
  const { config, gamemodeConfig } = plan;
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
}

/** The state of a tournament that has just been generated from its plan and rounds, with round 1 drawn. */
export function startTournament(
  plan: TournamentPlan,
  progression: Extract<ScheduleRounds, { ok: true }>,
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): TournamentState {
  const { schedule, config, gamemodeConfig } = plan;
  const roster = rosterKeys(current.players);

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
  drawFirstRound(state, plan, runtime);
  return withFinalistAliasesForLineup(state);
}
