import { getGameFormat } from '../../domain/tournament/formats';
import { rosterKeys } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';

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
