import { describe, expect, it } from 'vitest';
import {
  distributeRooms,
  distributeRoomsWithBye,
  fitRoundToPool,
  splitAdvancement,
  validateRoomCap,
} from '../room-distribution';
import { GAME_FORMATS } from '../formats';
import type { RoomSize } from '../types';
import { buildRound } from './test-fixtures';

const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };

describe('distributeRooms', () => {
  it('returns an empty array for a non-positive count', () => {
    expect(distributeRooms(0, FFA_ROOM_SIZE)).toEqual([]);
    expect(distributeRooms(-1, FFA_ROOM_SIZE)).toEqual([]);
  });

  it('returns a single room when the count fits within max', () => {
    expect(distributeRooms(8, FFA_ROOM_SIZE)).toEqual([8]);
  });

  it('splits evenly when the count is a clean multiple of ideal', () => {
    expect(distributeRooms(16, FFA_ROOM_SIZE)).toEqual([8, 8]);
  });

  it('distributes the N=17 dead-zone case to [6,6,5], not [9,8]', () => {
    // Legacy anchor case (HANDOFF_LOG "Room cap correction"): FFA's own
    // max:8 ceiling is a competitive-preference choice, not a technical
    // limit, so 17 falls back below the 6-floor rather than exceeding 8.
    expect(distributeRooms(17, FFA_ROOM_SIZE)).toEqual([6, 6, 5]);
  });

  it('spreads the remainder across the first N rooms, largest-first', () => {
    const roomSize: RoomSize = { min: 3, max: 5, ideal: 4 };
    expect(distributeRooms(13, roomSize)).toEqual([5, 4, 4]);
  });

  it('respects a team format room size (team-3v3v3, 11 teams)', () => {
    const roomSize = GAME_FORMATS['team-3v3v3'].defaultRoomSize as RoomSize;
    expect(distributeRooms(11, roomSize)).toEqual([3, 3, 3, 2]);
  });

  it('prefers the ideal room count over the bare minimum when both fit within [minRooms, maxRooms]', () => {
    // minRooms=ceil(20/10)=2, maxRooms=floor(20/4)=5, idealRooms=round(20/6)=3.
    // A regression to bare `minRooms` here would silently produce 2 oversized
    // rooms of 10 instead of 3 well-balanced rooms of ~7.
    const roomSize: RoomSize = { min: 4, max: 10, ideal: 6 };
    expect(distributeRooms(20, roomSize)).toEqual([7, 7, 6]);
  });
});

describe('distributeRoomsWithBye', () => {
  it('produces zero byeCount when oddCountStrategy is not "bye"', () => {
    const result = distributeRoomsWithBye(11, HEAD_TO_HEAD_ROOM_SIZE, 'none');
    expect(result.byeCount).toBe(0);
  });

  it('produces zero byeCount when min !== max (variable room size absorbs the odd unit)', () => {
    const result = distributeRoomsWithBye(11, FFA_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(0);
    expect(result.rooms).toEqual([6, 5]);
  });

  it('carves exactly one bye off an odd count under "bye" with a fixed room size', () => {
    const result = distributeRoomsWithBye(11, HEAD_TO_HEAD_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(1);
    expect(result.rooms).toEqual([2, 2, 2, 2, 2]);
  });

  it('produces zero byeCount for an even count under "bye" strategy', () => {
    const result = distributeRoomsWithBye(12, HEAD_TO_HEAD_ROOM_SIZE, 'bye');
    expect(result.byeCount).toBe(0);
    expect(result.rooms).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

describe('validateRoomCap', () => {
  it('flags a room whose effective player count exceeds the hard cap for a team format', () => {
    const format = GAME_FORMATS['team-3v3v3'];
    const message = validateRoomCap([{ roundNum: 1, rooms: [4] }], format);
    expect(message).not.toBeNull();
    expect(message).toContain('Round 1');
  });

  it('passes for a room at exactly the cap boundary', () => {
    const format = GAME_FORMATS['team-2v2v2v2'];
    expect(validateRoomCap([{ roundNum: 1, rooms: [5] }], format)).toBeNull();
  });

  it('treats a format with no teamSize as 1 player per unit (ffa-individual)', () => {
    const format = GAME_FORMATS['ffa-individual'];
    expect(validateRoomCap([{ roundNum: 1, rooms: [8] }], format)).toBeNull();
  });
});

describe('splitAdvancement', () => {
  it('spreads the target over the rooms after byes advance on their own, the remainder becoming lucky slots', () => {
    expect(splitAdvancement(24, 0, 5)).toEqual({ advPerRoom: 4, luckyCount: 4 });
    expect(splitAdvancement(8, 1, 3)).toEqual({ advPerRoom: 2, luckyCount: 1 });
  });
});

describe('fitRoundToPool', () => {
  const eliminationRound = buildRound({
    roundNum: 4,
    players: 37,
    rooms: [8, 8, 7, 7, 7],
    advPerRoom: 4,
    advTotal: 24,
    luckyCount: 4,
  });

  it('returns the very same round when its seats already match the pool', () => {
    expect(fitRoundToPool(eliminationRound, 37, FFA_ROOM_SIZE)).toBe(eliminationRound);
  });

  it('re-shapes a no-elimination FFA round for one unit fewer (23 to 22)', () => {
    const round = buildRound({ roundNum: 2, isNoElim: true, players: 23, rooms: [8, 8, 7], advTotal: 23 });
    const fitted = fitRoundToPool(round, 22, FFA_ROOM_SIZE);
    expect(fitted).toMatchObject({ rooms: [8, 7, 7], players: 22, advTotal: 22, advPerRoom: null });
  });

  it('re-shapes a head-to-head round to pairs (14 to 12 units)', () => {
    const round = buildRound({
      roundNum: 1,
      isNoElim: true,
      players: 14,
      rooms: Array(7).fill(2),
      advTotal: 14,
    });
    expect(fitRoundToPool(round, 12, HEAD_TO_HEAD_ROOM_SIZE)).toMatchObject({
      rooms: Array(6).fill(2),
      players: 12,
    });
  });

  it('counts the bye units in players but not in the seats', () => {
    const round = buildRound({
      roundNum: 2,
      isNoElim: true,
      players: 13,
      rooms: Array(6).fill(2),
      byeCount: 1,
    });
    const fitted = fitRoundToPool({ ...round, advTotal: 13 }, 10, HEAD_TO_HEAD_ROOM_SIZE);
    expect(fitted).toMatchObject({ rooms: Array(5).fill(2), players: 11, advTotal: 11 });
  });

  it('keeps a Final one room, whatever its size', () => {
    const final = buildRound({
      roundNum: 9,
      isFinal: true,
      players: 8,
      rooms: [8],
      advPerRoom: 1,
      advTotal: 1,
    });
    expect(fitRoundToPool(final, 7, FFA_ROOM_SIZE)).toMatchObject({
      rooms: [7],
      players: 7,
      advPerRoom: 1,
      advTotal: 1,
    });
  });

  it("keeps an elimination round's advTotal target and re-splits it over the new rooms", () => {
    const fitted = fitRoundToPool(eliminationRound, 36, FFA_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.advTotal).toBe(24);
    expect(fitted.rooms.reduce((total, size) => total + size, 0)).toBe(36);
    expect(fitted.advPerRoom).toBe(Math.floor(24 / fitted.rooms.length));
    expect(fitted.luckyCount).toBe(24 % fitted.rooms.length);
  });

  it('also fits a pool larger than the seats, never dropping a unit', () => {
    const round = buildRound({ roundNum: 2, isNoElim: true, players: 16, rooms: [8, 8], advTotal: 16 });
    const fitted = fitRoundToPool(round, 19, FFA_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.rooms.reduce((total, size) => total + size, 0)).toBe(19);
  });

  it('still eliminates one unit when the pool equals the advTotal (36 seats, cut to 24, 24 arrive)', () => {
    const fitted = fitRoundToPool(eliminationRound, 24, FFA_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.advTotal).toBe(23);
    expect(fitted.rooms.reduce((total, size) => total + size, 0)).toBe(24);
    expect(fitted.players).toBe(24);
    expect(fitted.advPerRoom).toBe(Math.floor(23 / fitted.rooms.length));
    expect(fitted.luckyCount).toBe(23 % fitted.rooms.length);
  });

  it('a cut-by-one round (planned 8 to 7) that receives 7 eliminates one: advTotal 6', () => {
    const round = buildRound({
      roundNum: 5,
      players: 8,
      rooms: [4, 4],
      advPerRoom: 3,
      advTotal: 7,
      luckyCount: 1,
    });
    const fitted = fitRoundToPool(round, 7, FFA_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.advTotal).toBe(6);
    expect(fitted.rooms.reduce((total, size) => total + size, 0)).toBe(7);
    expect(fitted.advPerRoom).toBe(Math.floor(6 / fitted.rooms.length));
    expect(fitted.luckyCount).toBe(6 % fitted.rooms.length);
  });

  it('a round planned to eliminate nobody (plateau 16 to 16) advances everyone when one unit is missing', () => {
    const plateau = buildRound({
      roundNum: 3,
      players: 16,
      rooms: Array(8).fill(2),
      advPerRoom: 2,
      advTotal: 16,
    });
    const fitted = fitRoundToPool(plateau, 15, HEAD_TO_HEAD_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.advTotal).toBe(15);
    expect(fitted.players).toBe(15);
    expect(fitted.rooms.reduce((total, size) => total + size, 0)).toBe(15);
  });

  it('a plateau round that receives more units than planned keeps its target (it still cuts one)', () => {
    const plateau = buildRound({
      roundNum: 3,
      players: 16,
      rooms: Array(8).fill(2),
      advPerRoom: 2,
      advTotal: 16,
    });
    const fitted = fitRoundToPool(plateau, 17, HEAD_TO_HEAD_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted.advTotal).toBe(16);
  });

  it('keeps counting the bye units when it eliminates one (2 byes, pool exactly the room target)', () => {
    const round = buildRound({
      roundNum: 4,
      players: 14,
      rooms: [4, 4, 4],
      byeCount: 2,
      advPerRoom: 2,
      advTotal: 8,
    });
    const fitted = fitRoundToPool(round, 6, FFA_ROOM_SIZE);
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted).toMatchObject({ players: 8, advTotal: 7 });
  });

  it('a round left with only units on a bye is a walkover: no rooms, the byes advance', () => {
    const lbFinal = buildRound({
      roundNum: 12,
      players: 2,
      rooms: [2],
      advPerRoom: 1,
      advTotal: 1,
      byeCount: 1,
    });
    expect(fitRoundToPool(lbFinal, 0, HEAD_TO_HEAD_ROOM_SIZE)).toMatchObject({
      rooms: [],
      players: 1,
      advTotal: 1,
      advPerRoom: 0,
      luckyCount: 0,
    });
  });

  it('still errors when nobody reaches a round with no bye to advance', () => {
    const fitted = fitRoundToPool(eliminationRound, 0, FFA_ROOM_SIZE);
    expect((fitted as { error: string }).error).toContain('Nobody would reach Round 4');
  });

  it('still errors when nobody but a bye reaches the Final', () => {
    const final = buildRound({
      roundNum: 9,
      isFinal: true,
      players: 2,
      rooms: [2],
      advPerRoom: 1,
      advTotal: 1,
      byeCount: 1,
    });
    expect(fitRoundToPool(final, 0, HEAD_TO_HEAD_ROOM_SIZE)).toHaveProperty('error');
  });

  it('still errors when one unit reaches a non-Final elimination round', () => {
    const fitted = fitRoundToPool(eliminationRound, 1, FFA_ROOM_SIZE);
    expect((fitted as { error: string }).error).toContain('a unit playing alone');
  });

  it('still errors when one unit reaches the Final', () => {
    const final = buildRound({
      roundNum: 9,
      isFinal: true,
      players: 8,
      rooms: [8],
      advPerRoom: 1,
      advTotal: 1,
    });
    const fitted = fitRoundToPool(final, 1, FFA_ROOM_SIZE);
    expect((fitted as { error: string }).error).toContain('at least 2');
  });
});
