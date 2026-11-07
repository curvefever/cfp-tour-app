import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { QUALIFICATION_ROUNDS, computeSwissRoundCount, groupStageRoundCount } from '../pooling';
import {
  MAX_POOLING_ROUNDS_OVERRIDE,
  parsePoolingRoundsOverride,
  roundsBeforeBracket,
} from '../pooling-rounds';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { PersistedSetup } from '../types';
import { buildQualWaterfall } from './qual-waterfall';
import { rosterFor, testRuntime, type Setup } from './test-fixtures';

const HEAD_TO_HEAD: Setup = { gameFormat: 'individual-1v1' };

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

describe('roundsBeforeBracket equals what generation puts before the bracket', () => {
  /** The rounds before the first round that is not a pooling round (a bracket round is never "no elimination"). */
  const poolingRoundCount = (rounds: Array<{ isNoElim: boolean }>) =>
    rounds.findIndex((round) => !round.isNoElim);

  function generate(count: number, overrides: Setup) {
    const form = createDefaultSetup({ qualAdv: '16', ...overrides });
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
    return { ...HEAD_TO_HEAD, poolingPhase: 'group-stage', groupSize, qualifiersPerGroup: '2', qualAdv: '2' };
  }

  it('is the same count the waterfall bracket starts after (a Custom bracket after the qualification table)', () => {
    const state = buildQualWaterfall(37);
    const first = state.rounds.findIndex((round) => round.isWaterfall);
    expect(first).toBe(roundsBeforeBracket(createDefaultSetup({ poolingPhase: 'qual-table' }), 37));
    expect(state.rounds[first].roundNum).toBe(first + 1);
  });
});
