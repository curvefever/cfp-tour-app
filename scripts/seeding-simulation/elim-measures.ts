import type { EliminationRound } from './elimination';

/**
 * The two main numbers of the study for one rule and one round: the room gap (percentage points, 0 = fair) and the
 * true top-k kept. The gap is measured only for the units whose true rank is within W of the cut (W = the largest room
 * size): away from the cut a gap changes nothing.
 */

export interface RankCounts {
  /** Units that had the advantage (a smaller room) at this true rank, and how many advanced. */
  advantaged: number;
  advantagedWon: number;
  others: number;
  othersWon: number;
}

export interface Accumulator {
  ranks: Map<number, RankCounts>;
  /** Of the k truly strongest units, summed over runs, how many advanced. */
  kept: number;
  runs: number;
}

export function emptyAccumulator(): Accumulator {
  return { ranks: new Map(), kept: 0, runs: 0 };
}

export function largestRoom(round: EliminationRound): number {
  return Math.max(...round.units.map((unit) => unit.roomSize));
}

export function addRound(
  accumulator: Accumulator,
  round: EliminationRound,
  advantaged: Set<string>,
  advancing: Set<string>,
): void {
  const k = round.engine.size;
  const window = largestRoom(round);
  for (const unit of round.units) {
    const won = advancing.has(unit.name);
    if (unit.trueRank <= k && won) accumulator.kept += 1;
    if (unit.trueRank < k - window + 1 || unit.trueRank > k + window) continue;
    const counts = accumulator.ranks.get(unit.trueRank) ?? {
      advantaged: 0,
      advantagedWon: 0,
      others: 0,
      othersWon: 0,
    };
    if (advantaged.has(unit.name)) {
      counts.advantaged += 1;
      if (won) counts.advantagedWon += 1;
    } else {
      counts.others += 1;
      if (won) counts.othersWon += 1;
    }
    accumulator.ranks.set(unit.trueRank, counts);
  }
  accumulator.runs += 1;
}

export interface Summary {
  /** Percentage points; NaN when no rank had both groups. */
  gap: number;
  /** Two standard errors, percentage points. */
  error: number;
  /** Ranks used, and ranks skipped because one group was empty in every run. */
  ranks: number;
  skipped: number;
  /** Mean of the true top-k kept per run. */
  kept: number;
}

export function summarise(accumulator: Accumulator): Summary {
  let gapSum = 0;
  let varianceSum = 0;
  let used = 0;
  let skipped = 0;
  for (const counts of accumulator.ranks.values()) {
    if (counts.advantaged === 0 || counts.others === 0) {
      skipped += 1;
      continue;
    }
    const a = counts.advantagedWon / counts.advantaged;
    const b = counts.othersWon / counts.others;
    gapSum += a - b;
    varianceSum += (a * (1 - a)) / counts.advantaged + (b * (1 - b)) / counts.others;
    used += 1;
  }
  return {
    gap: used === 0 ? Number.NaN : (100 * gapSum) / used,
    error: used === 0 ? Number.NaN : (200 * Math.sqrt(varianceSum)) / used,
    ranks: used,
    skipped,
    kept: accumulator.kept / Math.max(accumulator.runs, 1),
  };
}
