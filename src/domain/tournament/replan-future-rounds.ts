import { getGameFormat } from './formats';
import { generatedConfig } from './generated-config';
import { groupSettingsOfCfg } from './group-settings';
import { refitPoolingRound } from './pooling';
import { validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { buildScheduleRounds } from './schedule-generation';
import { replanUpperLower } from './upper-lower-replan';
import type { TournamentState } from './types';

/** The rounds not yet reached, planned again for the roster count after a unit leaves or a reserve joins. */

export function rebuildFutureRounds(state: TournamentState): TournamentState | null {
  const round = state.rounds[state.curRound];
  if (!round?.isNoElim || state.cfg.poolingPhase === 'group-stage') return state;
  const format = getGameFormat(state.gameFormat);
  if (!format) return null;
  const config = generatedConfig(state);
  if (!config || !config.bracketPhase) return null;
  const progression = buildScheduleRounds({
    bracketPhase: config.bracketPhase,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    config: {
      n: rosterKeys(state.players).length,
      qualAdv: state.cfg.qualAdv ?? rosterKeys(state.players).length,
      ...groupSettingsOfCfg(state.cfg),
      ...(state.cfg.groupExit ? { groupExit: state.cfg.groupExit } : {}),
    },
    format: config,
    roster: rosterKeys(state.players),
  });
  // A builder that refuses is not caught here, as before: the message is the builder's own.
  if (!progression.ok) throw new Error(progression.error);
  const rounds = [
    ...state.rounds.slice(0, state.curRound + 1),
    ...progression.rounds.slice(state.curRound + 1),
  ];
  if (validateRoomCap(rounds, format)) return null;
  const emptyTail = Array.from(
    { length: Math.max(0, rounds.length - state.curRound - 1) },
    () => [] as string[],
  );
  return {
    ...state,
    rounds,
    assignments: state.assignments.slice(0, state.curRound + 1),
    byes: [...state.byes.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
    luckyLosers: [...state.luckyLosers.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
  };
}

/**
 * A waterfall keeps its graph rounds (they are fitted to the real head count at each advance, and a re-plan would
 * discard live graph edits), but the pooling rounds before them are not part of the graph: reshape the ones not
 * yet reached for the roster count, so the Bracket shows the sizes the draw will use.
 */
export function refitFuturePoolingRounds(state: TournamentState): TournamentState {
  const config = generatedConfig(state);
  if (!config) return state;
  const { roomSize } = config;
  const count = rosterKeys(state.players).length;
  const rounds = state.rounds.map((round, index) =>
    index > state.curRound && round.isNoElim && !round.isGroupStage && !round.isWaterfall
      ? refitPoolingRound(round, count, roomSize, state.gamemodeConfig.oddCountStrategy)
      : round,
  );
  return { ...state, rounds };
}

/**
 * Re-plans the not-yet-reached rounds for the new headcount after a removal,
 * the way a reserve join does. Skipped for fixed draws (their published rounds
 * were already patched) and waterfall brackets (an exact-headcount graph), except that the built-in upper and
 * lower bracket works its rooms out again while the bracket is not entered (`replanUpperLower`), fixed draw or not. A
 * rebuild that fails, or that would leave an elimination round meant to keep
 * more units than reach it (e.g. explicit targets above the new headcount),
 * is dropped: the rounds stay as planned and advancing fits each one when it
 * is reached. A removal is never blocked by it.
 */
export function replanFutureRounds(state: TournamentState): TournamentState {
  const replanned = replanUpperLower(state);
  if (state.gamemodeConfig.drawPublication === 'fixed') return replanned;
  if (state.gamemodeConfig.bracketPhase === 'waterfall-bracket') return refitFuturePoolingRounds(replanned);
  const rebuilt = rebuildFutureRounds(state);
  if (!rebuilt) return state;
  const coherent = rebuilt.rounds.every(
    (round) => round.advPerRoom === null || round.advTotal <= round.players,
  );
  return coherent ? rebuilt : state;
}
