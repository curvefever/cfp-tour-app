import { describe, expect, it } from 'vitest';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import type { Setup } from '../../domain/tournament/__tests__/test-fixtures';
import type { TournamentState } from '../../domain/tournament/types';
import { modelOf } from './schedule-picture-test-support';

const afterLast = (state: TournamentState) =>
  modelOf(state).pooling?.afterLast.map((block) => [block.tones[0], block.lines[0]]);

const GROUPS: Setup = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'group-stage',
  oddCountStrategy: 'bye',
  scheduleLogic: 'single-elimination',
  groupSize: '4',
};

describe('the pooling block of a qualification table', () => {
  it('names the phase, the rounds and games, the rooms and which rounds count', () => {
    const pooling = modelOf(generated(37, { scheduleLogic: 'single-elimination', qualAdv: '16' })).pooling;
    expect(pooling?.title).toBe('Qualification table');
    expect(pooling?.lines).toEqual(['Rounds 1–3 · 1 game each', '5 rooms · 8p and 7p', 'Every round counts']);
  });

  it('says which rounds do not count', () => {
    const state = generated(37, {
      scheduleLogic: 'single-elimination',
      qualAdv: '16',
      nonCountingRounds: '1',
    });
    expect(modelOf(state).pooling?.lines[2]).toBe('Round 1 not counted');
  });

  it('writes the cut: the first so many go on, the rest are out', () => {
    expect(afterLast(generated(37, { scheduleLogic: 'single-elimination', qualAdv: '16' }))).toEqual([
      ['green', '1st–16th → Semis'],
      ['red', '17th–last out'],
    ]);
  });

  it('one note line per round that has a note, apart from the fixed lines', () => {
    const state = generated(37, { scheduleLogic: 'single-elimination', qualAdv: '16' });
    const noted = {
      ...state,
      info: { ...state.info!, roundNotes: { 'Round 2': 'Same lobby **settings**\nas round 1' } },
    };
    const pooling = modelOf(noted).pooling;
    expect(pooling?.lines).toEqual(['Rounds 1–3 · 1 game each', '5 rooms · 8p and 7p', 'Every round counts']);
    expect(pooling?.notes).toEqual(['Round 2: Same lobby settings as round 1']);
  });
});

describe('the pooling block of the other phases', () => {
  it('a warm-up: not counted, and everyone goes on', () => {
    const pooling = modelOf(
      generated(20, { poolingPhase: 'none', scheduleLogic: 'single-elimination' }),
    ).pooling;
    expect(pooling?.title).toBe('Warm-up');
    expect(pooling?.lines).toEqual(['Rounds 1–2 · 1 game each', '3 rooms · 7p and 6p', 'Not counted']);
    expect(pooling?.afterLast).toEqual([{ tones: ['green'], lines: ['Everyone → Round 3'] }]);
  });

  it('a Swiss: its rooms of two', () => {
    const state = generated(11, { ...GROUPS, poolingPhase: 'swiss', qualAdv: '4' });
    const pooling = modelOf(state).pooling;
    expect(pooling?.title).toBe('Swiss');
    expect(pooling?.lines).toEqual(['Rounds 1–4 · 1 game each', '5 matches a round', 'Every round counts']);
    expect(afterLast(state)).toEqual([
      ['green', '1st–4th → Semis'],
      ['red', '5th–last out'],
    ]);
  });

  it('a group stage that sends so many per group: the groups, then each group and the others', () => {
    const state = generated(13, { ...GROUPS, qualAdv: '4', qualifiersPerGroup: '2', groupExit: 'per-group' });
    const pooling = modelOf(state).pooling;
    expect(pooling?.title).toBe('Group stage');
    expect(pooling?.lines[1]).toBe('Groups of 5, 4, 4 · 6 matches a round');
    expect(afterLast(state)).toEqual([
      ['green', '1st–2nd of each group → Round 6'],
      ['red', 'the others out'],
    ]);
  });

  it('a group stage that sends a total: the wording of the group exit lines', () => {
    const state = generated(13, { ...GROUPS, qualAdv: '6', groupExit: 'fair-cut' });
    const blocks = modelOf(state).pooling?.afterLast ?? [];
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]).toMatchObject({ tones: ['green'] });
    expect(blocks.map((block) => block.lines[0])).toEqual([
      '1–2 (group of 5) → Round 6',
      '1 (each group of 4) → Round 6',
      '3rd (group of 5) 0–1 spot',
      '2nd (each group of 4) 1–2 spots',
      'rest out',
    ]);
    expect(blocks.map((block) => block.tones.join('/'))).toEqual([
      'green',
      'green',
      'green/red',
      'green/red',
      'red',
    ]);
  });

  it('a group stage that sends an even split: one line for the direct places', () => {
    const blocks = modelOf(generated(13, { ...GROUPS, qualAdv: '6', groupExit: 'even-split' })).pooling
      ?.afterLast;
    expect(blocks?.map((block) => block.lines[0])).toEqual(['1–2 (each group) → Round 6', 'rest out']);
  });

  it('a group stage with no groups yet reads its matches alone', () => {
    const state = generated(13, { ...GROUPS, qualAdv: '4' });
    expect(modelOf({ ...state, groups: [] }).pooling?.lines[1]).toBe('6 matches a round');
  });
});
