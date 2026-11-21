import { describe, expect, it } from 'vitest';
import { onOneScale } from '../custom-bracket-draw';
import type { PendingBracketSeed } from '../types';

const entry = (name: string, seed: number, from: number, tierRank: number): PendingBracketSeed => ({
  name,
  tierRank,
  pct: 1,
  seed,
  from,
});

describe('onOneScale', () => {
  it('leaves a pool from one source exactly as it is', () => {
    const pool = [entry('A', 1, 0, 0), entry('B', 2, 0, 1), entry('C', 3, 0, 2)];
    expect(onOneScale(pool)).toBe(pool);
  });

  it('puts the tiers of a source after the highest tier of the sources with better seeds', () => {
    const qualifiers = Array.from({ length: 12 }, (_, index) => entry(`Q${index + 1}`, index + 1, 0, index));
    const arrivals = [
      entry('M1', 13, 1, 0),
      entry('M2', 13, 1, 1),
      entry('M3', 14, 1, 0),
      entry('M4', 14, 1, 1),
    ];
    const tiers = onOneScale([...arrivals, ...qualifiers]).map(({ name, tierRank }) => [name, tierRank]);
    expect(tiers.filter(([name]) => String(name).startsWith('M'))).toEqual([
      ['M1', 12],
      ['M2', 13],
      ['M3', 12],
      ['M4', 13],
    ]);
    expect(tiers.filter(([name]) => String(name).startsWith('Q')).map(([, tier]) => tier)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    );
  });

  it('orders the sources by their best seed, whatever order the pool was filled in', () => {
    const first = [entry('A', 1, 5, 0), entry('B', 9, 2, 0), entry('C', 9, 2, 1)];
    const second = [first[2], first[1], first[0]];
    const tierOf = (pool: PendingBracketSeed[]) =>
      Object.fromEntries(onOneScale(pool).map(({ name, tierRank }) => [name, tierRank]));
    expect(tierOf(first)).toEqual({ A: 0, B: 1, C: 2 });
    expect(tierOf(second)).toEqual(tierOf(first));
  });

  it('breaks a tie between sources of the same best seed by the round they come from', () => {
    const pool = [entry('X', 3, 7, 0), entry('Y', 3, 4, 0)];
    expect(onOneScale(pool).map(({ name, tierRank }) => [name, tierRank])).toEqual([
      ['X', 1],
      ['Y', 0],
    ]);
  });
});
