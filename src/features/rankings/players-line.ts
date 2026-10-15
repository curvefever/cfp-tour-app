import { getGameFormat } from '../../domain/tournament/formats';
import { rosterKeys, unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import type { ColumnRow } from './ColumnRows';
import { naturalByLabel } from './ranking-order';

/**
 * The line over the roster before the start: "37 players registered so far · starts Sat 18 Oct, 20:00" ("13 teams
 * registered so far" for a team format, "1 player" for one). Without a date it stops after "so far".
 */
export function registeredLine(state: TournamentState, startsAt: string | null): string {
  const count = rosterKeys(state.players).length;
  const format = getGameFormat(state.gameFormat);
  const unit = (
    count === 1 ? (format?.unitLabel ?? 'Player') : (format?.unitLabelPlural ?? 'Players')
  ).toLowerCase();
  const registered = `${count} ${unit} registered so far`;
  return startsAt ? `${registered} · starts ${startsAt}` : registered;
}

/**
 * The numbered lines of a roster list. The roster goes alphabetical by the name shown (a team by its team name, "Player 9"
 * before "Player 10"); the reserves keep the order they joined the waiting list in, because the first one is called first.
 */
export function rosterRows(
  state: TournamentState,
  names: string[],
  order: 'alphabetical' | 'as-listed',
): ColumnRow[] {
  const units = names.map((name) => ({ name, ...unitDisplay(state, name) }));
  const ordered = order === 'alphabetical' ? naturalByLabel(units) : units;
  return ordered.map((unit, index) => ({
    key: unit.name,
    number: String(index + 1),
    label: unit.label,
    members: unit.members,
  }));
}
