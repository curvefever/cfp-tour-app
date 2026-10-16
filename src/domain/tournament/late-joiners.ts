import { rosterKeys } from './roster';
import type { TournamentState } from './types';

/**
 * The late joiners of a pooling round: roster units that are neither seated in it nor on its bye. They
 * were added to the roster after the round was drawn, so they sit it out and are drawn in by the next
 * round. In roster (add) order. Empty for any round that is not a no-elimination pooling round: a unit
 * missing from a bracket round is waiting in a pool or out, not joining.
 */
export function lateJoinersOf(
  state: Pick<TournamentState, 'rounds' | 'assignments' | 'byes' | 'players'>,
  roundIndex: number,
): string[] {
  const round = state.rounds[roundIndex];
  if (!round?.isNoElim || round.isGroupStage) return [];
  const placed = new Set([
    ...(state.assignments[roundIndex] ?? []).map((entry) => entry.name),
    ...(state.byes[roundIndex] ?? []),
  ]);
  return rosterKeys(state.players).filter((name) => !placed.has(name));
}
