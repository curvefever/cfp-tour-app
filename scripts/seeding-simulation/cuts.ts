import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { standardPoints } from '../../src/domain/tournament/scoring';
import { roomPairKey } from '../../src/domain/tournament/seeding';
import { smallerRoomSeatsBefore, splitForSmallerRooms } from '../../src/domain/tournament/smaller-room-seats';
import type { RoundAssignment, TournamentState } from '../../src/domain/tournament/types';

/**
 * Part 2 of the simulation: the last counted round drawn "around the cuts". Rooms are consecutive runs of the
 * standings; the policy chooses where the runs start and end (and the order of the room sizes) so that room
 * edges fall where little is at stake on points, with rematches as a small secondary cost.
 */

export type Kind = '2v2v2v2' | 'ffa';
export type ProfileKey = 'P1' | 'P2' | 'P3';
export const PROFILE_KEYS: ProfileKey[] = ['P1', 'P2', 'P3'];

export const CUT: Record<Kind, number> = { '2v2v2v2': 16, ffa: 24 };
export const HALF: Record<Kind, number> = { '2v2v2v2': 8, ffa: 12 };

export interface Cut {
  /** The cut sits between final rank `position` and `position + 1`. */
  position: number;
  weight: number;
}

/** What each final qualification rank is worth under a bracket that follows. */
export interface Profile {
  key: ProfileKey;
  value: (rank: number) => number;
  cuts: Cut[];
}

const TIE_TERM = 0.1;
const REPEAT_WEIGHT = 0.05;
const MAX_CLIMB_STEPS = 100;

function cutsFromValues(value: (rank: number) => number, boundaries: number[]): Cut[] {
  return boundaries.map((position) => ({ position, weight: value(position) - value(position + 1) }));
}

/** P1: one hard cut. P2: two bands as in tournament 1792339397443 (the chance of reaching the Final). P3: graded like a Kings Valley ladder. */
export function profileOf(key: ProfileKey, kind: Kind): Profile {
  const cut = CUT[kind];
  const half = HALF[kind];
  let value: (rank: number) => number;
  let boundaries: number[];
  if (key === 'P1') {
    value = (rank) => (rank <= cut ? 1 : 0);
    boundaries = [cut];
  } else if (key === 'P2') {
    value = (rank) => (rank <= half ? 0.44 : rank <= cut ? 0.06 : 0);
    boundaries = [half, cut];
  } else if (kind === '2v2v2v2') {
    value = (rank) => (rank <= 4 ? 1 : rank <= 8 ? 0.75 : rank <= 12 ? 0.5 : rank <= 16 ? 0.25 : 0);
    boundaries = [4, 8, 12, 16];
  } else {
    value = (rank) => (rank <= 8 ? 1 : rank <= 16 ? 2 / 3 : rank <= 24 ? 1 / 3 : 0);
    boundaries = [8, 16, 24];
  }
  return { key, value, cuts: cutsFromValues(value, boundaries) };
}

/** The most one round can move a unit on points: first place against last place of the largest room. */
export function swingOf(largestRoom: number): number {
  return standardPoints(1, largestRoom) - standardPoints(largestRoom, largestRoom);
}

/** The points line of each cut: the mean of the points of the units either side of it (standings order, best first). */
export function cutLines(points: number[], cuts: Cut[]): number[] {
  return cuts.map(({ position }) => ((points[position - 1] ?? 0) + (points[position] ?? 0)) / 2);
}

/** A cut whose points line falls inside a block of units on equal points (the units on the points of #c and #c+1). */
interface Block {
  cut: Cut;
  points: number;
  /** The rank of the block's first unit. */
  firstRank: number;
}

interface EdgeModel {
  cuts: Cut[];
  lines: number[];
  swing: number;
  /** The largest room size: the reach of the rank term. */
  reach: number;
  blocks: Block[];
}

/** The cuts that fall inside a block of equal points, from the standings points before the round (best first). */
function blocksAround(points: number[], cuts: Cut[]): Block[] {
  return cuts.flatMap((cut) => {
    const above = points[cut.position - 1];
    if (above === undefined || above !== points[cut.position]) return [];
    return [{ cut, points: above, firstRank: points.indexOf(above) + 1 }];
  });
}

/**
 * What a room edge costs: its full weight on a cut line, nothing a swing or more from every cut; a tie split by it adds
 * a small term. An edge that splits a block of equal points holding a cut also pays a rank term, w_c × max(0, R − |k − c|)
 * / R, with k the edge's rank position (the block's first rank − 1 plus its units placed in rooms above the edge, given by
 * `aboveCount`) and R the largest room size: when the block has to be split, the split goes as far from the cut rank as
 * the room sizes allow.
 */
function edgeCost(
  upperLowest: number,
  lowerHighest: number,
  aboveCount: (points: number) => number,
  model: EdgeModel,
): number {
  const line = (upperLowest + lowerHighest) / 2;
  let cost = upperLowest === lowerHighest ? TIE_TERM : 0;
  model.cuts.forEach((cut, index) => {
    cost += (cut.weight * Math.max(0, model.swing - Math.abs(line - model.lines[index]))) / model.swing;
  });
  for (const block of model.blocks) {
    if (upperLowest !== block.points || lowerHighest !== block.points) continue;
    const rank = block.firstRank - 1 + aboveCount(block.points);
    cost += (block.cut.weight * Math.max(0, model.reach - Math.abs(rank - block.cut.position))) / model.reach;
  }
  return cost;
}

/** Every distinct order of the room sizes (a multiset permutation), largest first. */
function sizeOrders(sizes: number[]): number[][] {
  const sorted = [...sizes].sort((a, b) => b - a);
  const orders: number[][] = [];
  const used = new Array<boolean>(sorted.length).fill(false);
  const current: number[] = [];
  function extend(): void {
    if (current.length === sorted.length) {
      orders.push([...current]);
      return;
    }
    const tried = new Set<number>();
    for (let index = 0; index < sorted.length; index += 1) {
      if (used[index] || tried.has(sorted[index])) continue;
      tried.add(sorted[index]);
      used[index] = true;
      current.push(sorted[index]);
      extend();
      current.pop();
      used[index] = false;
    }
  }
  extend();
  return orders;
}

/** A group of units in standings order (index = position in the group), cut into consecutive rooms. */
interface Group {
  points: number[];
  sizes: number[];
}

function partitionCost(points: number[], order: number[], model: EdgeModel): number {
  let end = 0;
  let cost = 0;
  for (let room = 0; room < order.length - 1; room += 1) {
    end += order[room];
    const unitsAbove = (value: number) => points.slice(0, end).filter((entry) => entry === value).length;
    cost += edgeCost(points[end - 1], points[end], unitsAbove, model);
  }
  return cost;
}

function bestPartition(group: Group, model: EdgeModel): number[][] {
  let best: number[] = group.sizes;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const order of sizeOrders(group.sizes)) {
    const cost = partitionCost(group.points, order, model);
    if (cost < bestCost) {
      bestCost = cost;
      best = order;
    }
  }
  let start = 0;
  return best.map((size) => {
    const room = Array.from({ length: size }, (_, offset) => start + offset);
    start += size;
    return room;
  });
}

function roomsCost(
  rooms: number[][],
  points: number[],
  repeats: (first: number, second: number) => boolean,
  model: EdgeModel,
): number {
  let cost = 0;
  for (let room = 0; room < rooms.length - 1; room += 1) {
    const lowest = Math.min(...rooms[room].map((unit) => points[unit]));
    const highest = Math.max(...rooms[room + 1].map((unit) => points[unit]));
    const unitsAbove = (value: number) =>
      rooms
        .slice(0, room + 1)
        .reduce((sum, members) => sum + members.filter((unit) => points[unit] === value).length, 0);
    cost += edgeCost(lowest, highest, unitsAbove, model);
  }
  let pairs = 0;
  for (const members of rooms) {
    for (let a = 0; a < members.length; a += 1) {
      for (let b = a + 1; b < members.length; b += 1) if (repeats(members[a], members[b])) pairs += 1;
    }
  }
  return cost + REPEAT_WEIGHT * pairs;
}

/** Swaps the two units either side of an edge while that lowers edge cost + 0.05 × repeat pairings. */
function climb(
  start: number[][],
  points: number[],
  repeats: (first: number, second: number) => boolean,
  model: EdgeModel,
): number[][] {
  let rooms = start.map((room) => [...room]);
  let cost = roomsCost(rooms, points, repeats, model);
  for (let step = 0; step < MAX_CLIMB_STEPS; step += 1) {
    let improved = false;
    for (let edge = 0; edge < rooms.length - 1 && !improved; edge += 1) {
      const upper = rooms[edge];
      const lower = rooms[edge + 1];
      const lowestOfUpper = Math.max(...upper);
      const highestOfLower = Math.min(...lower);
      const swapped = rooms.map((room, index) => {
        if (index === edge) return room.map((unit) => (unit === lowestOfUpper ? highestOfLower : unit));
        if (index === edge + 1) return room.map((unit) => (unit === highestOfLower ? lowestOfUpper : unit));
        return room;
      });
      const candidate = swapped.map((room) => [...room].sort((a, b) => a - b));
      const candidateCost = roomsCost(candidate, points, repeats, model);
      if (candidateCost < cost - 1e-9) {
        rooms = candidate;
        cost = candidateCost;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return rooms;
}

/**
 * The line-up of round `next`: the standings before it cut into consecutive rooms with the edges where least is at
 * stake under `profile`. With `keepSpread` the units with the fewest smaller-room seats are first fixed to the
 * smaller rooms and each group is then drawn on its own.
 */
export function drawAroundCuts(
  state: TournamentState,
  next: number,
  profile: Profile,
  keepSpread: boolean,
): RoundAssignment[] {
  const seated = new Set(state.assignments[next].filter((e) => e.room !== null).map((e) => e.name));
  const standings = computeQualificationStandings(state).filter((entry) => seated.has(entry.name));
  const points = standings.map((entry) => entry.totalFP ?? 0);
  const sizes = state.rounds[next].rooms;
  const model: EdgeModel = {
    cuts: profile.cuts,
    lines: cutLines(points, profile.cuts),
    swing: swingOf(Math.max(...sizes)),
    reach: Math.max(...sizes),
    blocks: blocksAround(points, profile.cuts),
  };
  const repeatsOf = (first: string, second: string) => {
    const last = state.roomHistory[roomPairKey(first, second)];
    return last !== undefined && last < next;
  };

  const members = standings.map((entry) => ({ name: entry.name, tierRank: 0 }));
  const split = keepSpread
    ? splitForSmallerRooms(members, sizes, smallerRoomSeatsBefore(state, next), new Set())
    : null;
  const largest = Math.max(...sizes);
  const groups = split
    ? [
        { names: split.small.map((m) => m.name), sizes: sizes.filter((size) => size < largest) },
        { names: split.large.map((m) => m.name), sizes: sizes.filter((size) => size === largest) },
      ]
    : [{ names: members.map((m) => m.name), sizes }];

  const pointsByName = new Map(standings.map((entry) => [entry.name, entry.totalFP ?? 0]));
  const rooms: string[][] = [];
  for (const group of groups) {
    const groupPoints = group.names.map((name) => pointsByName.get(name) as number);
    const repeats = (a: number, b: number) => repeatsOf(group.names[a], group.names[b]);
    const partition = bestPartition({ points: groupPoints, sizes: group.sizes }, model);
    const climbed = climb(partition, groupPoints, repeats, model);
    for (const room of climbed) rooms.push(room.map((index) => group.names[index]));
  }
  const mean = (room: string[]) =>
    room.reduce((sum, name) => sum + (pointsByName.get(name) as number), 0) / room.length;
  rooms.sort((a, b) => mean(b) - mean(a));
  return rooms.flatMap((room, index) => room.map((name) => ({ name, room: index + 1, isLucky: false })));
}
