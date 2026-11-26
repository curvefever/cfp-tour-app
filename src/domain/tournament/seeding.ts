import type { GroupExitSelection } from './group-exit';
import type { RandomSource } from './runtime';
import type { RoundAssignment, TournamentGroup } from './types';

export interface SeedCandidate {
  name: string;
  isLucky?: boolean;
}

export function candidateName(candidate: string | SeedCandidate): string {
  return typeof candidate === 'string' ? candidate : candidate.name;
}

/**
 * Best first into the rooms in passes: rooms 1..R, then R..1, then 1..R again, a full room skipped (`rooms` is the
 * room sizes, or a count for rooms of any size). The best meets the weakest in a pair of rooms, whatever the sizes.
 */
export function snakeSeed(
  candidates: Array<string | SeedCandidate>,
  rooms: number | readonly number[],
): RoundAssignment[] {
  const free = typeof rooms === 'number' ? Array.from({ length: rooms }, () => Infinity) : [...rooms];
  const assignments: RoundAssignment[] = [];
  if (free.length === 0) return assignments;
  for (let pass = 0; assignments.length < candidates.length; pass += 1) {
    const order = free.map((_, room) => room);
    if (pass % 2 === 1) order.reverse();
    const open = order.filter((room) => free[room] > 0);
    // More units than seats: the passes go on over every room.
    if (open.length === 0) free.fill(Infinity);
    for (const room of open.length > 0 ? open : order) {
      const candidate = candidates[assignments.length];
      if (candidate === undefined) break;
      free[room] -= 1;
      assignments.push({
        name: candidateName(candidate),
        room: room + 1,
        isLucky: typeof candidate === 'string' ? false : Boolean(candidate.isLucky),
      });
    }
  }
  return assignments;
}

/**
 * Slices an already-ordered (best-to-worst) list of names into consecutive
 * chunks matching `roomSizes` -- unlike snakeSeed, this does not reorder or
 * interleave anything, since the input is already globally meaningful (Kings
 * Valley's per-room promote/stay/demote merge). The target round's room
 * sizes are decided independently at generation time and are trusted as-is.
 */
export function sequentialSeed(orderedNames: string[], roomSizes: number[]): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let index = 0;
  for (const [roomIndex, size] of roomSizes.entries()) {
    for (let position = 0; position < size; position += 1) {
      const name = orderedNames[index];
      index += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: false });
    }
  }
  return assignments;
}

export function randomSeed(names: string[], rooms: number[], random: RandomSource): RoundAssignment[] {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const assignments: RoundAssignment[] = [];
  let playerIndex = 0;
  for (const [roomIndex, roomSize] of rooms.entries()) {
    for (let position = 0; position < roomSize; position += 1) {
      playerIndex += 1;
      assignments.push({
        name: shuffled[playerIndex - 1] ?? `Player ${playerIndex}`,
        room: roomIndex + 1,
        isLucky: false,
      });
    }
  }
  return assignments;
}

/** Who the group exit sent through: the exit order, and each group's units in table order (index + 1 is the group place). */
export type GroupExitOrder = Pick<GroupExitSelection, 'advancing' | 'throughByGroup'>;

interface SwapCandidate {
  name: string;
  room: number;
  index: number;
}

/**
 * The unit to swap with a colliding one. Without the group exit, the first that fits. With it, the closest to the
 * moving unit in exit order (the first room on a tie), among the units of the same group place if any fits (a winner
 * stays against a runner-up, not another winner), otherwise among all that fit: best against weakest holds as far as
 * the group-mates allow.
 */
function swapPartner(
  fitting: readonly SwapCandidate[],
  moving: string,
  exit: GroupExitOrder | undefined,
): SwapCandidate | undefined {
  if (!exit || fitting.length === 0) return fitting[0];
  const placeOf = new Map(
    exit.throughByGroup.flatMap((names) => names.map((name, position) => [name, position + 1] as const)),
  );
  const rank = (name: string) => exit.advancing.indexOf(name);
  const place = placeOf.get(moving);
  const samePlace = fitting.filter(
    (candidate) => place !== undefined && placeOf.get(candidate.name) === place,
  );
  const candidates = samePlace.length > 0 ? samePlace : fitting;
  const distance = (candidate: SwapCandidate) =>
    rank(moving) < 0 || rank(candidate.name) < 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(rank(candidate.name) - rank(moving));
  return candidates.reduce((closest, candidate) =>
    distance(candidate) < distance(closest) ? candidate : closest,
  );
}

/**
 * Best effort: a unit that shares a room with a group-mate swaps rooms with a unit that fits (its group not in this
 * room, the moving unit's group not in that room). With the group exit given, the partner is preferably a unit of the
 * same group place, closest in exit order, so the seeding holds (else the closest that fits); a collision with no fitting swap stays.
 */
export function avoidSameGroupInFirstBracketRound(
  input: RoundAssignment[],
  groups: TournamentGroup[],
  exit?: GroupExitOrder,
): RoundAssignment[] {
  const seeded = input.map((entry) => ({ ...entry }));
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) groupOf.set(member, group.label);
  }
  const byRoom = new Map<number, number[]>();
  for (const [index, entry] of seeded.entries()) {
    if (entry.room === null) continue;
    byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), index]);
  }

  for (const [room, originalIndices] of byRoom) {
    let indices = originalIndices;
    let progress = true;
    while (progress) {
      progress = false;
      const seen = new Set<string>();
      let collisionIndex = -1;
      for (const index of indices) {
        const group = groupOf.get(seeded[index].name);
        if (group === undefined) continue;
        if (seen.has(group)) {
          collisionIndex = index;
          break;
        }
        seen.add(group);
      }
      if (collisionIndex === -1) break;

      const roomGroups = indices.map((index) => groupOf.get(seeded[index].name));
      const movedGroup = groupOf.get(seeded[collisionIndex].name);
      const fitting: SwapCandidate[] = [];
      for (const [otherRoom, otherIndices] of byRoom) {
        if (otherRoom === room) continue;
        const otherGroups = otherIndices.map((index) => groupOf.get(seeded[index].name));
        if (movedGroup !== undefined && otherGroups.includes(movedGroup)) continue;
        for (const index of otherIndices) {
          const candidateGroup = groupOf.get(seeded[index].name);
          if (candidateGroup === undefined || roomGroups.includes(candidateGroup)) continue;
          fitting.push({ name: seeded[index].name, room: otherRoom, index });
        }
      }
      const partner = swapPartner(fitting, seeded[collisionIndex].name, exit);
      if (!partner) break;

      const temporaryRoom = seeded[collisionIndex].room;
      seeded[collisionIndex].room = seeded[partner.index].room;
      seeded[partner.index].room = temporaryRoom;
      indices = indices.map((index) => (index === collisionIndex ? partner.index : index));
      byRoom.set(room, indices);
      byRoom.set(
        partner.room,
        (byRoom.get(partner.room) ?? []).map((index) => (index === partner.index ? collisionIndex : index)),
      );
      progress = true;
    }
  }
  return seeded;
}
