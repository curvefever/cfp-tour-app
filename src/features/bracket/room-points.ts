import type { StandingsDisplay } from '../../domain/tournament/standings-display';

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
