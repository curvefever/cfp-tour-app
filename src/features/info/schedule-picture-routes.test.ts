import { describe, expect, it } from 'vitest';
import type { RoundExitRule } from '../../domain/tournament/room-exits';
import { roundRoutes } from './schedule-picture-routes';

type PerRoom = Extract<RoundExitRule, { kind: 'per-room' }>;
const rule = (...rooms: PerRoom['rooms']): PerRoom => ({ kind: 'per-room', rooms });

describe('roundRoutes', () => {
  it('counts the band widths times the rooms, and marks only a drop as a drop', () => {
    const routes = roundRoutes(
      {},
      0,
      rule(
        [
          { kind: 'advance', fromRank: 1, toRank: 4, destination: 2 },
          { kind: 'advance', fromRank: 5, toRank: 6, destination: 3, group: 2 },
          { kind: 'drop', fromRank: 7, toRank: 8, destination: 4 },
        ],
        [
          { kind: 'advance', fromRank: 1, toRank: 4, destination: 2 },
          { kind: 'advance', fromRank: 5, toRank: 6, destination: 3, group: 2 },
          { kind: 'drop', fromRank: 7, toRank: 8, destination: 4 },
        ],
      ),
    );
    expect(routes).toEqual([
      { to: 2, tone: 'green', count: 8 },
      { to: 3, tone: 'purple', count: 4 },
      { to: 4, tone: 'purple', count: 4, drop: true },
    ]);
  });

  it('counts a lucky place at its spots once, and the units it drops as a drop', () => {
    const lucky = { kind: 'lucky-chance', rank: 3, spots: 1, otherwise: { drop: 5 } } as const;
    const advance = { kind: 'advance', fromRank: 1, toRank: 2, destination: 1 } as const;
    expect(roundRoutes({}, 0, rule([advance, lucky], [advance, lucky], [advance, lucky]))).toEqual([
      { to: 1, tone: 'green', count: 7 },
      { to: 5, tone: 'purple', count: 2, drop: true },
    ]);
  });
});
