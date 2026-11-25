import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { recordedUnits, replayBracketPools, sameNames } from './bracket-replay';
import { discardRoundDraws } from './redraw';
import {
  isRoundDone,
  lastAssignedRound,
  previousColumnStart,
  undrawnRounds,
  usesDependencyPlay,
} from './round-columns';
import { roundHasAnyScore } from './scoring';
import type { PendingBracketSeed, TournamentState, WaterfallStep } from './types';
import { withRoundInPlay } from './waterfall-steps';

/**
 * Previous, for every format: `canGoBack` and `goBack`. In dependency play it undoes or reopens the last press
 * (`waterfall-steps.ts` makes the presses); otherwise it goes to the column before.
 */

/** The index of the last step Previous can act on: the last one that is not reopened, or -1. */
function lastOpenStep(state: TournamentState): number {
  const steps = state.waterfallSteps ?? [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (!steps[index].reopened) return index;
  }
  return -1;
}

/** The first round of the bracket (the rounds before it are the pooling rounds), or -1 in a state with none. */
function firstBracketRound(state: TournamentState): number {
  return state.rounds.findIndex((round) => round.isWaterfall);
}

/**
 * Whether Previous does anything: in dependency play, while a press can be undone or reopened, or the pooling rounds
 * before the bracket can be returned to; otherwise (column play, pooling) while there is a column before.
 */
export function canGoBack(state: TournamentState): boolean {
  if (!usesDependencyPlay(state)) return previousColumnStart(state) !== null;
  return lastOpenStep(state) !== -1 || firstBracketRound(state) > 0;
}

/**
 * Undoes the last press: its drawn rounds lose their draw, and the pools are rebuilt by replaying the rounds still
 * done, so the state is what it was before the press (a pool may list its units in another order, which no draw
 * reads). The rounds it sent on are in play again. Null when the replay does not explain the pools
 * (`replayExplainsUndo`).
 */
function undoLastStep(state: TournamentState): TournamentState | null {
  const steps = state.waterfallSteps ?? [];
  const dropped = steps[steps.length - 1];
  const undrawn = discardRoundDraws({ ...state, waterfallSteps: steps.slice(0, -1) }, dropped.drew ?? []);
  const done = new Set(undrawn.rounds.flatMap((_, index) => (isRoundDone(undrawn, index) ? [index] : [])));
  const { pools } = replayBracketPools(undrawn, done);
  const waiting = undrawnRounds(undrawn).flatMap((index) => {
    const pool = pools.get(index);
    return pool ? [[index, pool] as const] : [];
  });
  if (!replayExplainsUndo(state, undrawn, dropped, pools)) return null;
  const assignments = undrawn.assignments.slice(0, lastAssignedRound(undrawn) + 1);
  return withRoundInPlay({ ...undrawn, assignments, pendingBracketSeeds: Object.fromEntries(waiting) });
}

/**
 * Whether the pools the replay of the done rounds gives are the ones the undo of `dropped` should leave. A correction
 * made while a step was reopened changes the scores of a done round but, by design, no draw, so its scores may no
 * longer explain where the units are. For each round not reached once the step is gone, the units it should hold
 * (for a round the step drew, its line-up; for any other, its pool; each without the units of the rounds the step sent
 * on, which return to those rounds) must be the units the replay sends it, by current name. Anything else is an
 * unknown state to rebuild from: Previous reopens the step instead. Column play's check (`replayExplainsPools`)
 * assumes the reached rounds are a prefix and the rounds to advance again are the column after the one in play, so it
 * does not apply here.
 */
function replayExplainsUndo(
  state: TournamentState,
  undrawn: TournamentState,
  dropped: WaterfallStep,
  pools: ReadonlyMap<number, PendingBracketSeed[]>,
): boolean {
  const { current, lineUp } = recordedUnits(state);
  const sentUnits = new Set(current(dropped.sent.flatMap(lineUp)));
  const drew = new Set(dropped.drew ?? []);
  return undrawnRounds(undrawn).every((index) => {
    const held = drew.has(index)
      ? lineUp(index)
      : (state.pendingBracketSeeds[index] ?? []).map((seed) => seed.name);
    const expected = current(held).filter((name) => !sentUnits.has(name));
    const replayed = (pools.get(index) ?? []).map((seed) => seed.name);
    return sameNames(expected, replayed);
  });
}

/** Marks step `index` reopened: its sent rounds are in play and editable again, its drawn rounds stay as they are. */
function reopenStep(state: TournamentState, index: number): TournamentState {
  const steps = (state.waterfallSteps ?? []).map((step, position) =>
    position === index ? { ...step, reopened: true } : step,
  );
  return withRoundInPlay({ ...state, waterfallSteps: steps });
}

/**
 * Previous. Pure.
 * In dependency play it takes the last step that is not reopened: when it is the last step and no round it drew has
 * a score, the press is undone (`undoLastStep`); otherwise the step is reopened (`reopenStep`), because a draw with
 * a score can't be thrown away. With every step reopened, or none, it returns to the last pooling round, where
 * the tournament is no longer in dependency play and Next Round reads the bracket as drawn ahead.
 * Elsewhere it goes to the column before.
 */
export function goBack(state: TournamentState): TournamentState {
  return withFinalistAliasesForLineup(stepBack(state));
}

function stepBack(state: TournamentState): TournamentState {
  if (!usesDependencyPlay(state)) {
    return { ...state, curRound: previousColumnStart(state) ?? state.curRound };
  }
  const index = lastOpenStep(state);
  if (index === -1) {
    const first = firstBracketRound(state);
    return first > 0 ? { ...state, curRound: first - 1 } : state;
  }
  const step = state.waterfallSteps[index];
  const drewScore = (step.drew ?? []).some((round) => roundHasAnyScore(state, round, state.rounds[round]));
  const isLast = index === state.waterfallSteps.length - 1;
  const undone = isLast && !drewScore ? undoLastStep(state) : null;
  return undone ?? reopenStep(state, index);
}
