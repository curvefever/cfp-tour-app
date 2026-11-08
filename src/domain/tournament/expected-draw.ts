import {
  currentColumn,
  nextColumnStart,
  roundColumn,
  undrawnRounds,
  usesDependencyPlay,
} from './round-columns';
import { advanceTournamentRound, drawWaterfallRoundAhead } from './transitions';
import {
  doneAfterPress,
  finishedRoundsInPlay,
  isFeederFinished,
  isRoundScored,
  roundsReadyToDraw,
  routesTo,
} from './waterfall-steps';
import type { RoundAssignment, TournamentState } from './types';

/** What one undrawn round is expected to look like: its room sizes as fitted to the units arriving, its line-up and the units sitting it out. */
export interface ExpectedRound {
  rooms: number[];
  assignments: RoundAssignment[];
  byes: string[];
}

/** Whether every contested room of every round of the column in play has every score in. */
function isColumnScored(state: TournamentState): boolean {
  const { start, end } = currentColumn(state);
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    if (!isRoundScored(state, roundIndex)) return false;
  }
  return true;
}

/** Whether a round of the next column already has its line-up: drawn, or published ahead (a fixed draw, a group-stage pairing). */
function isNextColumnDecided(state: TournamentState, start: number, end: number): boolean {
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    if (state.assignments[roundIndex]?.length || round.fixedRoomAssignments || round.matches) return true;
  }
  return false;
}

/** What the draw of `target` would be once the column in play's rounds that feed it are finished, or null while that is not known. */
function expectedWaterfallRound(state: TournamentState, target: number): ExpectedRound | null {
  const { start, end } = currentColumn(state);
  const feeders: number[] = [];
  for (let index = start; index < target; index += 1) {
    if (!routesTo(state.rounds[index], target)) continue;
    if (index > end || !isFeederFinished(state, index)) return null;
    feeders.push(index);
  }
  return drawnAhead(state, target, feeders);
}

/** The draw of `target` once the units of `feeders` (finished rounds not yet sent on) are added to its pool, or null when it can't be drawn. */
function drawnAhead(state: TournamentState, target: number, feeders: number[]): ExpectedRound | null {
  const drawn = drawWaterfallRoundAhead(state, target, feeders);
  const assignments = drawn?.assignments[target] ?? [];
  if (!drawn || assignments.length === 0) return null;
  return { rooms: drawn.rounds[target].rooms, assignments, byes: drawn.byes[target] ?? [] };
}

/**
 * Dependency play: every round the next press would draw, drawn as the press draws it: the rounds whose feeders are
 * all sent on or finished (`roundsReadyToDraw` with the finished rounds counted done, so the Final and a manual
 * COLUMN hold as they do there). A drawn round with a line-up is not undrawn, so Previous (which removes the draw)
 * needs no guard here.
 */
function expectedDependencyRounds(state: TournamentState): Map<number, ExpectedRound> {
  const finished = finishedRoundsInPlay(state);
  const expected = new Map<number, ExpectedRound>();
  for (const target of roundsReadyToDraw(state, doneAfterPress(state, finished))) {
    const feeders = finished.filter((index) => routesTo(state.rounds[index], target));
    const round = drawnAhead(state, target, feeders);
    if (round) expected.set(target, round);
  }
  return expected;
}

/**
 * Each undrawn round of a Custom bracket whose own feeders are all finished, drawn as its units arrive. Empty
 * once a later round has a line-up (after Previous): the pools of later rounds then already hold what the
 * column in play sent, and routing it again would count those units twice.
 */
function expectedWaterfallRounds(state: TournamentState): Map<number, ExpectedRound> {
  if (usesDependencyPlay(state)) return expectedDependencyRounds(state);
  const expected = new Map<number, ExpectedRound>();
  const { end } = currentColumn(state);
  for (let index = end + 1; index < state.rounds.length; index += 1) {
    if (state.assignments[index]?.length) return expected;
  }
  for (let target = end + 1; target < state.rounds.length; target += 1) {
    const round = expectedWaterfallRound(state, target);
    if (round) expected.set(target, round);
  }
  return expected;
}

/**
 * The next column as "Next Round" would draw it from the results so far, while that is determined: the round in
 * play isn't a Custom bracket round, its column is fully scored, no tie waits (or the advance is refused for any
 * other reason) and the next column is not drawn or published yet. When the advance enters a Custom bracket, the
 * later rounds fed only by the table or the groups are drawn too.
 */
function expectedAfterAdvance(state: TournamentState): Map<number, ExpectedRound> {
  const expected = new Map<number, ExpectedRound>();
  const start = nextColumnStart(state);
  const { end } = roundColumn(state.rounds, start);
  if (isNextColumnDecided(state, start, end) || !isColumnScored(state)) return expected;

  const advanced = advanceTournamentRound(state);
  if (advanced.status !== 'advanced') return expected;
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    const assignments = advanced.state.assignments[roundIndex] ?? [];
    if (assignments.length === 0) continue;
    expected.set(roundIndex, {
      rooms: advanced.state.rounds[roundIndex].rooms,
      assignments,
      byes: advanced.state.byes[roundIndex] ?? [],
    });
  }
  if (!advanced.state.rounds[advanced.state.curRound].isWaterfall) return expected;
  return new Map([...expectedWaterfallRounds(advanced.state), ...expected]);
}

/**
 * The line-ups of undrawn rounds as "Next Round" would make them from the results so far, or null while none is
 * determined: the tournament has not started, there is no next column, or nothing can be drawn yet. In a Custom
 * bracket a round shows as soon as its own feeders are finished (every score in, no tie, no blocking absence
 * question), whichever column it is in; elsewhere the next column shows once the column in play is fully scored
 * and no tie waits. Display only: nothing is written, and the input state is not changed.
 */
export function expectedRounds(state: TournamentState): Map<number, ExpectedRound> | null {
  if (!state.started || undrawnRounds(state).length === 0) return null;
  const expected = state.rounds[state.curRound].isWaterfall
    ? expectedWaterfallRounds(state)
    : expectedAfterAdvance(state);
  return expected.size > 0 ? expected : null;
}
