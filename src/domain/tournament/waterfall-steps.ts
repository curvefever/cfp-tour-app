import { hasBlockingAbsenceQuestionsInRound, PENDING_ABSENCES_MESSAGE } from './absences';
import { hasPendingTies, isUncontestedRoom, refreshRoundStandings } from './advancement';
import { routeWaterfallRound } from './bracket-replay';
import { isRoundDone, roundColumn, roundsInPlay, undrawnRounds } from './round-columns';
import { isRoomScored, occupiedRooms } from './scoring';
import {
  cloneForTransition,
  fitWaterfallRoundAt,
  mergeAdditions,
  PENDING_TIES_MESSAGE,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
} from './transitions';
import type { PendingBracketSeed, TournamentRound, TournamentState } from './types';

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

/**
 * The rounds a reopened step sent on: in play again, but already routed into the pools, so a press counts them
 * as done without routing them a second time.
 */
function reopenedRounds(state: TournamentState): number[] {
  return (state.waterfallSteps ?? []).filter((step) => step.reopened).flatMap((step) => step.sent);
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
function doneAfterPress(state: TournamentState, sent: readonly number[]): Set<number> {
  const done = new Set([...sent, ...reopenedRounds(state)]);
  state.rounds.forEach((_, index) => {
    if (isRoundDone(state, index)) done.add(index);
  });
  return done;
}

/** What a round sends on, each unit stamped with the round it came from (see `PendingBracketSeed.sourceRound`). */
function routedFrom(state: TournamentState, roundIndex: number): Map<number, PendingBracketSeed[]> {
  const routed = routeWaterfallRound(state, roundIndex, state.rounds[roundIndex]);
  return new Map(
    [...routed].map(([destination, seeds]) => [
      destination,
      seeds.map((seed) => ({ ...seed, sourceRound: roundIndex })),
    ]),
  );
}

/** A pool in the order column play fills it: by the round the units came from, the order within a round kept. */
export function inFeederOrder(pool: PendingBracketSeed[]): PendingBracketSeed[] {
  return [...pool].sort((first, second) => (first.sourceRound ?? -1) - (second.sourceRound ?? -1));
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

/**
 * Next Round in dependency play. Sends on the finished rounds in play with no question, or when none is finished
 * every round in play (ties and absence questions block that); routes them into the pools; draws every round
 * whose feeders are then all sent on; records the press and moves `curRound` to the lowest round in play. A round
 * of a reopened step is counted as done without routing or drawing anything. The press is all or nothing: a round
 * that can't be drawn returns the input state unchanged.
 */
export function advanceDependencyPlay(input: TournamentState): RoundAdvanceResult {
  let prepared = input;
  for (const index of roundsInPlay(input)) prepared = refreshRoundStandings(prepared, index);
  const { sent, confirmed } = roundsToSend(prepared);
  const reopened = reopenedRounds(prepared);
  if (sent.length === 0 && reopened.length === 0) {
    return { status: 'noop', reason: 'last-round', state: input };
  }
  if (confirmed && sent.some((index) => hasPendingTies(prepared, index))) {
    return { status: 'blocked', reason: 'pending-ties', message: PENDING_TIES_MESSAGE, state: prepared };
  }
  if (confirmed && sent.some((index) => hasBlockingAbsenceQuestionsInRound(prepared, index))) {
    return {
      status: 'blocked',
      reason: 'pending-absences',
      message: PENDING_ABSENCES_MESSAGE,
      state: prepared,
    };
  }

  const state = cloneForTransition(prepared);
  for (const [destination, additions] of mergeAdditions(sent.map((index) => routedFrom(state, index)))) {
    state.pendingBracketSeeds[destination] = [
      ...(state.pendingBracketSeeds[destination] ?? []),
      ...additions,
    ];
  }
  const ready = roundsReadyToDraw(state, doneAfterPress(state, sent));
  for (const index of ready) {
    const arriving = (state.pendingBracketSeeds[index] ?? []).length;
    const shapeFailure = fitWaterfallRoundAt(state, index, arriving);
    if (shapeFailure) return { status: 'blocked', ...shapeFailure, state: input };
  }
  for (const index of ready) {
    state.pendingBracketSeeds[index] = inFeederOrder(state.pendingBracketSeeds[index] ?? []);
    const fitFailure = seedRoundFromPendingPool(state, index);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  }

  state.waterfallSteps = state.waterfallSteps.map(({ reopened: _reopened, ...step }) => step);
  if (sent.length > 0 || ready.length > 0) state.waterfallSteps.push({ sent, drew: ready });
  state.curRound = roundsInPlay(state)[0] ?? state.curRound;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}
