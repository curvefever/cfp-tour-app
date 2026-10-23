import { isCountedPoolingRound } from './pooling';
import type { WaveMember } from './seeding';
import type { RoundAssignment, TournamentState } from './types';

/**
 * Under Standard points a place earns the same points in any room size, so a seat in a smaller room is
 * worth about half a point a round. These helpers spread those seats evenly over the counted pooling
 * rounds: the counts are derived from the line-ups already drawn, never stored.
 */

export interface SmallerRoomSplit {
  /** 1-based numbers of the rooms below the round's largest size. */
  smallRooms: number[];
  small: WaveMember[];
  large: WaveMember[];
}

/** For each unit, the seats it has held in a room smaller than the largest room of that line-up. */
export function countSmallerRoomSeats(lineUps: RoundAssignment[][]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const lineUp of lineUps) {
    const occupancy = new Map<number, number>();
    for (const { room } of lineUp) {
      if (room !== null) occupancy.set(room, (occupancy.get(room) ?? 0) + 1);
    }
    const largest = Math.max(0, ...occupancy.values());
    for (const { name, room } of lineUp) {
      if (room !== null && (occupancy.get(room) ?? 0) < largest) counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

/** The smaller-room seats each unit held in the counted pooling rounds drawn before `roundIndex`. */
export function smallerRoomSeatsBefore(
  state: Pick<TournamentState, 'rounds' | 'assignments'>,
  roundIndex: number,
): Record<string, number> {
  const lineUps = state.rounds
    .slice(0, roundIndex)
    .flatMap((round, index) => (isCountedPoolingRound(round) ? [state.assignments[index] ?? []] : []));
  return countSmallerRoomSeats(lineUps);
}

/**
 * Splits `order` (best tier first) into who takes the seats of the rooms below the largest size and who
 * takes the rest. The units with the fewest smaller-room seats so far take them; the units in
 * `lastForSmaller` come after every other unit whatever their count. Among the units tied at the boundary
 * count the picks are strided over `order`, so the smaller rooms keep a mix of tiers. Both groups keep
 * `order`'s order. Null when every room is the same size.
 */
export function splitForSmallerRooms(
  order: WaveMember[],
  roomSizes: number[],
  seats: Record<string, number>,
  lastForSmaller: ReadonlySet<string>,
): SmallerRoomSplit | null {
  const largest = Math.max(0, ...roomSizes);
  const smallRooms = roomSizes.flatMap((size, index) => (size < largest ? [index + 1] : []));
  if (smallRooms.length === 0) return null;

  const seatCount = Math.min(
    order.length,
    smallRooms.reduce((sum, room) => sum + roomSizes[room - 1], 0),
  );
  const keyOf = (member: WaveMember): [number, number] => [
    lastForSmaller.has(member.name) ? 1 : 0,
    seats[member.name] ?? 0,
  ];
  const isBefore = (first: [number, number], second: [number, number]) =>
    first[0] - second[0] || first[1] - second[1];
  const ranked = [...order].sort((first, second) => isBefore(keyOf(first), keyOf(second)));
  if (seatCount === 0) return { smallRooms, small: [], large: order };

  const boundary = keyOf(ranked[seatCount - 1]);
  const picked = new Set(
    ranked.filter((member) => isBefore(keyOf(member), boundary) < 0).map((member) => member.name),
  );
  const tied = order.filter((member) => isBefore(keyOf(member), boundary) === 0);
  const remaining = seatCount - picked.size;
  for (let index = 0; index < remaining; index += 1) {
    picked.add(tied[Math.floor(((index + 0.5) * tied.length) / remaining)].name);
  }
  return {
    smallRooms,
    small: order.filter((member) => picked.has(member.name)),
    large: order.filter((member) => !picked.has(member.name)),
  };
}
