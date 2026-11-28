import { groupSettingsOf, groupSizesOf } from './group-settings';
import { QUALIFICATION_ROUNDS, computeSwissRoundCount, groupStageRoundCount, WARMUP_ROUNDS } from './pooling';
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

/** The leading rounds a "Non-counting rounds" field asks for; null when it is not a whole number of 0 or more. Empty text asks for nothing (`undefined`). */
export function parseNonCountingRounds(raw: string): number | null | undefined {
  if (!raw) return undefined;
  const parsedValue = Number.parseInt(raw, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null;
}

/** The app's own numbers for empty fields in a setup with `poolingDefaultsVersion`. A Swiss's rounds don't follow the field size there. */
const APP_QUAL_TABLE = { rounds: 4, nonCounting: 1 };
const APP_SWISS = { rounds: 5, nonCounting: 0 };

/** Whether an empty pooling field takes the numbers above. A setup without the switch (stored before it) keeps 3 table rounds, a Swiss's rounds from the field and nothing uncounted. */
export const usesAppPoolingDefaults = (setup: Pick<PersistedSetup, 'poolingDefaultsVersion'>): boolean =>
  setup.poolingDefaultsVersion === '1';

type PoolingRoundsSetup = Pick<
  PersistedSetup,
  | 'poolingPhase'
  | 'poolingDefaultsVersion'
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'nonCountingRounds'
  | 'groupSize'
  | 'roundRobinMode'
>;

/** A pooling number in force, and whether the organiser typed it (else it is the app's). */
export interface PoolingNumber {
  value: number;
  typed: boolean;
}

export interface PoolingRounds {
  rounds: PoolingNumber;
  /** The leading rounds that don't count. Only a qualification table and a Swiss have them. */
  nonCounting: PoolingNumber;
}

/** The typed number when the field holds a valid one, else the app's. */
function typedOr(typed: number | null | undefined, appValue: number): PoolingNumber {
  return typeof typed === 'number' ? { value: typed, typed: true } : { value: appValue, typed: false };
}

/** A qualification table or a Swiss: each of its two fields, typed or the app's. */
function standingsRounds(
  override: string,
  nonCountingField: string,
  app: { rounds: number; nonCounting: number },
): PoolingRounds {
  return {
    rounds: typedOr(parsePoolingRoundsOverride(override), app.rounds),
    nonCounting: typedOr(parseNonCountingRounds(nonCountingField), app.nonCounting),
  };
}

/** A group stage or no pooling phase: no field to type either number in. */
function fixedRounds(rounds: number): PoolingRounds {
  return { rounds: { value: rounds, typed: false }, nonCounting: { value: 0, typed: false } };
}

/**
 * The pooling rounds and the leading ones that don't count, for the form and the head count. A field generation would
 * refuse counts as empty here: the refusal is generation's.
 */
export function poolingRoundsOf(setup: PoolingRoundsSetup, entrantCount: number): PoolingRounds {
  const appDefaults = usesAppPoolingDefaults(setup);
  switch (setup.poolingPhase) {
    case 'qual-table':
      return standingsRounds(
        setup.qualRoundsOverride,
        setup.nonCountingRounds,
        appDefaults ? APP_QUAL_TABLE : { rounds: QUALIFICATION_ROUNDS, nonCounting: 0 },
      );
    case 'swiss':
      return standingsRounds(
        setup.swissRoundsOverride,
        setup.nonCountingRounds,
        appDefaults ? APP_SWISS : { rounds: computeSwissRoundCount(entrantCount), nonCounting: 0 },
      );
    case 'group-stage':
      return fixedRounds(
        groupStageRoundCount(
          groupSizesOf(entrantCount, groupSettingsOf(setup).groupSize),
          setup.roundRobinMode,
        ),
      );
    case 'none':
      return fixedRounds(WARMUP_ROUNDS);
  }
}

/**
 * How many rounds are played before the bracket's first round: the qualification rounds, the Swiss rounds, the
 * group stage's rounds (from the group sizes, so from the head count) or, with no pooling phase, the 2 warm-up
 * rounds. The bracket's first round is the next number. Generation builds the same rounds, so this is the same
 * count as `startRoundNum - 1` there (a test pins it).
 */
export function roundsBeforeBracket(setup: PoolingRoundsSetup, entrantCount: number): number {
  return poolingRoundsOf(setup, entrantCount).rounds.value;
}
