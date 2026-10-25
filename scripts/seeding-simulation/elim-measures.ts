import type { EliminationRound } from './elimination';

/**
 * The two main numbers of the study for one rule and one round: the room gap (percentage points, 0 = fair) and the
 * true top-k kept. The gap is measured only for the units whose true rank is within W of the cut (W = the largest room
 * size): away from the cut a gap changes nothing. Everything here is plain data so a job's result can be saved.
 */

export interface RankCounts {
  /** Units that had the advantage (a smaller room) at this true rank, and how many advanced. */
  advantaged: number;
  advantagedWon: number;
  others: number;
  othersWon: number;
}

export interface Accumulator {
  /** By true rank. */
  ranks: Record<string, RankCounts>;
  /** Of the k truly strongest units, summed over runs, how many advanced. */
  kept: number;
  runs: number;
  /** Per-run difference of `kept` to the reference option's (the same run, the same strengths). */
  difference: { sum: number; sumSquares: number; count: number };
}

export function emptyAccumulator(): Accumulator {
  return { ranks: {}, kept: 0, runs: 0, difference: { sum: 0, sumSquares: 0, count: 0 } };
}

export function largestRoom(round: EliminationRound): number {
  return Math.max(...round.units.map((unit) => unit.roomSize));
}

/** One unit at the cut: its true rank among the units competing, whether it had the advantage, whether it advanced or qualified. */
export interface Observation {
  trueRank: number;
  advantaged: boolean;
  won: boolean;
}

/** Adds one round, or one qualification, of observations; `k` units advance, and the bubble reaches `window` ranks either side of the cut. Returns the true top-k kept this time. */
export function addObservations(
  accumulator: Accumulator,
  observations: Observation[],
  k: number,
  window: number,
): number {
  let kept = 0;
  for (const { trueRank, advantaged, won } of observations) {
    if (trueRank <= k && won) kept += 1;
    if (trueRank < k - window + 1 || trueRank > k + window) continue;
    const counts = accumulator.ranks[trueRank] ?? {
      advantaged: 0,
      advantagedWon: 0,
      others: 0,
      othersWon: 0,
    };
    if (advantaged) {
      counts.advantaged += 1;
      if (won) counts.advantagedWon += 1;
    } else {
      counts.others += 1;
      if (won) counts.othersWon += 1;
    }
    accumulator.ranks[trueRank] = counts;
  }
  accumulator.kept += kept;
  accumulator.runs += 1;
  return kept;
}

/** Notes how many more (or fewer) true top-k units an option kept than the reference did in the same run. */
export function recordDifference(accumulator: Accumulator, kept: number, referenceKept: number): void {
  const difference = kept - referenceKept;
  accumulator.difference.sum += difference;
  accumulator.difference.sumSquares += difference * difference;
  accumulator.difference.count += 1;
}

export function addRound(
  accumulator: Accumulator,
  round: EliminationRound,
  advantaged: Set<string>,
  advancing: Set<string>,
): number {
  const observations = round.units.map((unit) => ({
    trueRank: unit.trueRank,
    advantaged: advantaged.has(unit.name),
    won: advancing.has(unit.name),
  }));
  return addObservations(accumulator, observations, round.engine.size, largestRoom(round));
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
  /** Mean per-run difference to the reference option, and two standard errors of it; NaN when none was recorded. */
  keptDifference: number;
  keptDifferenceError: number;
}

export function summarise(accumulator: Accumulator): Summary {
  let gapSum = 0;
  let varianceSum = 0;
  let used = 0;
  let skipped = 0;
  for (const counts of Object.values(accumulator.ranks)) {
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
  const { sum, sumSquares, count } = accumulator.difference;
  const mean = count === 0 ? Number.NaN : sum / count;
  const variance = count < 2 ? Number.NaN : (sumSquares - count * mean * mean) / (count - 1);
  return {
    gap: used === 0 ? Number.NaN : (100 * gapSum) / used,
    error: used === 0 ? Number.NaN : (200 * Math.sqrt(varianceSum)) / used,
    ranks: used,
    skipped,
    kept: accumulator.kept / Math.max(accumulator.runs, 1),
    keptDifference: mean,
    keptDifferenceError: 2 * Math.sqrt(Math.max(variance, 0) / Math.max(count, 1)),
  };
}
