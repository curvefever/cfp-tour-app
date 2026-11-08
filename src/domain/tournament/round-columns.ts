import type { TournamentRound, TournamentState } from './types';

/**
 * What the column helpers read. The dependency play fields are optional so that a state without them (every other
 * format, an older tournament, a test's bare `{ rounds, curRound }`) reads as column play.
 */
type ColumnState = Pick<TournamentState, 'rounds' | 'curRound'> &
  Partial<Pick<TournamentState, 'gamemodeConfig' | 'waterfallSteps'>>;

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

/** The column in play: `curRound` is its first round. Column play only: in dependency play use `roundsInPlay`. */
export function currentColumn(state: ColumnState): RoundColumn {
  return roundColumn(state.rounds, state.curRound);
}

/**
 * True when the tournament is a Custom bracket played by dependency play (`dependencyPlayVersion`) and is at a
 * waterfall round. False in the pooling rounds before the bracket (also after Previous went back into them), in
 * every other format and in an older tournament: every helper below then reads exactly as column play.
 */
export function usesDependencyPlay(state: ColumnState): boolean {
  return (
    state.gamemodeConfig?.dependencyPlayVersion === 1 && Boolean(state.rounds[state.curRound]?.isWaterfall)
  );
}

/**
 * The rounds in dependency play, and where they stand. The reached rounds are NOT a prefix of `state.rounds`: on
 * [U1, L1] [U2, L2] [U3, L3], L3 can be in play while U2 is not drawn. Never read "index <= something" as reached.
 *  - reached: everything before the first waterfall round, the column the bracket is entered in, and every round a
 *    step drew;
 *  - done: everything before the first waterfall round, and every round a step that is not reopened sent on.
 */
interface DependencyRounds {
  reached: ReadonlySet<number>;
  done: ReadonlySet<number>;
}

function dependencyRounds(state: ColumnState): DependencyRounds {
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  const entry = roundColumn(state.rounds, first);
  const reached = new Set<number>();
  const done = new Set<number>();
  for (let index = 0; index < first; index += 1) {
    reached.add(index);
    done.add(index);
  }
  for (let index = entry.start; index <= entry.end; index += 1) reached.add(index);
  for (const step of state.waterfallSteps ?? []) {
    for (const index of step.drew ?? []) reached.add(index);
    if (step.reopened) continue;
    for (const index of step.sent) done.add(index);
  }
  return { reached, done };
}

/** Every round index, in order, that passes `keep`. */
function roundIndices(state: ColumnState, keep: (index: number) => boolean): number[] {
  return state.rounds.map((_, index) => index).filter(keep);
}

/**
 * The rounds in play, in order: the column of `curRound` in column play; in dependency play every round reached and
 * not done, of which `curRound` is the lowest.
 */
export function roundsInPlay(state: ColumnState): number[] {
  if (!usesDependencyPlay(state)) {
    const { start, end } = currentColumn(state);
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  }
  const { reached, done } = dependencyRounds(state);
  return roundIndices(state, (index) => reached.has(index) && !done.has(index));
}

/** True when the round is in play. */
export function isCurrentRound(state: ColumnState, index: number): boolean {
  if (!usesDependencyPlay(state)) {
    const { start, end } = currentColumn(state);
    return index >= start && index <= end;
  }
  return roundsInPlay(state).includes(index);
}

/** True when the round is drawn and in play, or done. In column play that is every round up to the column in play. */
export function isRoundReached(state: ColumnState, index: number): boolean {
  if (!usesDependencyPlay(state)) return index <= currentColumn(state).end;
  return dependencyRounds(state).reached.has(index);
}

/** True when the round is done: before the column in play, or in dependency play sent on by a press. */
export function isRoundDone(state: ColumnState, index: number): boolean {
  if (!usesDependencyPlay(state)) return index < currentColumn(state).start;
  return dependencyRounds(state).done.has(index);
}

/**
 * The first round after the column in play (past the last round when it is the final column). Column play only:
 * in dependency play the rounds ahead are not a run after `curRound`, use `undrawnRounds`.
 */
export function nextColumnStart(state: ColumnState): number {
  return currentColumn(state).end + 1;
}

/** The rounds not reached yet, in order: in column play every round after the column in play. */
export function undrawnRounds(state: ColumnState): number[] {
  if (!usesDependencyPlay(state)) return roundIndices(state, (index) => index >= nextColumnStart(state));
  const { reached } = dependencyRounds(state);
  return roundIndices(state, (index) => !reached.has(index));
}

/** The first round of the column before the one in play, or null when the column in play is the first. */
export function previousColumnStart(state: ColumnState): number | null {
  const { start } = currentColumn(state);
  return start > 0 ? roundColumn(state.rounds, start - 1).start : null;
}

/**
 * The round of the column in play whose line-up holds the unit, or `curRound` when none does (a unit
 * waiting in a later pool, or a bye): where a roster change or a defender change for it applies.
 */
export function roundInPlayOf(
  state: Pick<TournamentState, 'rounds' | 'curRound' | 'assignments'>,
  name: string,
): number {
  const { start, end } = currentColumn(state);
  for (let index = start; index <= end; index += 1) {
    if ((state.assignments[index] ?? []).some((entry) => entry.name === name)) return index;
  }
  return state.curRound;
}
