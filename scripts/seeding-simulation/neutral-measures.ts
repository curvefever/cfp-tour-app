import type { RankCounts } from './elim-measures';
import type { RoundShape } from './run-e';

/** Readings of the neutral-cut study that are not the study's gap and top-k kept (`plans/2026-10-25-neutral-elimination-cut.md`). */

export interface AllUnitsGap {
  /** Percentage points: chance to advance in the smaller rooms minus the larger; NaN when a group is empty. */
  gap: number;
  /** Two standard errors, treating units as independent. */
  error: number;
}

export function allUnitsGap(counts: RankCounts): AllUnitsGap {
  if (counts.advantaged === 0 || counts.others === 0) return { gap: Number.NaN, error: Number.NaN };
  const a = counts.advantagedWon / counts.advantaged;
  const b = counts.othersWon / counts.others;
  const variance = (a * (1 - a)) / counts.advantaged + (b * (1 - b)) / counts.others;
  return { gap: 100 * (a - b), error: 200 * Math.sqrt(variance) };
}

/** The smaller rooms' fair share of the eliminations: its whole part, and the fractional part that the leftover elimination should follow. */
export function fairShare(shape: RoundShape): { fair: number; fraction: number } | null {
  const units = shape.rooms.reduce((sum, size) => sum + size, 0);
  const smallest = Math.min(...shape.rooms);
  if (smallest === Math.max(...shape.rooms)) return null;
  const inSmall = shape.rooms.filter((size) => size === smallest).length * smallest;
  const exact = ((units - shape.k) * inSmall) / units;
  return { fair: exact, fraction: exact - Math.floor(exact) };
}
