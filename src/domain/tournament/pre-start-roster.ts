import { generateTournament } from './generation';
import { rosterKeys } from './roster';
import type { TournamentRuntime } from './runtime';
import { createDefaultSetup } from './state-defaults';
import { applyTournamentSettings, readTournamentSettings } from './tournament-settings';
import type { TournamentState } from './types';

export type RegenerateResult =
  | { status: 'generated'; state: TournamentState }
  | { status: 'invalid'; message: string }
  | { status: 'no-settings' };

/**
 * Before Confirm & Start nobody but admins has seen the draw, so a roster change redoes it: the schedule
 * is rebuilt for the current roster from the settings it was generated with (`state.settings`, not the
 * Setup form's current values). Generation is the only judge here. `no-settings` is a tournament
 * generated before settings were stored.
 */
export function regenerateForRoster(state: TournamentState, runtime: TournamentRuntime): RegenerateResult {
  const settings = readTournamentSettings(state.settings);
  if (!settings) return { status: 'no-settings' };
  const form = {
    ...applyTournamentSettings(createDefaultSetup(), settings),
    lbQualifiers: settings.lbQualifiers,
  };
  const current = { ...state, confirmedCount: rosterKeys(state.players).length };
  return generateTournament(current, form, runtime);
}
