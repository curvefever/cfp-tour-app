import { describe, expect, it } from 'vitest';
import { MAX_KINGS_VALLEY_ROUNDS, kingsValleyBracketPhase, kingsValleyRoomBandCounts } from '../kings-valley';
import { getMinimumBracketUnits } from '../schedule-generation';
import type { RoomSize } from '../types';

const FIXED_ROOM_SIZE: RoomSize = { min: 4, max: 4, ideal: 4 };
const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const TEAM_2V2V2V2_ROOM_SIZE: RoomSize = { min: 3, max: 4, ideal: 4 };
const TEAM_3V3V3_ROOM_SIZE: RoomSize = { min: 2, max: 3, ideal: 3 };
const HEAD_TO_HEAD_ROOM_SIZE: RoomSize = { min: 2, max: 2, ideal: 2 };

describe('kingsValleyBracketPhase', () => {
  it('matches the hand-traced band counts for a 3-room, 12-player round', () => {
    const rounds = kingsValleyBracketPhase(12, 1, { roomSize: FIXED_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.isKingsValley).toBe(true);
    expect(round.rooms).toEqual([4, 4, 4]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1]);
    expect(round.kvDemoteCounts).toEqual([1, 1, 0]);
    expect(round.kvEliminateCount).toBe(2);
    expect(round.advTotal).toBe(10);
    expect(round.isFinal).toBe(false);
  });

  it('collapses immediately to a Final round when the seed total already fits one room', () => {
    const rounds = kingsValleyBracketPhase(4, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      isFinal: true,
      rooms: [4],
      numGames: 3,
      advPerRoom: 1,
      advTotal: 1,
    });
  });

  it('degenerates to a clean win-climbs/lose-drops ladder for head-to-head rooms (zero stay band)', () => {
    const rounds = kingsValleyBracketPhase(8, 1, { roomSize: HEAD_TO_HEAD_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([2, 2, 2, 2]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1]);
    // Non-bottom rooms demote 1 (the placeholder 0 belongs to the bottom room only).
    expect(round.kvDemoteCounts).toEqual([1, 1, 1, 0]);
    expect(round.kvEliminateCount).toBe(1);
    // promote(1) + demote-or-eliminate(1) === room size 2 -- no stay band.
  });

  it('conserves population across rounds (advTotal shrinks by exactly kvEliminateCount each round) and ends in a Final', () => {
    const rounds = kingsValleyBracketPhase(37, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds[0].rooms).toEqual([8, 8, 7, 7, 7]);
    expect(rounds[0].kvEliminateCount).toBe(4);
    expect(rounds[0].advTotal).toBe(33);
    expect(rounds[1].players).toBe(33);
    expect(rounds[1].rooms).toEqual([7, 7, 7, 6, 6]);

    for (let index = 1; index < rounds.length; index += 1) {
      const previous = rounds[index - 1];
      if (previous.isFinal) continue;
      expect(rounds[index].players).toBe(previous.advTotal);
    }
    expect(rounds[rounds.length - 1].isFinal).toBe(true);
    // Every round index before the Final is a real Kings Valley round with a
    // strictly increasing roundNum, matching every other bracket phase's convention.
    for (const [index, round] of rounds.slice(0, -1).entries()) {
      expect(round.isKingsValley).toBe(true);
      expect(round.roundNum).toBe(1 + index);
    }
  });

  it('force-terminates at MAX_KINGS_VALLEY_ROUNDS for a field too large to naturally converge in time', () => {
    const rounds = kingsValleyBracketPhase(200, 1, { roomSize: FFA_ROOM_SIZE, finalsGames: 3 });
    expect(rounds).toHaveLength(MAX_KINGS_VALLEY_ROUNDS + 1);
    expect(rounds[rounds.length - 1].isFinal).toBe(true);
    expect(rounds.slice(0, -1).every((round) => round.isKingsValley)).toBe(true);
  });

  // Regression: unaffected by the lone-unit fix (Stage 1, 2026-09-27) since
  // neither field ever produces a lone room -- matches today's hand-derived
  // band counts exactly (same formula as before, just routed through
  // kingsValleyRoomBandCounts instead of an inline bottom-room special case).
  it('team-2v2v2v2, 13 units: matches the hand-derived band counts (no lone room)', () => {
    const rounds = kingsValleyBracketPhase(13, 1, { roomSize: TEAM_2V2V2V2_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([4, 3, 3, 3]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1]);
    expect(round.kvDemoteCounts).toEqual([1, 1, 1, 0]);
    expect(round.kvEliminateCount).toBe(2);
    expect(round.advTotal).toBe(11);
  });

  it('team-3v3v3, 13 units: matches the hand-derived band counts (no lone room)', () => {
    const rounds = kingsValleyBracketPhase(13, 1, { roomSize: TEAM_3V3V3_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([3, 3, 3, 2, 2]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1, 1]);
    expect(round.kvDemoteCounts).toEqual([1, 1, 1, 1, 0]);
    expect(round.kvEliminateCount).toBe(1);
    expect(round.advTotal).toBe(12);
  });

  describe('head-to-head lone-unit convergence (2026-09-27 fix)', () => {
    it.each([11, 12, 13, 16])(
      'a head-to-head field of %i cuts exactly 1 per round and converges to a 2-unit Final within the round cap',
      (n) => {
        const rounds = kingsValleyBracketPhase(n, 1, { roomSize: HEAD_TO_HEAD_ROOM_SIZE, finalsGames: 3 });
        const kvRounds = rounds.filter((round) => round.isKingsValley);
        expect(kvRounds.length).toBeGreaterThan(0);
        for (const round of kvRounds) {
          expect(round.kvEliminateCount).toBe(1);
          // No stored room ever promotes+cuts more than it holds.
          const bands = kingsValleyRoomBandCounts(round.rooms);
          bands.forEach((band, index) => {
            expect(band.promote + band.cut).toBeLessThanOrEqual(round.rooms[index]);
          });
        }
        const final = rounds[rounds.length - 1];
        expect(final.isFinal).toBe(true);
        expect(final.rooms).toEqual([2]);
        expect(rounds.length).toBeLessThanOrEqual(MAX_KINGS_VALLEY_ROUNDS + 1);
      },
    );
  });
});

describe('kingsValleyRoomBandCounts', () => {
  it('a room with 0 or 1 units holds: promote 0, cut 0, eliminates false', () => {
    expect(kingsValleyRoomBandCounts([1])).toEqual([{ promote: 0, cut: 0, eliminates: false }]);
  });

  it('[2,2,1] -- bottom lone: the last room with a real match (room 2) eliminates, room 3 holds', () => {
    const bands = kingsValleyRoomBandCounts([2, 2, 1]);
    expect(bands).toEqual([
      { promote: 1, cut: 1, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
      { promote: 0, cut: 0, eliminates: false },
    ]);
  });

  it('[2,1,2] -- middle lone: the literal bottom room (room 3) still eliminates, room 2 holds', () => {
    const bands = kingsValleyRoomBandCounts([2, 1, 2]);
    expect(bands).toEqual([
      { promote: 1, cut: 1, eliminates: false },
      { promote: 0, cut: 0, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
    ]);
  });

  it('[1,2,2] -- top lone: room 1 holds, the literal bottom room (room 3) eliminates', () => {
    const bands = kingsValleyRoomBandCounts([1, 2, 2]);
    expect(bands).toEqual([
      { promote: 0, cut: 0, eliminates: false },
      { promote: 1, cut: 1, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
    ]);
  });

  it('[8,8,4] -- no lone room: matches the pre-fix formula exactly', () => {
    const bands = kingsValleyRoomBandCounts([8, 8, 4]);
    expect(bands).toEqual([
      { promote: 2, cut: 2, eliminates: false },
      { promote: 2, cut: 2, eliminates: false },
      { promote: 1, cut: 2, eliminates: true },
    ]);
  });

  it('never lets promote + cut exceed the room size, for every case above', () => {
    for (const sizes of [[1], [2, 2, 1], [2, 1, 2], [1, 2, 2], [8, 8, 4]]) {
      for (const [index, band] of kingsValleyRoomBandCounts(sizes).entries()) {
        expect(band.promote + band.cut).toBeLessThanOrEqual(sizes[index]);
      }
    }
  });
});

describe('getMinimumBracketUnits -- kings-valley', () => {
  it('returns 2 * roomSize.ideal, same floor as single-elimination', () => {
    expect(getMinimumBracketUnits('kings-valley', { min: 6, max: 8, ideal: 8 })).toBe(16);
    expect(getMinimumBracketUnits('kings-valley', { min: 2, max: 2, ideal: 2 })).toBe(4);
  });
});
