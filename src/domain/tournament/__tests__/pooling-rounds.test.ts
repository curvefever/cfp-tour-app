import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { QUALIFICATION_ROUNDS, computeSwissRoundCount, groupStageRoundCount } from '../pooling';
import {
  MAX_POOLING_ROUNDS_OVERRIDE,
  parseNonCountingRounds,
  parsePoolingRoundsOverride,
  poolingRoundsOf,
  roundsBeforeBracket,
} from '../pooling-rounds';
import { createDefaultSetup, createDefaultTournamentState, newTournamentSetup } from '../state-defaults';
import type { PersistedSetup } from '../types';
import { buildQualWaterfall } from './qual-waterfall';
import { generatedState, rosterFor, testRuntime, type Setup } from './test-fixtures';

const HEAD_TO_HEAD: Setup = { gameFormat: 'individual-1v1' };

/** A setup whose empty pooling fields take the app's numbers. */
const APP_RULE: Setup = { poolingDefaultsVersion: '1', nonCountingRounds: '' };

const app = (value: number) => ({ value, typed: false });
const typed = (value: number) => ({ value, typed: true });

describe('parseNonCountingRounds', () => {
  it('reads a whole number from 0, undefined for an empty field, null for anything else', () => {
    expect(parseNonCountingRounds('')).toBeUndefined();
    expect(parseNonCountingRounds('0')).toBe(0);
    expect(parseNonCountingRounds('2')).toBe(2);
    for (const raw of ['x', '-1']) expect(parseNonCountingRounds(raw)).toBeNull();
  });
});

describe('poolingRoundsOf', () => {
  const resolve = (overrides: Setup, count: number) => poolingRoundsOf(createDefaultSetup(overrides), count);
  const swiss: Setup = { ...HEAD_TO_HEAD, poolingPhase: 'swiss' };

  it('gives an empty qualification table 4 rounds, the first not counted, under the app rule', () => {
    expect(resolve({ ...APP_RULE, poolingPhase: 'qual-table' }, 37)).toEqual({
      rounds: app(4),
      nonCounting: app(1),
    });
  });

  it('gives it 3 rounds, all counted, without the switch', () => {
    expect(resolve({ poolingPhase: 'qual-table', nonCountingRounds: '' }, 37)).toEqual({
      rounds: app(3),
      nonCounting: app(0),
    });
  });

  it.each([9, 37, 53])('gives an empty Swiss of %i 5 rounds, all counted, under the app rule', (count) => {
    expect(resolve({ ...swiss, ...APP_RULE }, count)).toEqual({ rounds: app(5), nonCounting: app(0) });
  });

  it('takes a Swiss from the field without the switch: 6 rounds at 37', () => {
    expect(resolve({ ...swiss, nonCountingRounds: '' }, 37)).toEqual({
      rounds: app(6),
      nonCounting: app(0),
    });
  });

  it.each(['', '1'])('lets a typed number win (switch "%s")', (poolingDefaultsVersion) => {
    const both = { poolingDefaultsVersion, nonCountingRounds: '1' };
    expect(resolve({ ...both, poolingPhase: 'qual-table', qualRoundsOverride: '2' }, 37)).toEqual({
      rounds: typed(2),
      nonCounting: typed(1),
    });
    expect(resolve({ ...swiss, ...both, swissRoundsOverride: '2' }, 37)).toEqual({
      rounds: typed(2),
      nonCounting: typed(1),
    });
  });

  it('takes a stored 0 without the switch as the older rule’s own number', () => {
    expect(resolve({ poolingPhase: 'qual-table', nonCountingRounds: '0' }, 37).nonCounting).toEqual(app(0));
  });

  it('takes a 0 under the app rule as typed', () => {
    const zero = { ...APP_RULE, poolingPhase: 'qual-table' as const, nonCountingRounds: '0' };
    expect(resolve(zero, 37).nonCounting).toEqual(typed(0));
  });

  it.each([
    ['1', 0],
    ['2', 1],
  ])('keeps one round that counts of the app’s uncounted rounds: %s table rounds', (rounds, uncounted) => {
    const setup: Setup = { ...APP_RULE, poolingPhase: 'qual-table', qualRoundsOverride: rounds };
    expect(resolve(setup, 37).nonCounting).toEqual(app(uncounted));
  });

  it('does not cap a typed number of uncounted rounds', () => {
    const setup: Setup = { ...APP_RULE, poolingPhase: 'qual-table', qualRoundsOverride: '1' };
    expect(resolve({ ...setup, nonCountingRounds: '1' }, 37).nonCounting).toEqual(typed(1));
  });

  it('counts text generation would refuse as an empty field', () => {
    const bad = { ...APP_RULE, poolingPhase: 'qual-table', qualRoundsOverride: '99', nonCountingRounds: 'x' };
    expect(resolve(bad as Setup, 37)).toEqual({ rounds: app(4), nonCounting: app(1) });
  });

  it.each(['', '1'])('has no typed numbers without a table or a Swiss (switch "%s")', (version) => {
    const fields = { poolingDefaultsVersion: version, qualRoundsOverride: '7', nonCountingRounds: '2' };
    expect(resolve({ ...fields, poolingPhase: 'none' }, 37)).toEqual({
      rounds: app(2),
      nonCounting: app(0),
    });
    expect(resolve({ ...HEAD_TO_HEAD, ...fields, poolingPhase: 'group-stage', groupSize: '4' }, 31)).toEqual({
      rounds: app(3),
      nonCounting: app(0),
    });
  });
});

describe('generation plays the pooling numbers of its rule', () => {
  const generate = (count: number, form: ReturnType<typeof createDefaultSetup>) =>
    generateTournament(
      createDefaultTournamentState({
        confirmedCount: count,
        players: rosterFor(form.gameFormat, count),
      }),
      form,
      testRuntime(),
    );

  const uncounted = (rounds: Array<{ excludeFromStandings?: boolean }>) =>
    rounds.map((round) => round.excludeFromStandings === true);

  it('makes 4 table rounds at 37 from a new tournament, the first not counted', () => {
    const state = generatedState(generate(37, newTournamentSetup()));
    expect(uncounted(state.rounds.filter((round) => round.isQual))).toEqual([true, false, false, false]);
    expect(state.gamemodeConfig).toMatchObject({ qualRounds: 4, nonCountingRounds: 1 });
  });

  it.each(['', '0'])('still makes 3, all counted, without the switch (non-counting "%s")', (field) => {
    const stored = createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '', nonCountingRounds: field });
    const state = generatedState(generate(37, stored));
    expect(uncounted(state.rounds.filter((round) => round.isQual))).toEqual([false, false, false]);
    expect(state.gamemodeConfig).toMatchObject({ qualRounds: 3, nonCountingRounds: 0 });
  });

  it.each([9, 37, 53])('makes a Swiss of 5 at %i under the app rule', (count) => {
    const form = createDefaultSetup({ ...HEAD_TO_HEAD, ...APP_RULE, poolingPhase: 'swiss', qualAdv: '' });
    const state = generatedState(generate(count, form));
    expect(uncounted(state.rounds.filter((round) => round.isSwiss))).toEqual(Array(5).fill(false));
  });

  it('makes 1 counted round from a typed 1 table round with the uncounted field empty', () => {
    const state = generatedState(generate(37, { ...newTournamentSetup(), qualRoundsOverride: '1' }));
    expect(uncounted(state.rounds.filter((round) => round.isQual))).toEqual([false]);
    expect(state.gamemodeConfig).toMatchObject({ qualRounds: 1, nonCountingRounds: 0 });
  });

  it('checks the uncounted rounds against the app’s round count', () => {
    const form = { ...newTournamentSetup(), nonCountingRounds: '4' };
    expect(generate(37, form)).toEqual({
      status: 'invalid',
      message:
        'Non-counting rounds (4) must leave at least one round that counts — this Qualification Table phase has 4 rounds total.',
    });
  });
});

describe('parsePoolingRoundsOverride', () => {
  it('reads a whole number from 1 to the ceiling, undefined for no override, null for anything else', () => {
    expect(parsePoolingRoundsOverride('')).toBeUndefined();
    expect(parsePoolingRoundsOverride('4')).toBe(4);
    expect(parsePoolingRoundsOverride(String(MAX_POOLING_ROUNDS_OVERRIDE))).toBe(MAX_POOLING_ROUNDS_OVERRIDE);
    for (const raw of ['0', '13', 'x', '-2']) expect(parsePoolingRoundsOverride(raw)).toBeNull();
  });
});

describe('roundsBeforeBracket', () => {
  const setup = (overrides: Partial<PersistedSetup>) => createDefaultSetup(overrides);

  it('is the qualification rounds, the default 3 or the override', () => {
    expect(roundsBeforeBracket(setup({ poolingPhase: 'qual-table' }), 37)).toBe(QUALIFICATION_ROUNDS);
    expect(roundsBeforeBracket(setup({ poolingPhase: 'qual-table', qualRoundsOverride: '5' }), 37)).toBe(5);
  });

  it('is the Swiss rounds, from the head count unless overridden', () => {
    expect(roundsBeforeBracket(setup({ poolingPhase: 'swiss' }), 37)).toBe(computeSwissRoundCount(37));
    expect(roundsBeforeBracket(setup({ poolingPhase: 'swiss', swissRoundsOverride: '2' }), 37)).toBe(2);
  });

  it('is the two warm-up rounds with no pooling phase, whatever the head count and overrides', () => {
    expect(roundsBeforeBracket(setup({ poolingPhase: 'none', qualRoundsOverride: '5' }), 43)).toBe(2);
  });

  it('counts an override generation would refuse as the default', () => {
    expect(roundsBeforeBracket(setup({ poolingPhase: 'qual-table', qualRoundsOverride: '99' }), 37)).toBe(3);
  });

  it('is the group stage rounds from the group sizes: 3 for groups of 3 or 4, 5 for a group of 5, doubled in a double robin', () => {
    expect(groupStageRoundCount([4, 4, 3], 'single')).toBe(3);
    expect(groupStageRoundCount([5, 4], 'single')).toBe(5);
    expect(groupStageRoundCount([4, 4, 3], 'double')).toBe(6);
    expect(roundsBeforeBracket(setup({ poolingPhase: 'group-stage', groupSize: '4' }), 31)).toBe(3);
  });
});

describe.each([
  ['without the switch', {}],
  ['under the app rule', APP_RULE],
] as Array<[string, Setup]>)(
  'roundsBeforeBracket equals what generation puts before the bracket, %s',
  (_rule, rule) => {
    /** The rounds before the first round that is not a pooling round (a bracket round is never "no elimination"). */
    const poolingRoundCount = (rounds: Array<{ isNoElim: boolean }>) =>
      rounds.findIndex((round) => !round.isNoElim);

    function generate(count: number, overrides: Setup) {
      const form = createDefaultSetup({ qualAdv: '16', ...rule, ...overrides });
      const gameFormat = form.gameFormat;
      const result = generateTournament(
        createDefaultTournamentState({ confirmedCount: count, players: rosterFor(gameFormat, count) }),
        form,
        testRuntime(),
      );
      if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
      return { state: result.state, form };
    }

    const cases: Array<[string, number, Setup]> = [
      ['qualification table, 3 rounds', 37, { poolingPhase: 'qual-table' }],
      ['qualification table, override 5', 43, { poolingPhase: 'qual-table', qualRoundsOverride: '5' }],
      ['Swiss', 31, { ...HEAD_TO_HEAD, poolingPhase: 'swiss' }],
      ['Swiss, 4 rounds', 53, { ...HEAD_TO_HEAD, poolingPhase: 'swiss', swissRoundsOverride: '4' }],
      ['group stage of 31 units in groups of 4', 31, groupStage('4')],
      ['group stage of 37 units in groups of 4', 37, groupStage('4')],
      ['double round robin, 37 units in groups of 4', 37, { ...groupStage('4'), roundRobinMode: 'double' }],
      ['no pooling phase: the 2 warm-up rounds', 37, { poolingPhase: 'none' }],
    ];

    it.each(cases)('%s', (_name, count, overrides) => {
      const { state, form } = generate(count, overrides);
      const before = poolingRoundCount(state.rounds);
      expect(before).toBe(roundsBeforeBracket(form, count));
      expect(state.rounds[before].roundNum).toBe(before + 1);
    });

    function groupStage(groupSize: string): Setup {
      return {
        ...HEAD_TO_HEAD,
        poolingPhase: 'group-stage',
        groupSize,
        qualifiersPerGroup: '2',
        qualAdv: '2',
      };
    }
  },
);

describe('roundsBeforeBracket under a Custom bracket', () => {
  it('is the same count the waterfall bracket starts after (a Custom bracket after the qualification table)', () => {
    const state = buildQualWaterfall(37);
    const first = state.rounds.findIndex((round) => round.isWaterfall);
    expect(first).toBe(roundsBeforeBracket(createDefaultSetup({ poolingPhase: 'qual-table' }), 37));
    expect(state.rounds[first].roundNum).toBe(first + 1);
  });
});
