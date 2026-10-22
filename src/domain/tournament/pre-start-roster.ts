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

const sameKeys = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

/**
 * True unless the drawn schedule no longer fits the roster: round 1's seats plus byes (and a fixed draw's
 * published round 1) are exactly the roster's units. A tournament with nothing drawn yet has nothing to be
 * stale. The head count the schedule was built for (`cfg.n`) is not compared: a pre-start removal whose
 * redraw was refused leaves a short room on purpose, and the organiser can still start it.
 */
export function scheduleMatchesRoster(state: TournamentState): boolean {
  if (!state.rounds.length) return true;
  const roster = rosterKeys(state.players);
  // A bye unit is both in the assignments (room null) and on the bye list.
  const seated = [
    ...new Set([...(state.assignments[0] ?? []).map((entry) => entry.name), ...(state.byes[0] ?? [])]),
  ];
  if (!sameKeys(seated, roster)) return false;
  const fixed = state.rounds[0].fixedRoomAssignments;
  return (
    !fixed ||
    sameKeys(
      fixed.map((entry) => entry.name),
      roster,
    )
  );
}

export const STALE_DRAW_MESSAGE =
  'The roster changed since the schedule was generated — click Generate again before starting.';

/** Confirm & Start's refusal of a draw that no longer fits the roster; null when it fits. */
export function staleDrawRefusal(state: TournamentState): string | null {
  return scheduleMatchesRoster(state) ? null : STALE_DRAW_MESSAGE;
}
