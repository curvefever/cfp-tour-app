import { describe, expect, it } from 'vitest';
import { lexicographicMinAssignment } from '../assignment';
import { assignWaveToRooms, roomPairKey, type WaveMember } from '../seeding';
import { permutationsOf, referenceAssignWaveToRooms, referenceCost } from './assign-wave-reference';

type WaveOptions = Parameters<typeof assignWaveToRooms>[4];

interface Instance {
  members: WaveMember[];
  roomNumbers: number[];
  roomMembersSoFar: Map<number, string[]>;
  roomBalanceSoFar: Map<number, number>;
  options: WaveOptions;
}

/** Small deterministic PRNG (mulberry32) so the random instances are reproducible. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInstance(seed: number, k: number): Instance {
  const random = makeRandom(seed);
  const int = (max: number) => Math.floor(random() * (max + 1));
  const outside = int(3);
  const allRoomNumbers = Array.from({ length: k + outside }, (_, index) => index + 1);
  // The wave's rooms are a subset of all rooms, in ascending order, like the real callers.
  const roomNumbers = [...allRoomNumbers]
    .sort(() => random() - 0.5)
    .slice(0, k)
    .sort((a, b) => a - b);
  // Few distinct tier ranks (often all equal) to force ties.
  const tierSpread = [0, 1, 2, 4][int(3)];
  const members: WaveMember[] = Array.from({ length: k }, (_, index) => ({
    name: `m${index}`,
    tierRank: int(tierSpread),
  }));
  const balanceSpread = [0, 1, 3, 10][int(3)];
  const roomBalanceSoFar = new Map(allRoomNumbers.map((room) => [room, int(balanceSpread)]));
  const roomMembersSoFar = new Map<number, string[]>(
    allRoomNumbers.map((room) => [room, Array.from({ length: int(3) }, (_, index) => `e${room}_${index}`)]),
  );
  const targetRoundIndex = 1 + int(7);
  const roomHistory: Record<string, number> = {};
  const historyDensity = [0, 0.15, 0.5, 0.9][int(3)];
  for (const member of members) {
    for (const existing of roomMembersSoFar.values()) {
      for (const name of existing) {
        if (random() < historyDensity)
          roomHistory[roomPairKey(member.name, name)] = int(targetRoundIndex - 1);
      }
    }
  }
  const weightKind = int(3);
  const diversityWeight = weightKind === 0 ? 1 : weightKind === 1 ? 0 : random();
  const balanceWeight = weightKind === 0 ? 0 : weightKind === 1 ? 1 : random();
  return {
    members,
    roomNumbers,
    roomMembersSoFar,
    roomBalanceSoFar,
    options: { roomHistory, targetRoundIndex, allRoomNumbers, diversityWeight, balanceWeight },
  };
}

function run(fn: typeof assignWaveToRooms, instance: Instance) {
  return fn(
    instance.members,
    instance.roomNumbers,
    instance.roomMembersSoFar,
    instance.roomBalanceSoFar,
    instance.options,
  );
}

describe('assignWaveToRooms -- identical to the old exhaustive search', () => {
  // The old search compared raw floating-point costs, so between assignments
  // that are mathematically tied it kept whichever the float summation order
  // happened to favour (e.g. balance totals summed in room order). The new
  // solver treats costs within a tiny tolerance as tied and takes the
  // lexicographically smallest. So: whenever the old search had a unique
  // optimum the two must agree exactly, and when it had ties the new answer
  // must be the first tied permutation in generation order.
  it('matches the exhaustive reference on thousands of seeded random instances, k = 1..7, with many forced ties', () => {
    let compared = 0;
    let withTies = 0;
    let oldPickedNoiseWinner = 0;
    const failures: string[] = [];
    for (let k = 1; k <= 7; k += 1) {
      const count = k === 7 ? 400 : 900;
      for (let index = 0; index < count; index += 1) {
        const seed = k * 100_003 + index;
        const instance = randomInstance(seed, k);
        const args = [
          instance.members,
          instance.roomNumbers,
          instance.roomMembersSoFar,
          instance.roomBalanceSoFar,
          instance.options,
        ] as const;
        const costs = permutationsOf(instance.roomNumbers).map((perm) => ({
          perm,
          cost: referenceCost(perm, args[0], args[2], args[3], args[4]),
        }));
        const minimum = Math.min(...costs.map((entry) => entry.cost));
        const tolerance = 1e-9 * Math.max(1, Math.abs(minimum));
        const tied = costs.filter((entry) => entry.cost <= minimum + tolerance);
        const expected = tied[0].perm.join(',');
        const actual = assignWaveToRooms(...args)
          .map((entry) => entry.room)
          .join(',');
        const old = referenceAssignWaveToRooms(...args)
          .map((entry) => entry.room)
          .join(',');
        compared += 1;
        if (tied.length > 1) withTies += 1;
        if (old !== expected) oldPickedNoiseWinner += 1;
        if (actual !== expected) failures.push(`k=${k} seed=${seed}`);
        if (tied.length === 1 && old !== actual) failures.push(`unique optimum differs: k=${k} seed=${seed}`);
      }
    }
    console.log(
      `${compared} instances, ${withTies} with ties, ${oldPickedNoiseWinner} where the old search's pick was a float-noise winner among tied permutations`,
    );
    expect(compared).toBeGreaterThan(5000);
    expect(failures).toEqual([]);
  }, 120_000);

  it('gives an all-tie wave its rooms in roomNumbers order', () => {
    const instance: Instance = {
      members: [0, 1, 2, 3].map((index) => ({ name: `m${index}`, tierRank: 0 })),
      roomNumbers: [2, 5, 6, 9],
      roomMembersSoFar: new Map(),
      roomBalanceSoFar: new Map(),
      options: {
        roomHistory: {},
        targetRoundIndex: 3,
        allRoomNumbers: [2, 5, 6, 9],
        diversityWeight: 0.5,
        balanceWeight: 0.5,
      },
    };
    expect(run(assignWaveToRooms, instance).map((entry) => entry.room)).toEqual([2, 5, 6, 9]);
  });

  it('breaks a tie towards the earliest room for the earliest member (m0 avoids room 1 by a repeat; m1 and m2 tie)', () => {
    const instance: Instance = {
      members: [
        { name: 'm0', tierRank: 0 },
        { name: 'm1', tierRank: 0 },
        { name: 'm2', tierRank: 0 },
      ],
      roomNumbers: [1, 2, 3],
      roomMembersSoFar: new Map([[1, ['x']]]),
      roomBalanceSoFar: new Map(),
      options: {
        roomHistory: { [roomPairKey('m0', 'x')]: 2 },
        targetRoundIndex: 3,
        allRoomNumbers: [1, 2, 3],
        diversityWeight: 1,
        balanceWeight: 0,
      },
    };
    // m0 must avoid room 1; m1 and m2 are then interchangeable, so the first
    // optimal permutation in order is [2, 1, 3].
    expect(run(assignWaveToRooms, instance).map((entry) => entry.room)).toEqual([2, 1, 3]);
    expect(run(referenceAssignWaveToRooms, instance).map((entry) => entry.room)).toEqual([2, 1, 3]);
  });

  it('still refuses a wave whose member and room counts differ', () => {
    const instance = randomInstance(1, 3);
    expect(() =>
      assignWaveToRooms(
        instance.members.slice(1),
        instance.roomNumbers,
        new Map(),
        new Map(),
        instance.options,
      ),
    ).toThrow('must equal');
  });
});

describe('lexicographicMinAssignment', () => {
  it('returns the identity for an all-equal matrix and handles the empty and 1x1 cases', () => {
    expect(lexicographicMinAssignment([])).toEqual([]);
    expect(lexicographicMinAssignment([[5]])).toEqual([0]);
    expect(lexicographicMinAssignment(Array.from({ length: 6 }, () => Array(6).fill(1)))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('finds the true optimum where greedy row-by-row choice would fail', () => {
    // Greedy would give row 0 its cheapest column 0 (cost 1) and force row 1 into cost 100.
    expect(
      lexicographicMinAssignment([
        [1, 2],
        [1, 100],
      ]),
    ).toEqual([1, 0]);
  });
});

describe('assignWaveToRooms -- speed at real tournament sizes', () => {
  it.each([20, 40])('a wave of %i rooms finishes in well under a second', (k) => {
    const instance = randomInstance(424_242 + k, k);
    const started = performance.now();
    const result = run(assignWaveToRooms, instance);
    const elapsed = performance.now() - started;
    console.log(`assignWaveToRooms k=${k}: ${elapsed.toFixed(1)} ms`);
    expect(new Set(result.map((entry) => entry.room)).size).toBe(k);
    expect(elapsed).toBeLessThan(1000);
  });
});
