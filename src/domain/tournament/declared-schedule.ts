import type { TournamentState } from './types';

/**
 * The state as the schedule declares it: no line-up in any round, so every room reads at its declared size and the
 * exit rules (`roundExitRule`, `roundExitGroups`) describe the routes of `state.rounds` and nothing that was drawn.
 * A removal in a drawn round, which shrinks a room's line-up, then changes nothing in what is described.
 */
export function declaredSchedule(state: TournamentState): TournamentState {
  return { ...state, assignments: state.assignments.map(() => []) };
}
