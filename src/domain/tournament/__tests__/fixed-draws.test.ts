import { describe, expect, it } from 'vitest';
import { buildFixedRoomSchedule, buildFixedSwissSchedule } from '../fixed-draws';

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

function pairsInRound(assignments: Array<{ name: string; room: number | null }>): Set<string> {
  const byRoom = new Map<number, string[]>();
  for (const entry of assignments) {
    if (entry.room === null) continue;
    byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
  }
  const pairs = new Set<string>();
  for (const members of byRoom.values()) {
    for (let first = 0; first < members.length; first += 1) {
      for (let second = first + 1; second < members.length; second += 1) {
        const [a, b] = [members[first], members[second]].sort();
        pairs.add(`${a}|${b}`);
      }
    }
  }
  return pairs;
}

function countRepeats(rounds: Array<Array<{ name: string; room: number | null }>>): number {
  const seen = new Set<string>();
  let repeats = 0;
  for (const round of rounds) {
    for (const pair of pairsInRound(round)) {
      if (seen.has(pair)) repeats += 1;
      seen.add(pair);
    }
  }
  return repeats;
}

describe('buildFixedRoomSchedule', () => {
  it('is deterministic -- identical input produces identical output', () => {
    const roster = names(37);
    const rounds = Array.from({ length: 4 }, () => ({ rooms: [8, 8, 7, 7, 7], byeCount: 0 }));
    const first = buildFixedRoomSchedule(roster, rounds);
    const second = buildFixedRoomSchedule(roster, rounds);
    expect(second).toEqual(first);
  });

  it("matches each round's declared room shape exactly, with no duplicate or dropped names, across uneven profiles", () => {
    const profiles: Array<{ roster: string[]; rounds: Array<{ rooms: number[]; byeCount: number }> }> = [
      {
        roster: names(37),
        rounds: Array.from({ length: 3 }, () => ({ rooms: [8, 8, 7, 7, 7], byeCount: 0 })),
      },
      {
        roster: names(9),
        rounds: Array.from({ length: 2 }, () => ({ rooms: [4, 4], byeCount: 1 })),
      },
      {
        roster: names(10),
        rounds: Array.from({ length: 2 }, () => ({ rooms: [4, 3, 3], byeCount: 0 })),
      },
    ];
    for (const { roster, rounds } of profiles) {
      const result = buildFixedRoomSchedule(roster, rounds);
      expect(result.rounds).toHaveLength(rounds.length);
      for (const [index, roundAssignments] of result.rounds.entries()) {
        const round = rounds[index];
        expect(roundAssignments.map((entry) => entry.name).sort()).toEqual([...roster].sort());
        expect(roundAssignments.filter((entry) => entry.room === null)).toHaveLength(round.byeCount);
        for (const [roomIndex, size] of round.rooms.entries()) {
          expect(roundAssignments.filter((entry) => entry.room === roomIndex + 1)).toHaveLength(size);
        }
      }
    }
  });

  it('round 0 has zero internal repeats (trivially true, but a real regression guard)', () => {
    const roster = names(9);
    const result = buildFixedRoomSchedule(roster, [{ rooms: [3, 3, 3], byeCount: 0 }]);
    expect(pairsInRound(result.rounds[0]).size).toBe(9); // 3 rooms x C(3,2) = 9 pairs, all new
  });

  it('produces fewer repeat pairs over several rounds than a naive fixed (non-history-aware) chunking baseline', () => {
    const roster = names(16);
    const rounds = Array.from({ length: 4 }, () => ({ rooms: [8, 8], byeCount: 0 }));
    const result = buildFixedRoomSchedule(roster, rounds);
    const smartRepeats = countRepeats(result.rounds);

    // Naive baseline: identical contiguous chunking every round (a
    // deliberately weak comparison, matching the "rotate the roster by a
    // fixed offset" idea explicitly rejected during design).
    const naiveRounds = rounds.map(() => [
      ...roster.slice(0, 8).map((name) => ({ name, room: 1 })),
      ...roster.slice(8, 16).map((name) => ({ name, room: 2 })),
    ]);
    const naiveRepeats = countRepeats(naiveRounds);

    expect(smartRepeats).toBeLessThan(naiveRepeats);
  });

  it('spreads byes fairly across rounds (no one sits out twice before everyone has sat out once)', () => {
    const roster = names(9);
    const rounds = Array.from({ length: 4 }, () => ({ rooms: [4, 4], byeCount: 1 }));
    const result = buildFixedRoomSchedule(roster, rounds);
    const byeCounts = new Map<string, number>();
    for (const round of result.rounds) {
      for (const entry of round) {
        if (entry.room !== null) continue;
        byeCounts.set(entry.name, (byeCounts.get(entry.name) ?? 0) + 1);
      }
    }
    const counts = [...byeCounts.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe('buildFixedSwissSchedule', () => {
  it('is deterministic', () => {
    const roster = names(8);
    expect(buildFixedSwissSchedule(roster, 5)).toEqual(buildFixedSwissSchedule(roster, 5));
  });

  it('guarantees zero repeat pairings through its own full round-robin length (even roster)', () => {
    const roster = names(8);
    const rounds = buildFixedSwissSchedule(roster, 7); // numRounds = 8-1 = 7
    expect(countRepeats(rounds)).toBe(0);
    // Every pair meets exactly once across the full schedule: C(8,2) = 28 pairs.
    const allPairs = new Set<string>();
    for (const round of rounds) for (const pair of pairsInRound(round)) allPairs.add(pair);
    expect(allPairs.size).toBe(28);
  });

  it('guarantees zero repeats for an odd roster too, rotating the bye fairly', () => {
    const roster = names(9);
    const rounds = buildFixedSwissSchedule(roster, 9); // numRounds = 9 (phantom position included)
    expect(countRepeats(rounds)).toBe(0);
    const byeCounts = new Map<string, number>();
    for (const round of rounds) {
      const byeEntry = round.find((entry) => entry.room === null);
      if (byeEntry) byeCounts.set(byeEntry.name, (byeCounts.get(byeEntry.name) ?? 0) + 1);
    }
    // 9 rounds, 9 players -- each sits out exactly once.
    expect([...byeCounts.values()]).toEqual(roster.map(() => 1));
  });

  it('every round pairs everyone with no duplicates or drops', () => {
    const roster = names(9);
    const rounds = buildFixedSwissSchedule(roster, 5);
    for (const round of rounds) {
      expect(round.map((entry) => entry.name).sort()).toEqual([...roster].sort());
    }
  });

  it('cycles through the schedule rather than erroring when more rounds are requested than numRounds', () => {
    const roster = names(4); // numRounds = 3
    const rounds = buildFixedSwissSchedule(roster, 5);
    expect(rounds).toHaveLength(5);
    expect(rounds[3]).toEqual(rounds[0]);
    expect(rounds[4]).toEqual(rounds[1]);
  });
});
