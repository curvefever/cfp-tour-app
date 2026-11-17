import { describe, expect, it } from 'vitest';
import { tieredBracketSeed, tieredSeed, type SeedingOverride } from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import type { PendingBracketSeed, RoundAssignment } from '../types';
import { buildRound } from './test-fixtures';

/** 37 units advance into 9 rooms (one of 5, eight of 4), the awkward count of the plan. */
const ROOM_SIZES = [5, 4, 4, 4, 4, 4, 4, 4, 4];
const NAMES = Array.from({ length: 37 }, (_, index) => `U${index + 1}`);
const LUCKY = ['U3', 'U11', 'U19', 'U27', 'U36'];
const OVERRIDES: Array<SeedingOverride | undefined> = [undefined, 'diversity', 'balance', 'random'];

function luckyNamesOf(seeded: RoundAssignment[]): string[] {
  return seeded.filter((entry) => entry.isLucky).map((entry) => entry.name);
}

describe.each(OVERRIDES)('the lucky flag of a drawn round (seeding override %s)', (seedingOverride) => {
  it('tieredSeed marks exactly the lucky losers it was given', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: ROOM_SIZES, players: 37 }),
        buildRound({ roundNum: 2, rooms: ROOM_SIZES, players: 37 }),
      ],
    });
    const advancing = NAMES.map((name) => ({ name, isLucky: LUCKY.includes(name) }));
    const { seeded } = tieredSeed({ state, roundIndex: 0, advancing, seedingOverride });
    expect(seeded).toHaveLength(37);
    expect(new Set(seeded.map((entry) => entry.name)).size).toBe(37);
    expect(luckyNamesOf(seeded).sort()).toEqual([...LUCKY].sort());
  });

  it('tieredBracketSeed marks exactly the lucky losers of its pool', () => {
    const pool: PendingBracketSeed[] = NAMES.map((name, index) => ({
      name,
      isLucky: LUCKY.includes(name),
      tierRank: index % 3,
      pct: 1 - index / 100,
    }));
    const rounds = [buildRound({ roundNum: 1 }), buildRound({ roundNum: 2 })];
    const { seeded } = tieredBracketSeed({
      pool,
      roomSizes: ROOM_SIZES,
      roomHistory: {},
      rounds,
      targetRoundIndex: 1,
      seedingOverride,
    });
    expect(seeded).toHaveLength(37);
    expect(new Set(seeded.map((entry) => entry.name)).size).toBe(37);
    expect(luckyNamesOf(seeded).sort()).toEqual([...LUCKY].sort());
  });

  it('marks no one when no unit is a lucky loser', () => {
    const pool: PendingBracketSeed[] = NAMES.map((name, index) => ({
      name,
      tierRank: index % 3,
      pct: 1 - index / 100,
    }));
    const { seeded } = tieredBracketSeed({
      pool,
      roomSizes: ROOM_SIZES,
      roomHistory: {},
      rounds: [buildRound({ roundNum: 1 }), buildRound({ roundNum: 2 })],
      targetRoundIndex: 1,
      seedingOverride,
    });
    expect(luckyNamesOf(seeded)).toEqual([]);
  });
});
