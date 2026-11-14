import type { TournamentState } from '../../domain/tournament/types';

/**
 * A copy of the state with nothing that names a unit in a round: no line-ups, byes, pending pools, fixed draws or
 * group-stage pairings. The Bracket's preview before the start (a published tournament seen by a viewer) is drawn
 * from it, so every room shows "—" seats and every later round its slot labels. The input is not changed.
 */
export function withoutDraw(state: TournamentState): TournamentState {
  return {
    ...state,
    assignments: state.assignments.map(() => []),
    byes: state.byes.map(() => []),
    luckyLosers: state.luckyLosers.map(() => []),
    pendingBracketSeeds: {},
    rounds: state.rounds.map(
      ({ fixedRoomAssignments: _fixed, matches: _matches, groupByes: _groupByes, ...round }) => round,
    ),
  };
}

/** Whether the Bracket is the draw-free preview: the tournament has not started and the visitor is a viewer. */
export function isDrawPreview(state: Pick<TournamentState, 'started'>, isViewer: boolean): boolean {
  return isViewer && !state.started;
}
