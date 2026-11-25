import { hasBlockingAbsenceQuestionsInRound, PENDING_ABSENCES_MESSAGE } from './absences';
import { hasPendingTies, isUncontestedRoom } from './advancement';
import { routeWaterfallRound } from './bracket-replay';
import {
  isRoundDone,
  reopenedRounds,
  roundColumn,
  roundsInPlay,
  undrawnRounds,
  usesDependencyPlay,
} from './round-columns';
import { isRoomScored, occupiedRooms, type UnscoredRoom } from './scoring';
import {
  cloneForTransition,
  fitWaterfallRoundAt,
  mergeAdditions,
  PENDING_TIES_MESSAGE,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
} from './round-advance-tools';
import type { TournamentRound, TournamentState } from './types';
import { roundDestinations } from './waterfall-best';

/**
 * Dependency play of a Custom bracket (`dependencyPlayVersion`): Next Round sends on every round that is finished
 * and draws every round whose own feeders are then all sent on. `round-columns.ts` says which rounds are reached,
 * in play and done. This file holds dependency play only: what the next press does and the press itself, and the
 * state as a press leaves it (`withRoundInPlay`, `withPressesResumed`). Previous is in `go-back.ts`.
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
  return roundDestinations(round).includes(target);
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

/** `state` with `curRound` on the lowest round in play and the reserve window read from there, as a press leaves them. */
export function withRoundInPlay(state: TournamentState): TournamentState {
  const next = { ...state, curRound: roundsInPlay(state)[0] ?? state.curRound };
  return { ...next, reserveOpen: reserveWindowAtCurrentRound(next) };
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
