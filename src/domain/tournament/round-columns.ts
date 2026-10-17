import type { TournamentRound, TournamentState } from './types';

type ColumnState = Pick<TournamentState, 'rounds' | 'curRound'>;

/** A run of rounds played together: `state.rounds[start]` to `state.rounds[end]`, both included. */
export interface RoundColumn {
  start: number;
  end: number;
}

/**
 * The rounds played together with round `index`: the contiguous run that shares its `waterfallColumn`.
 * A round without a stored column (every other format) is a column of its own.
 */
export function roundColumn(rounds: readonly TournamentRound[], index: number): RoundColumn {
  const column = rounds[index]?.waterfallColumn;
  if (column === undefined) return { start: index, end: index };
  let start = index;
  let end = index;
  while (rounds[start - 1]?.waterfallColumn === column) start -= 1;
  while (rounds[end + 1]?.waterfallColumn === column) end += 1;
  return { start, end };
}

/** The column in play: `curRound` is its first round. */
export function currentColumn(state: ColumnState): RoundColumn {
  return roundColumn(state.rounds, state.curRound);
}

/** True when the round is in the column in play. */
export function isCurrentRound(state: ColumnState, index: number): boolean {
  const { start, end } = currentColumn(state);
  return index >= start && index <= end;
}

/** True when the round is drawn and in play, or done: it is not after the column in play. */
export function isRoundReached(state: ColumnState, index: number): boolean {
  return index <= currentColumn(state).end;
}

/** True when the round is before the column in play. */
export function isRoundDone(state: ColumnState, index: number): boolean {
  return index < currentColumn(state).start;
}

/** The first round after the column in play (past the last round when it is the final column). */
export function nextColumnStart(state: ColumnState): number {
  return currentColumn(state).end + 1;
}

/** The first round of the column before the one in play, or null when the column in play is the first. */
export function previousColumnStart(state: ColumnState): number | null {
  const { start } = currentColumn(state);
  return start > 0 ? roundColumn(state.rounds, start - 1).start : null;
}
