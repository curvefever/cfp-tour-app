import { describe, expect, it } from 'vitest';
import {
  currentColumn,
  isCurrentRound,
  isRoundDone,
  isRoundReached,
  nextColumnStart,
  previousColumnStart,
  roundColumn,
} from '../round-columns';
import { buildRound } from './test-fixtures';

/** Rounds 0 and 1 on their own (no stored column), a column of 2 (2-3), a column of 3 (4-6), a single column round (7). */
const COLUMN_OF_BY_INDEX = [undefined, undefined, 1, 1, 2, 2, 2, 3];
const COLUMNED = COLUMN_OF_BY_INDEX.map((waterfallColumn, index) =>
  buildRound({ roundNum: index + 1, waterfallColumn }),
);
const PLAIN = COLUMN_OF_BY_INDEX.map((_, index) => buildRound({ roundNum: index + 1 }));

function stateAt(rounds: typeof COLUMNED, curRound: number) {
  return { rounds, curRound };
}

describe('roundColumn', () => {
  it.each([
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 3],
    [3, 2, 3],
    [4, 4, 6],
    [5, 4, 6],
    [6, 4, 6],
    [7, 7, 7],
  ])('puts round %i in the run %i-%i', (index, start, end) => {
    expect(roundColumn(COLUMNED, index)).toEqual({ start, end });
  });

  it('makes every round its own column when none has a stored column', () => {
    PLAIN.forEach((_, index) => expect(roundColumn(PLAIN, index)).toEqual({ start: index, end: index }));
  });

  it('keeps two neighbouring columns apart and reads an index past the rounds as a column of its own', () => {
    expect(roundColumn(COLUMNED, 3)).toEqual({ start: 2, end: 3 });
    expect(roundColumn(COLUMNED, 99)).toEqual({ start: 99, end: 99 });
  });
});

describe('the column in play', () => {
  it('is the run of curRound, and curRound is its first round', () => {
    expect(currentColumn(stateAt(COLUMNED, 4))).toEqual({ start: 4, end: 6 });
  });

  it.each([
    [4, [4, 5, 6]],
    [2, [2, 3]],
    [0, [0]],
    [7, [7]],
  ])('with curRound %i, rounds %j are current', (curRound, current) => {
    const state = stateAt(COLUMNED, curRound);
    COLUMNED.forEach((_, index) => expect(isCurrentRound(state, index)).toBe(current.includes(index)));
  });

  it('counts a round as reached up to the end of the column and done before its start', () => {
    const state = stateAt(COLUMNED, 2);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => isRoundReached(state, index))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((index) => isRoundDone(state, index))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('finds the next and the previous column from any round of the column in play', () => {
    expect(nextColumnStart(stateAt(COLUMNED, 2))).toBe(4);
    expect(previousColumnStart(stateAt(COLUMNED, 2))).toBe(1);
    expect(nextColumnStart(stateAt(COLUMNED, 4))).toBe(7);
    expect(previousColumnStart(stateAt(COLUMNED, 4))).toBe(2);
    expect(nextColumnStart(stateAt(COLUMNED, 7))).toBe(8);
    expect(previousColumnStart(stateAt(COLUMNED, 7))).toBe(4);
    expect(previousColumnStart(stateAt(COLUMNED, 0))).toBeNull();
  });

  it('behaves exactly like curRound when no round has a stored column', () => {
    PLAIN.forEach((_, curRound) => {
      const state = stateAt(PLAIN, curRound);
      PLAIN.forEach((__, index) => {
        expect(isCurrentRound(state, index)).toBe(index === curRound);
        expect(isRoundReached(state, index)).toBe(index <= curRound);
        expect(isRoundDone(state, index)).toBe(index < curRound);
      });
      expect(nextColumnStart(state)).toBe(curRound + 1);
      expect(previousColumnStart(state)).toBe(curRound > 0 ? curRound - 1 : null);
    });
  });
});
