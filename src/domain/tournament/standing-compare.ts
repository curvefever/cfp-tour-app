import type { TournamentStanding } from './types';

/** How two standings compare: the tolerance that makes shares and points equal, the value standings are ranked by, and their order. */

/** Room shares and points closer than this count as equal (floating-point ratios and sums of shared-place averages). */
const EQUALITY_TOLERANCE = 1e-9;

/** Equal within the tolerance; a missing value is null and equals only another null. */
function sameWithinTolerance(first: number | null, second: number | null): boolean {
  if (first === null || second === null) return first === second;
  return Math.abs(first - second) < EQUALITY_TOLERANCE;
}

/** Room shares are equal; a missing share (a snapshot that did not record it) is null and equals only another null. */
export const sameRoomShare = sameWithinTolerance;

/** Points totals are equal (a shared place can make a total fractional); a missing total (nothing played) is null and equals only another null. */
export const samePoints = sameWithinTolerance;

/** The one value standings are ranked by: points per match in a group stage with per-match standings, the points total everywhere else. Null until the unit has a result. */
export function rankingPoints(standing: TournamentStanding): number | null {
  return standing.averagePoints ?? standing.totalFP;
}

/** Equal standing points and equal average room share: the only case where two units share a rank or form a cut-off tie. A missing share (a snapshot that did not record it) counts as null. */
export function sameStanding(first: TournamentStanding, second: TournamentStanding): boolean {
  if (!samePoints(rankingPoints(first), rankingPoints(second))) return false;
  return sameRoomShare(first.roomShare ?? null, second.roomShare ?? null);
}

/** Best-first order: unplayed (null points) last, then more points, then higher average room share. Both scoring systems are higher-is-better sums, and every table downstream of materializeStandings()'s own sort assumes an already-sorted, best-first table. */
export function compareStandings(first: TournamentStanding, second: TournamentStanding): number {
  const firstPoints = rankingPoints(first);
  const secondPoints = rankingPoints(second);
  if (firstPoints === null && secondPoints === null) return 0;
  if (firstPoints === null) return 1;
  if (secondPoints === null) return -1;
  if (!samePoints(firstPoints, secondPoints)) return secondPoints - firstPoints;
  if (sameStanding(first, second)) return 0;
  return (second.roomShare ?? 0) - (first.roomShare ?? 0);
}
