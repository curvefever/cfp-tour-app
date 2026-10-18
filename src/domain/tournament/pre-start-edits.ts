import { removeRosterUnit, withLoadedRoster, withoutDrawnSchedule } from './mutations';
import { regenerateForRoster } from './pre-start-roster';
import { rosterKeys } from './roster';
import type { TournamentRuntime } from './runtime';
import { readTournamentSettings } from './tournament-settings';
import type { GameFormatKey, TournamentState } from './types';

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

const FORMAT_CHANGED = 'The game format changed, so the drawn schedule no longer fits.';
const NO_SETTINGS = 'This schedule was generated before its settings were stored, so it cannot be redone.';

/**
 * Loads a roster in Setup. A roster loaded after Generate gives every unit a new id, so the drawn schedule
 * would seat ids that are no longer on the roster: before the start the schedule is redone for the new
 * roster, or dropped (the organiser generates again) when it can't be. `redrawRefusal` says why.
 */
export function reloadRosterBeforeStart(
  state: TournamentState,
  gameFormat: GameFormatKey,
  loaded: Pick<TournamentState, 'players' | 'reserves' | 'reserveIndividuals'>,
  runtime: TournamentRuntime,
): PreStartEdit {
  const reloaded = withLoadedRoster(state, gameFormat, loaded);
  if (!state.rounds.length) return { state: reloaded };
  const dropped = (redrawRefusal: string): PreStartEdit => ({
    state: withoutDrawnSchedule(reloaded),
    redrawRefusal,
  });
  const settings = readTournamentSettings(state.settings);
  if (!settings) return dropped(NO_SETTINGS);
  if (settings.gameFormat !== gameFormat) return dropped(FORMAT_CHANGED);
  const regenerated = regenerateForRoster(reloaded, runtime);
  if (regenerated.status === 'generated') return { state: regenerated.state };
  return dropped(regenerated.status === 'invalid' ? regenerated.message : NO_SETTINGS);
}
