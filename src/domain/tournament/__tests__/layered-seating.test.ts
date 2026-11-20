import { describe, expect, it } from 'vitest';
import { missingSeats, seatLevel, seatsNormally, splitEvenly } from '../layered-seating';
import type { RoomSize } from '../types';

const FFA: RoomSize = { min: 6, max: 8, ideal: 8 };

describe('splitEvenly', () => {
  it('fills the rooms evenly, the larger rooms first', () => {
    expect(splitEvenly(23, 3)).toEqual([8, 8, 7]);
    expect(splitEvenly(40, 5)).toEqual([8, 8, 8, 8, 8]);
    expect(splitEvenly(13, 2)).toEqual([7, 6]);
  });
});

describe('seatLevel: the fewest rooms that keep every room normal', () => {
  it.each([
    [6, [6]],
    [8, [8]],
    [12, [6, 6]],
    [13, [7, 6]],
    [16, [8, 8]],
    [23, [8, 8, 7]],
    [24, [8, 8, 8]],
    [25, [7, 6, 6, 6]],
    [40, [8, 8, 8, 8, 8]],
  ])('seats %i as %j in normal rooms', (players, rooms) => {
    expect(seatLevel(players, FFA)).toEqual({ rooms, lastResortRooms: 0 });
  });

  it('uses rooms one seat under the smallest or over the largest only when no normal split exists', () => {
    expect(seatLevel(5, FFA)).toEqual({ rooms: [5], lastResortRooms: 1 });
    expect(seatLevel(9, FFA)).toEqual({ rooms: [9], lastResortRooms: 1 });
    expect(seatLevel(17, FFA)).toEqual({ rooms: [9, 8], lastResortRooms: 1 });
  });

  it('does not seat a level that no room size reaches', () => {
    expect(seatLevel(0, FFA)).toBeNull();
    expect(seatLevel(4, FFA)).toBeNull();
  });

  it('follows the room size it is given, not the FFA one', () => {
    const rooms: RoomSize = { min: 4, max: 5, ideal: 4 };
    expect(seatLevel(9, rooms)).toEqual({ rooms: [5, 4], lastResortRooms: 0 });
    expect(seatLevel(7, rooms)).toEqual({ rooms: [4, 3], lastResortRooms: 1 });
  });
});

describe('seatsNormally and missingSeats', () => {
  it('says whether a level seats in normal rooms only', () => {
    expect(seatsNormally(23, FFA)).toBe(true);
    expect(seatsNormally(5, FFA)).toBe(false);
    expect(seatsNormally(4, FFA)).toBe(false);
  });

  it('counts the seats under a full room over all the rooms', () => {
    expect(missingSeats([8, 8, 7], FFA)).toBe(1);
    expect(missingSeats([7, 7, 6], FFA)).toBe(4);
    expect(missingSeats([8, 8], FFA)).toBe(0);
  });
});
