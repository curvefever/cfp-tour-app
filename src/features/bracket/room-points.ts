import { groupSeats } from '../../domain/tournament/group-standings';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';

/** The map also answers to the names of the units swapped out of a seat: a past room still names the team that played it, the standings its holder now. */
export function withSwappedNames<T>(
  map: Map<string, T>,
  state: Pick<TournamentState, 'withdrawnUnits' | 'rounds'>,
): Map<string, T> {
  const seats = groupSeats(state);
  for (const unit of state.withdrawnUnits) {
    const value = unit.reason === 'swapped' ? map.get(seats.holderOf(unit.name)) : undefined;
    if (value !== undefined && !map.has(unit.name)) map.set(unit.name, value);
  }
  return map;
}

/**
 * The points each unit earned in one counted round, by name -- read from the standings display, which counts a
 * room only once it is fully scored, so a room still being played has no entry. A bye earns points too but sits
 * in no room, so it is left out.
 */
export function roomPoints(display: StandingsDisplay | null, roundIndex: number): Map<string, number> {
  const points = new Map<string, number>();
  for (const table of display?.tables ?? []) {
    for (const entry of table.entries) {
      const result = entry.rounds?.find((candidate) => candidate.roundIndex === roundIndex);
      if (result && !result.bye) points.set(entry.name, result.points);
    }
  }
  return points;
}

/**
 * The result of each unit's game(s) in one counted round, by name, as "W · TL" (match-result scoring only: a round
 * scored by places has none), read from the same standings display.
 */
export function roomResultCodes(display: StandingsDisplay | null, roundIndex: number): Map<string, string> {
  const codes = new Map<string, string>();
  for (const table of display?.tables ?? []) {
    for (const entry of table.entries) {
      const result = entry.rounds?.find((candidate) => candidate.roundIndex === roundIndex);
      if (result?.results?.length) codes.set(entry.name, result.results.join(' · '));
    }
  }
  return codes;
}
