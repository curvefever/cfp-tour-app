import { removeRosterUnit } from './mutations';
import { regenerateForRoster } from './pre-start-roster';
import { rosterKeys } from './roster';
import type { TournamentRuntime } from './runtime';
import type { TournamentState } from './types';

/** The state after a pre-start roster edit, and why the schedule could not be redrawn (when it could not). */
export interface PreStartEdit {
  state: TournamentState;
  redrawRefusal?: string;
}

const withRosterCount = (state: TournamentState): TournamentState => ({
  ...state,
  confirmedCount: rosterKeys(state.players).length,
});

/**
 * Removes a unit before Confirm & Start. `removeRosterUnit` records the withdrawal (the unit shows in
 * NO-SHOWS) and strips it; with a schedule drawn, the schedule is then redone for the smaller roster. A
 * removal is never refused: when generation can't redraw (below the format's minimum, a graph built for
 * the exact count), the plain removal stands (Round 1 keeps a short room) and `redrawRefusal` says why.
 */
export function removeUnitBeforeStart(
  state: TournamentState,
  key: string,
  runtime: TournamentRuntime,
): PreStartEdit {
  const removed = removeRosterUnit(state, key);
  if (!state.rounds.length) return { state: withRosterCount(removed) };
  const regenerated = regenerateForRoster(removed, runtime);
  if (regenerated.status === 'generated') return { state: regenerated.state };
  if (regenerated.status === 'invalid') {
    return { state: withRosterCount(removed), redrawRefusal: regenerated.message };
  }
  return { state: withRosterCount(removed) };
}
