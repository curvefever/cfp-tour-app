import type { RoomSize } from './types';

/**
 * How the layered bracket seats `n` players in one level of one round (`docs/rules.md`, "Layered bracket"): the fewest
 * rooms that keeps every room normal (`roomSize.min` to `roomSize.max`), filled evenly with the larger rooms first
 * (23 is 8, 8, 7). When no such split exists the rooms may be one seat below the smallest or above the largest, the
 * "last resort"; when none exists either, the level does not seat. Pure, and nothing here names a game format.
 */
export interface Seating {
  rooms: number[];
  /** The rooms outside the normal sizes (a room of 5 or 9 in FFA). */
  lastResortRooms: number;
}

/** `total` split over `parts` rooms as evenly as possible, the larger rooms first. */
export function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

const isNormal = (size: number, roomSize: RoomSize): boolean => size >= roomSize.min && size <= roomSize.max;

export function seatLevel(n: number, roomSize: RoomSize): Seating | null {
  if (n <= 0) return null;
  const fewest = Math.ceil(n / roomSize.max);
  if (fewest <= Math.floor(n / roomSize.min)) return { rooms: splitEvenly(n, fewest), lastResortRooms: 0 };
  const smallest = roomSize.min - 1;
  const largest = roomSize.max + 1;
  for (let rooms = Math.max(1, Math.ceil(n / largest)); rooms <= Math.floor(n / smallest); rooms += 1) {
    const split = splitEvenly(n, rooms);
    if (split.every((size) => size >= smallest && size <= largest)) {
      return { rooms: split, lastResortRooms: split.filter((size) => !isNormal(size, roomSize)).length };
    }
  }
  return null;
}

/** Whether `n` seats in normal rooms only. */
export function seatsNormally(n: number, roomSize: RoomSize): boolean {
  return seatLevel(n, roomSize)?.lastResortRooms === 0;
}

/** Seats missing from full rooms: how far each room of the level is under the full room. */
export function missingSeats(rooms: number[], roomSize: RoomSize): number {
  return rooms.reduce((total, size) => total + Math.max(0, roomSize.ideal - size), 0);
}
