import { describe, expect, it } from 'vitest';
import { levelRuns } from '../level-runs';

describe('levelRuns', () => {
  it('splits a list into runs of entries level with the first of their run', () => {
    const level = (entry: number, first: number) => entry === first;
    expect(levelRuns([1, 1, 2, 3, 3, 3, 1], level)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 2 },
      { first: 3, last: 5 },
      { first: 6, last: 6 },
    ]);
  });

  it('compares each entry with the first of the run, not with its neighbour', () => {
    const within = (entry: number, first: number) => entry - first <= 1;
    expect(levelRuns([1, 2, 3, 4], within)).toEqual([
      { first: 0, last: 1 },
      { first: 2, last: 3 },
    ]);
  });

  it('gives no runs for an empty list', () => {
    expect(levelRuns([], () => true)).toEqual([]);
  });
});
