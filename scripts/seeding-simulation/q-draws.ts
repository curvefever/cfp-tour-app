import {
  buildAdvancementTiers,
  computeQualificationStandings,
} from '../../src/domain/tournament/advancement';
import { lateJoinersOf } from '../../src/domain/tournament/late-joiners';
import {
  assignWaveToRooms,
  BALANCE_PRIORITY_WEIGHT_AT_WARMUP,
  DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP,
  type WaveMember,
} from '../../src/domain/tournament/seeding';
import {
  smallerRoomSeatsBefore,
  spreadsSmallerRoomSeats,
  splitForSmallerRooms,
} from '../../src/domain/tournament/smaller-room-seats';
import type { RoundAssignment, TournamentState } from '../../src/domain/tournament/types';
import { CUT, type Kind } from './cuts';
import { shuffled } from './random';

/**
 * The qualification draws of shape Q that the engine does not make: a neutral bye in place of smaller rooms (`QB`) and
 * smaller-room seats by stake (`QK`). Both rebuild the engine's own draw from its pieces (the tiers of the previous
 * round's finishing places, the smaller-room split, the wave fill), and `engine-like` is that rebuild without a change:
 * it must equal the engine's draw.
 */

export interface QDrawContext {
  state: TournamentState;
  next: number;
  firstCounted: number;
  kind: Kind;
}

function seatedNames(state: TournamentState, next: number): string[] {
  return state.assignments[next].filter((entry) => entry.room !== null).map((entry) => entry.name);
}

/** The tiers of the previous round's finishing places, flattened best first: what the engine's `tieredSeed` fills rooms from. */
function engineOrder({ state, next }: QDrawContext): WaveMember[] {
  return buildAdvancementTiers(state, next - 1, seatedNames(state, next)).flatMap((tier) =>
    tier.members.map((member) => ({ name: member.name, tierRank: tier.rank })),
  );
}

/** `fillRoomsByWaves` of the engine at the weights of a pooling phase: one wave at a time, one unit per open room, avoiding repeats. */
function fillByWaves(
  members: WaveMember[],
  roomNumbers: number[],
  { state, next }: QDrawContext,
  roomSizes: number[],
): Array<{ name: string; room: number }> {
  const maxWave = Math.max(0, ...roomNumbers.map((room) => roomSizes[room - 1]));
  const soFar = new Map<number, string[]>(roomNumbers.map((room) => [room, []]));
  const balance = new Map<number, number>(roomNumbers.map((room) => [room, 0]));
  const placed: Array<{ name: string; room: number }> = [];
  let cursor = 0;
  for (let wave = 0; wave < maxWave; wave += 1) {
    const waveRooms = roomNumbers.filter((room) => roomSizes[room - 1] > wave);
    const waveMembers = members.slice(cursor, cursor + waveRooms.length);
    cursor += waveRooms.length;
    if (waveMembers.length === 0) continue;
    const assigned = assignWaveToRooms(waveMembers, waveRooms, soFar, balance, {
      roomHistory: state.roomHistory,
      targetRoundIndex: next,
      allRoomNumbers: roomNumbers,
      diversityWeight: DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP,
      balanceWeight: BALANCE_PRIORITY_WEIGHT_AT_WARMUP,
    });
    for (const { name, room } of assigned) {
      soFar.set(room, [...(soFar.get(room) ?? []), name]);
      balance.set(room, (balance.get(room) ?? 0) + (waveMembers.find((m) => m.name === name)?.tierRank ?? 0));
      placed.push({ name, room });
    }
  }
  return placed;
}

interface Split {
  smallRooms: number[];
  small: WaveMember[];
  large: WaveMember[];
}

/** The smaller rooms filled apart from the larger ones, the line-up in the order of `order`. */
function seatSplit(split: Split, order: WaveMember[], context: QDrawContext): RoundAssignment[] {
  const sizes = context.state.rounds[context.next].rooms;
  const allRooms = sizes.map((_, index) => index + 1);
  const largeRooms = allRooms.filter((room) => !split.smallRooms.includes(room));
  const placed = [
    ...fillByWaves(split.small, split.smallRooms, context, sizes),
    ...fillByWaves(split.large, largeRooms, context, sizes),
  ];
  const position = new Map(order.map((member, index) => [member.name, index]));
  return placed
    .sort((first, second) => (position.get(first.name) ?? 0) - (position.get(second.name) ?? 0))
    .map(({ name, room }) => ({ name, room, isLucky: false }));
}

/** The engine's draw, rebuilt from its pieces. */
export function engineLikeDraw(context: QDrawContext): RoundAssignment[] {
  const { state, next } = context;
  const order = engineOrder(context);
  const sizes = state.rounds[next].rooms;
  const split = spreadsSmallerRoomSeats(state.rounds[next])
    ? splitForSmallerRooms(
        order,
        sizes,
        smallerRoomSeatsBefore(state, next),
        new Set(lateJoinersOf(state, next - 1)),
      )
    : null;
  if (split) return seatSplit(split, order, context);
  const rooms = sizes.map((_, index) => index + 1);
  return fillByWaves(order, rooms, context, sizes).map(({ name, room }) => ({ name, room, isLucky: false }));
}

function smallerSeatsOf(sizes: number[]): number {
  const largest = Math.max(...sizes);
  return sizes.filter((size) => size < largest).reduce((sum, size) => sum + size, 0);
}

/** `QB` applies when rooms all of the largest size plus byes leave fewer byes than today's smaller-room seats. */
export function byesApply(sizes: number[], units: number): boolean {
  const largest = Math.max(...sizes);
  const byes = units - Math.floor(units / largest) * largest;
  return byes > 0 && byes < smallerSeatsOf(sizes);
}

/** How many counted rounds each unit has sat out so far. */
function byeCounts({ state, next, firstCounted }: QDrawContext): Record<string, number> {
  const field = state.assignments[0].map((entry) => entry.name);
  const counts: Record<string, number> = {};
  for (let round = firstCounted; round < next; round += 1) {
    const seated = new Set(seatedNames(state, round));
    for (const name of field) if (!seated.has(name)) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** The byes drawn at random among the units with the fewest so far: no link to how a unit finished the previous round. */
function randomByeSplit(
  order: WaveMember[],
  byes: number,
  counts: Record<string, number>,
  random: () => number,
): Split {
  const ranked = shuffled(order, random).sort((a, b) => (counts[a.name] ?? 0) - (counts[b.name] ?? 0));
  const picked = new Set(ranked.slice(0, byes).map((member) => member.name));
  return {
    smallRooms: [],
    small: order.filter((member) => picked.has(member.name)),
    large: order.filter((member) => !picked.has(member.name)),
  };
}

/** `QB`: rooms of the largest size and a few byes. The bye units sit out, so the next draw reads them as late joiners (average units). */
export function byeDraw(context: QDrawContext, random?: () => number): RoundAssignment[] | null {
  const { state, next } = context;
  const sizes = state.rounds[next].rooms;
  const order = engineOrder(context);
  if (!byesApply(sizes, order.length)) return null;
  const largest = Math.max(...sizes);
  const rooms = Math.floor(order.length / largest);
  const byes = order.length - rooms * largest;
  const shape = [...Array<number>(rooms).fill(largest), byes];
  const counts = byeCounts(context);
  const split = random
    ? randomByeSplit(order, byes, counts, random)
    : splitForSmallerRooms(order, shape, counts, new Set());
  if (!split) return null;
  const roomNumbers = Array.from({ length: rooms }, (_, index) => index + 1);
  const placed = fillByWaves(split.large, roomNumbers, context, shape);
  return placed.map(({ name, room }) => ({ name, room, isLucky: false }));
}

/** The `count` members with the largest stake, then the fewest seats; members tied at the boundary share the seats left, strided over `order`. */
function pickByStake(
  order: WaveMember[],
  count: number,
  stake: Map<string, number>,
  seats: Record<string, number>,
): Set<string> {
  const key = (member: WaveMember): [number, number] => [
    -(stake.get(member.name) ?? 0),
    seats[member.name] ?? 0,
  ];
  const compare = (first: [number, number], second: [number, number]) =>
    first[0] - second[0] || first[1] - second[1];
  const ranked = [...order].sort((first, second) => compare(key(first), key(second)));
  const boundary = key(ranked[count - 1]);
  const picked = new Set(
    ranked.filter((member) => compare(key(member), boundary) < 0).map((member) => member.name),
  );
  const tied = order.filter((member) => compare(key(member), boundary) === 0);
  const remaining = count - picked.size;
  for (let index = 0; index < remaining; index += 1) {
    picked.add(tied[Math.floor(((index + 0.5) * tied.length) / remaining)].name);
  }
  return picked;
}

/** How far each unit's Standard points are from the cut line L, the mean of the points at the cut and the one below it. */
function stakeByDistance(state: TournamentState, kind: Kind): Map<string, number> {
  const standings = computeQualificationStandings(state);
  const points = standings.map((entry) => entry.totalFP ?? 0);
  const line = (points[CUT[kind] - 1] + points[CUT[kind]]) / 2;
  return new Map(standings.map((entry) => [entry.name, Math.abs((entry.totalFP ?? 0) - line)]));
}

/** `QK`: from the second counted round on, the smaller-room seats go to the units farthest in points from the cut line. */
export function stakeDraw(context: QDrawContext): RoundAssignment[] | null {
  const { state, next, firstCounted, kind } = context;
  if (next <= firstCounted) return null;
  const sizes = state.rounds[next].rooms;
  const largest = Math.max(...sizes);
  const smallRooms = sizes.flatMap((size, index) => (size < largest ? [index + 1] : []));
  if (smallRooms.length === 0) return null;
  const order = engineOrder(context);
  const seatCount = Math.min(order.length, smallerSeatsOf(sizes));
  const picked = pickByStake(
    order,
    seatCount,
    stakeByDistance(state, kind),
    smallerRoomSeatsBefore(state, next),
  );
  const split = {
    smallRooms,
    small: order.filter((member) => picked.has(member.name)),
    large: order.filter((member) => !picked.has(member.name)),
  };
  return seatSplit(split, order, context);
}
