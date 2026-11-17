import { recencyWeight, roomPairKey, type WaveMember } from '../seeding';

/**
 * Test-only copy of the original exhaustive assignWaveToRooms (every
 * permutation of the wave's rooms, first strictly-lowest cost wins), kept as
 * the reference the fast solver is compared with. `referenceCost` is the
 * original per-permutation cost, float operations and all.
 */
export interface ReferenceOptions {
  roomHistory: Record<string, number>;
  targetRoundIndex: number;
  allRoomNumbers: number[];
  diversityWeight: number;
  balanceWeight: number;
}

export function referenceCost(
  perm: number[],
  members: WaveMember[],
  roomMembersSoFar: Map<number, string[]>,
  roomBalanceSoFar: Map<number, number>,
  options: ReferenceOptions,
): number {
  let repeatScore = 0;
  let balanceCost = 0;
  const wouldBeTotals = new Map(
    options.allRoomNumbers.map((room) => [room, roomBalanceSoFar.get(room) ?? 0]),
  );
  for (const [index, member] of members.entries()) {
    const room = perm[index];
    for (const existing of roomMembersSoFar.get(room) ?? []) {
      const key = roomPairKey(member.name, existing);
      const lastRound = options.roomHistory[key];
      if (lastRound === undefined) continue;
      repeatScore += recencyWeight(options.targetRoundIndex - lastRound);
    }
    wouldBeTotals.set(room, (wouldBeTotals.get(room) ?? 0) + member.tierRank);
  }
  const totals = [...wouldBeTotals.values()];
  const mean = totals.reduce((sum, value) => sum + value, 0) / (totals.length || 1);
  for (const total of totals) balanceCost += Math.abs(total - mean);
  return options.diversityWeight * repeatScore + options.balanceWeight * balanceCost;
}

export function referenceAssignWaveToRooms(
  members: WaveMember[],
  roomNumbers: number[],
  roomMembersSoFar: Map<number, string[]>,
  roomBalanceSoFar: Map<number, number>,
  options: ReferenceOptions,
): Array<{ name: string; room: number }> {
  let best: { perm: number[]; cost: number } | null = null;
  for (const perm of permutationsOf(roomNumbers)) {
    const cost = referenceCost(perm, members, roomMembersSoFar, roomBalanceSoFar, options);
    if (!best || cost < best.cost) best = { perm, cost };
  }
  const perm = best?.perm ?? [];
  return members.map((member, index) => ({ name: member.name, room: perm[index] }));
}

export function permutationsOf<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const permutation of permutationsOf(rest)) result.push([values[index], ...permutation]);
  }
  return result;
}
