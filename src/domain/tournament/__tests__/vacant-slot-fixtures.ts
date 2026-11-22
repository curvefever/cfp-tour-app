import type { TournamentState } from '../types';

/** The room (1-based) a unit sits in, in a round of a drawn state. */
export function roomOfUnit(state: TournamentState, roundIndex: number, name: string): number {
  const room = (state.assignments[roundIndex] ?? []).find((entry) => entry.name === name)?.room;
  if (room === null || room === undefined) throw new Error(`${name} has no room in round ${roundIndex}`);
  return room;
}
