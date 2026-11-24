import { describe, expect, it } from 'vitest';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { QUAL_GRAPH, buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import { assignRows, type RowEntity } from './schedule-picture-rows';
import { MOCKUP_GRAPH, modelOf, rowsOf } from './schedule-picture-test-support';

const entity = (column: number, extra: Partial<RowEntity> = {}): RowEntity => ({
  column,
  isFinal: false,
  ranking: false,
  poolingOrder: null,
  ...extra,
});

describe('assignRows', () => {
  it('puts the Final and the rounds that send players to it on row 0', () => {
    const entities = [entity(0), entity(1), entity(2, { isFinal: true })];
    expect(
      assignRows(entities, [
        { from: 0, to: 1, count: 8 },
        { from: 1, to: 2, count: 4 },
      ]),
    ).toEqual([0, 0, 0]);
  });

  it('takes the row of a round fed by the pooling block from its band order', () => {
    const entities = [
      entity(0, { poolingOrder: 1 }),
      entity(0, { poolingOrder: 0 }),
      entity(0, { poolingOrder: 2 }),
    ];
    expect(assignRows(entities, [])).toEqual([1, 0, 2]);
  });

  it('continues the row of the round that sends the most players, a tie taking the higher row', () => {
    const entities = [entity(0, { poolingOrder: 0 }), entity(0, { poolingOrder: 1 }), entity(1), entity(1)];
    const feeds = [
      { from: 0, to: 2, count: 4 },
      { from: 1, to: 2, count: 8 },
      { from: 0, to: 3, count: 6 },
      { from: 1, to: 3, count: 6 },
    ];
    expect(assignRows(entities, feeds)).toEqual([0, 1, 1, 0]);
  });

  it('moves a round to the next free row below when its column holds the row', () => {
    const entities = [entity(0, { poolingOrder: 0 }), entity(1), entity(1)];
    const feeds = [
      { from: 0, to: 1, count: 8 },
      { from: 0, to: 2, count: 8 },
    ];
    expect(assignRows(entities, feeds)).toEqual([0, 0, 1]);
  });

  it('places the rounds that reach the Final first, so a lower round cannot take their row', () => {
    const entities = [entity(0, { poolingOrder: 0 }), entity(1), entity(1), entity(2, { isFinal: true })];
    const feeds = [
      { from: 0, to: 1, count: 8 },
      { from: 0, to: 2, count: 8 },
      { from: 2, to: 3, count: 4 },
    ];
    expect(assignRows(entities, feeds)).toEqual([0, 1, 0, 0]);
  });
});

describe('assignRows, the later rules', () => {
  it('gives a card the pooling block feeds its pooling order even when it sends players to the Final', () => {
    const entities = [
      entity(0, { poolingOrder: 1 }),
      entity(0, { poolingOrder: 0 }),
      entity(1, { isFinal: true }),
    ];
    expect(assignRows(entities, [{ from: 0, to: 2, count: 4 }])).toEqual([1, 0, 0]);
  });

  it('places a round that only plays for places after the others of its column', () => {
    const entities = [entity(0, { poolingOrder: 0 }), entity(1, { ranking: true }), entity(1)];
    const feeds = [
      { from: 0, to: 1, count: 8 },
      { from: 0, to: 2, count: 8 },
    ];
    expect(assignRows(entities, feeds)).toEqual([0, 1, 0]);
  });

  it('counts the players a card gets through a drop at the row below the sender', () => {
    const entities = [entity(0, { poolingOrder: 0 }), entity(1), entity(1)];
    expect(assignRows(entities, [{ from: 0, to: 1, count: 4, drop: true }])).toEqual([0, 1, 0]);
    const mixed = [entity(0, { poolingOrder: 0 }), entity(1)];
    expect(
      assignRows(mixed, [
        { from: 0, to: 1, count: 4, drop: true },
        { from: 0, to: 1, count: 8 },
      ]),
    ).toEqual([0, 0]);
    expect(
      assignRows(mixed, [
        { from: 0, to: 1, count: 8, drop: true },
        { from: 0, to: 1, count: 4 },
      ]),
    ).toEqual([0, 1]);
  });
});

describe('the rows of a layered bracket', () => {
  it('31 players: the semi-finals and the Final on row 0, the lower rounds on row 1', () => {
    expect(rowsOf(modelOf(built(31)))).toEqual({
      'Semi-Final A': 0,
      'Round 4 - Lower': 1,
      'Round 5 - Lower': 1,
      'Semi-Final B': 0,
      Final: 0,
    });
  });

  it('43 players: Round 5 - Lower gives way to Semi-Final A on row 0, and the lower rounds follow it', () => {
    expect(rowsOf(modelOf(built(43)))).toEqual({
      'Round 4 - Upper': 0,
      'Round 4 - Lower': 1,
      'Semi-Final A': 0,
      'Round 5 - Lower': 1,
      'Round 6 - Lower': 1,
      'Semi-Final B': 0,
      Final: 0,
    });
  });
});

describe('the rows of a Custom bracket', () => {
  it('the 20 November mockup: three rows, as drawn there', () => {
    const state = buildQualWaterfall(55, MOCKUP_GRAPH, { qualAdv: '37' }, { columns: true });
    expect(rowsOf(modelOf(state))).toEqual({
      'Round 5 Upper': 0,
      'Semi A': 0,
      'Semi B': 0,
      Final: 0,
      'Round 5 Middle': 1,
      'Round 6 Middle': 1,
      'Round 7 Upper': 1,
      'Round 8': 1,
      'Round 5 Lower': 2,
      'Round 6 Lower': 2,
      'Round 7 Lower': 2,
    });
  });
});

describe('the rows of the other shapes', () => {
  it('a round the pooling block feeds keeps its pooling order, even when it sends players to the Final', () => {
    const state = buildQualWaterfall(37, QUAL_GRAPH, {}, { columns: true });
    expect(rowsOf(modelOf(state))).toEqual({ R1: 0, R1C: 1, R2: 0, Final: 0 });
  });

  it('upper and lower bracket at 37: the rounds that only play for places go last in their column', () => {
    const state = generated(37, { scheduleLogic: 'upper-lower', poolingPhase: 'qual-table', qualAdv: '32' });
    expect(rowsOf(modelOf(state))).toEqual({
      'Round 4 - Upper': 0,
      'Round 4 - Lower': 1,
      'Semi-Final A': 0,
      'Round 5 - Lower': 1,
      'Round 5 - Ranking': 2,
      'Round 6 - Lower': 1,
      'Round 6 - Ranking': 2,
      'Semi-Final B': 0,
      Final: 0,
    });
  });

  it('double elimination 1v1 at 16: the winners rounds stay on row 0 and the losers rounds run along row 1', () => {
    const model = modelOf(
      generated(16, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
      }),
    );
    const rows = rowsOf(model);
    expect(Object.entries(rows).filter(([name]) => name.startsWith('WB'))).toSatisfy(
      (entries: [string, number][]) => entries.every(([, row]) => row === 0),
    );
    for (const name of ['LB Round 3', 'LB Round 4.1', 'LB Round 4.2', 'LB Round 5.1', 'LB Round 5.2']) {
      expect(rows[name]).toBe(1);
    }
    // The last losers round sends players to the Grand Final, so it is a major round on the top row.
    expect(rows['LB Round 6']).toBe(0);
    expect(rows['Grand Final']).toBe(0);
  });
});
