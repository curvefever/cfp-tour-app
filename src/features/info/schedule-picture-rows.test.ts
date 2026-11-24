import { describe, expect, it } from 'vitest';
import { buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import { assignRows, type RowEntity } from './schedule-picture-rows';
import { MOCKUP_GRAPH, modelOf, rowsOf } from './schedule-picture-test-support';

const entity = (column: number, extra: Partial<RowEntity> = {}): RowEntity => ({
  column,
  isFinal: false,
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
