import { hasBlockingAbsenceQuestionsInRound, PENDING_ABSENCES_MESSAGE } from './absences';
import { hasPendingTies, isUncontestedRoom } from './advancement';
import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { currentUnit, replayBracketPools, routeWaterfallRound } from './bracket-replay';
import { discardRoundDraws, lastDrawnIndex } from './redraw';
import {
  isRoundDone,
  previousColumnStart,
  reopenedRounds,
  roundColumn,
  roundsInPlay,
  undrawnRounds,
  usesDependencyPlay,
} from './round-columns';
import { rosterKeys } from './roster';
import { isRoomScored, occupiedRooms, roundHasAnyScore, type UnscoredRoom } from './scoring';
import {
  cloneForTransition,
  fitWaterfallRoundAt,
  mergeAdditions,
  PENDING_TIES_MESSAGE,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
} from './transitions';
import type { PendingBracketSeed, TournamentRound, TournamentState, WaterfallStep } from './types';

/**
 * Dependency play of a Custom bracket (`dependencyPlayVersion`): Next Round sends on every round that is finished
 * and draws every round whose own feeders are then all sent on. `round-columns.ts` says which rounds are reached,
 * in play and done; this file holds what a press does.
 */

/** Whether every contested room of the round has every score in. */
export function isRoundScored(state: TournamentState, roundIndex: number): boolean {
  return !occupiedRooms(state, roundIndex).some(
    (room) => !isUncontestedRoom(state, roundIndex, room) && !isRoomScored(state, roundIndex, room),
  );
}

/** Whether the round has nothing left to settle before it sends its units on: every score in, no tie and no blocking absence question. */
export function isFeederFinished(state: TournamentState, roundIndex: number): boolean {
  return (
    isRoundScored(state, roundIndex) &&
    !hasPendingTies(state, roundIndex) &&
    !hasBlockingAbsenceQuestionsInRound(state, roundIndex)
  );
}

/** Whether a unit of one of the round's rooms can go to the target round. An absentee's destination is always among its room's routes. */
export function routesTo(round: TournamentRound, target: number): boolean {
  return round.waterfallRoutes?.some((room) => room.includes(target)) ?? false;
}

/** The rounds in play a press can send on with routing: every round in play but those of a reopened step. */
function liveRoundsInPlay(state: TournamentState): number[] {
  const reopened = new Set(reopenedRounds(state));
  return roundsInPlay(state).filter((index) => !reopened.has(index));
}

/** The rounds in play a press sends on with no question: finished, live and not the Final (it is the end of the bracket). */
export function finishedRoundsInPlay(state: TournamentState): number[] {
  return liveRoundsInPlay(state).filter(
    (index) => !state.rounds[index].isFinal && isFeederFinished(state, index),
  );
}

/** Whether `index` waits for rounds that are not done: a manual COLUMN holds a round behind every earlier column, the Final behind every other round. */
function isHeldBack(state: TournamentState, index: number, done: ReadonlySet<number>): boolean {
  const round = state.rounds[index];
  if (round.isFinal) return state.rounds.some((_, other) => other !== index && !done.has(other));
  if (!round.waterfallColumnSet) return false;
  const { start } = roundColumn(state.rounds, index);
  return state.rounds.slice(0, start).some((_, other) => !done.has(other));
}

/**
 * The rounds not reached yet that a press draws once the rounds of `done` are sent on: every round routing into
 * it is done and none of its holds applies. In order.
 */
export function roundsReadyToDraw(state: TournamentState, done: ReadonlySet<number>): number[] {
  return undrawnRounds(state).filter((index) => {
    const feeders = state.rounds.flatMap((round, source) => (routesTo(round, index) ? [source] : []));
    return feeders.every((source) => done.has(source)) && !isHeldBack(state, index, done);
  });
}

/** Every round done after a press that sends `sent` on: the done rounds, those of a reopened step (done again), and `sent`. */
export function doneAfterPress(state: TournamentState, sent: readonly number[]): Set<number> {
  const done = new Set([...sent, ...reopenedRounds(state)]);
  state.rounds.forEach((_, index) => {
    if (isRoundDone(state, index)) done.add(index);
  });
  return done;
}

/**
 * Which rounds a press would send on, without the question: the finished ones in play, or, when none is finished,
 * every live round in play, which the Next Round button confirms first. Empty when only the Final is in play.
 */
function roundsToSend(state: TournamentState): { sent: number[]; confirmed: boolean } {
  const finished = finishedRoundsInPlay(state);
  if (finished.length > 0) return { sent: finished, confirmed: false };
  return { sent: liveRoundsInPlay(state).filter((index) => !state.rounds[index].isFinal), confirmed: true };
}

/** What the next press does, read from the same functions the press uses, so what the Bracket says is what happens. */
export interface NextRoundPlan {
  /** Only the Final is in play and nothing is reopened: there is no press, and the button is hidden. */
  hidden: boolean;
  /** The rounds the press sends on, routing them into the pools (the finished ones, or every live one when none is). */
  sends: number[];
  /** The rounds of a reopened step: counted as done again, with no routing and no draw. */
  clears: number[];
  /** The rounds it draws. */
  draws: number[];
  /** The rounds in play that it leaves in play. */
  staysInPlay: number[];
  /** Nothing is finished: the press sends the rounds in play as they are, and the organiser confirms it first. */
  confirm: boolean;
  /** The rooms the confirmation lists: every room of a round it sends that is not fully scored, a partly scored one too. */
  roomsToConfirm: UnscoredRoom[];
  /** What stops the press: a tie or a blocking absence question in a round it would send on as it is. */
  blocked: 'pending-ties' | 'pending-absences' | null;
}

/** The rooms of the round with two or more units that are not fully scored (a decided Best of counts as scored). */
function roomsNotFullyScored(state: TournamentState, roundIndex: number): UnscoredRoom[] {
  return occupiedRooms(state, roundIndex)
    .filter((room) => !isUncontestedRoom(state, roundIndex, room) && !isRoomScored(state, roundIndex, room))
    .map((room) => ({ roundIndex, room }));
}

/** What Next Round would do now in dependency play: `advanceDependencyPlay` does exactly this. */
export function nextRoundPlan(state: TournamentState): NextRoundPlan {
  const { sent, confirmed } = roundsToSend(state);
  const clears = reopenedRounds(state);
  const hidden = sent.length === 0 && clears.length === 0;
  let blocked: NextRoundPlan['blocked'] = null;
  if (confirmed && sent.some((index) => hasPendingTies(state, index))) blocked = 'pending-ties';
  else if (confirmed && sent.some((index) => hasBlockingAbsenceQuestionsInRound(state, index))) {
    blocked = 'pending-absences';
  }
  const stops = hidden || blocked !== null;
  const confirm = confirmed && sent.length > 0;
  return {
    hidden,
    sends: sent,
    clears,
    draws: stops ? [] : roundsReadyToDraw(state, doneAfterPress(state, sent)),
    staysInPlay: roundsInPlay(state).filter((index) => !sent.includes(index) && !clears.includes(index)),
    confirm,
    roomsToConfirm: confirm ? sent.flatMap((index) => roomsNotFullyScored(state, index)) : [],
    blocked,
  };
}

/**
 * Next Round in dependency play (`nextRoundPlan`). Sends on the finished rounds in play with no question, or when
 * none is finished every round in play (ties and absence questions block that); routes them into the pools; draws
 * every round whose feeders are then all sent on; records the press and moves `curRound` to the lowest round in
 * play. A round of a reopened step is counted as done without routing or drawing anything. The press is all or
 * nothing: a round that can't be drawn returns the input state unchanged.
 */
export function advanceDependencyPlay(input: TournamentState): RoundAdvanceResult {
  const plan = nextRoundPlan(input);
  if (plan.hidden) return { status: 'noop', reason: 'last-round', state: input };
  if (plan.blocked === 'pending-ties') {
    return { status: 'blocked', reason: 'pending-ties', message: PENDING_TIES_MESSAGE, state: input };
  }
  if (plan.blocked === 'pending-absences') {
    return { status: 'blocked', reason: 'pending-absences', message: PENDING_ABSENCES_MESSAGE, state: input };
  }
  const { sends: sent, draws: ready } = plan;

  const state = cloneForTransition(input);
  for (const [destination, additions] of mergeAdditions(
    sent.map((index) => routeWaterfallRound(state, index, state.rounds[index])),
  )) {
    state.pendingBracketSeeds[destination] = [
      ...(state.pendingBracketSeeds[destination] ?? []),
      ...additions,
    ];
  }
  for (const index of ready) {
    const arriving = (state.pendingBracketSeeds[index] ?? []).length;
    const shapeFailure = fitWaterfallRoundAt(state, index, arriving);
    if (shapeFailure) return { status: 'blocked', ...shapeFailure, state: input };
  }
  for (const index of ready) {
    const fitFailure = seedRoundFromPendingPool(state, index);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  }

  state.assignments = Array.from(
    { length: state.assignments.length },
    (_, index) => state.assignments[index] ?? [],
  );
  state.waterfallSteps = state.waterfallSteps.map(({ reopened: _reopened, ...step }) => step);
  if (sent.length > 0 || ready.length > 0) state.waterfallSteps.push({ sent, drew: ready });
  state.curRound = roundsInPlay(state)[0] ?? state.curRound;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

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

/** `state` with `curRound` on the lowest round in play and the reserve window read from there, as a press leaves them. */
function withRoundInPlay(state: TournamentState): TournamentState {
  const next = { ...state, curRound: roundsInPlay(state)[0] ?? state.curRound };
  return { ...next, reserveOpen: reserveWindowAtCurrentRound(next) };
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
  const assignments = undrawn.assignments.slice(0, lastDrawnIndex(undrawn) + 1);
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
  const roster = new Set(rosterKeys(state.players));
  const current = (names: string[]) => names.flatMap((name) => currentUnit(state, roster, name) ?? []);
  const lineUp = (index: number) => (state.assignments[index] ?? []).map((entry) => entry.name);
  const sentUnits = new Set(current(dropped.sent.flatMap(lineUp)));
  const drew = new Set(dropped.drew ?? []);
  return undrawnRounds(undrawn).every((index) => {
    const held = drew.has(index)
      ? lineUp(index)
      : (state.pendingBracketSeeds[index] ?? []).map((seed) => seed.name);
    const expected = current(held).filter((name) => !sentUnits.has(name));
    const replayed = (pools.get(index) ?? []).map((seed) => seed.name);
    return JSON.stringify(expected.sort()) === JSON.stringify(replayed.sort());
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

/**
 * Stepping forward from the pooling rounds into a bracket that kept its presses (its draws had a score, so Next Round
 * did not throw them away): the presses stand as they were, with no step reopened, and the lowest round in play is
 * current. A tournament without presses, or not in dependency play, is returned as it is.
 */
export function withPressesResumed(state: TournamentState): TournamentState {
  const steps = state.waterfallSteps ?? [];
  if (steps.length === 0) return state;
  const resumed = { ...state, waterfallSteps: steps.map(({ reopened: _reopened, ...step }) => step) };
  return usesDependencyPlay(resumed) ? withRoundInPlay(resumed) : state;
}
