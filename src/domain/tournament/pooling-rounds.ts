import { groupSizesOf } from './group-exit';
import {
  GROUP_SIZE_BOUNDS,
  QUALIFICATION_ROUNDS,
  computeSwissRoundCount,
  groupStageRoundCount,
  WARMUP_ROUNDS,
} from './pooling';
import type { PersistedSetup } from './types';

/** Sanity ceiling for a manually-overridden pooling-phase round count, matching single-elimination.ts's own MAX_ELIMINATION_ROUNDS-style cap. */
export const MAX_POOLING_ROUNDS_OVERRIDE = 12;

/** The round count an override field asks for; null when it is not a whole number from 1 to the ceiling. Empty text is no override (`undefined`). */
export function parsePoolingRoundsOverride(raw: string): number | null | undefined {
  if (!raw) return undefined;
  const parsedValue = Number.parseInt(raw, 10);
  const valid =
    Number.isFinite(parsedValue) && parsedValue >= 1 && parsedValue <= MAX_POOLING_ROUNDS_OVERRIDE;
  return valid ? parsedValue : null;
}

type PoolingRoundsSetup = Pick<
  PersistedSetup,
  'poolingPhase' | 'qualRoundsOverride' | 'swissRoundsOverride' | 'groupSize' | 'roundRobinMode'
>;

/**
 * How many rounds are played before the bracket's first round: the qualification rounds, the Swiss rounds, the
 * group stage's rounds (from the group sizes, so from the head count) or, with no pooling phase, the 2 warm-up
 * rounds. The bracket's first round is the next number. Generation builds the same rounds, so this is the same
 * count as `startRoundNum - 1` there (a test pins it); an override generation would refuse counts as the default.
 */
export function roundsBeforeBracket(setup: PoolingRoundsSetup, entrantCount: number): number {
  switch (setup.poolingPhase) {
    case 'qual-table':
      return parsePoolingRoundsOverride(setup.qualRoundsOverride) ?? QUALIFICATION_ROUNDS;
    case 'swiss':
      return parsePoolingRoundsOverride(setup.swissRoundsOverride) ?? computeSwissRoundCount(entrantCount);
    case 'group-stage':
      return groupStageRoundCount(
        groupSizesOf(entrantCount, Number.parseInt(setup.groupSize, 10) || GROUP_SIZE_BOUNDS.ideal),
        setup.roundRobinMode,
      );
    case 'none':
      return WARMUP_ROUNDS;
  }
}
