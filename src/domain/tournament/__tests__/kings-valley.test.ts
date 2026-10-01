import { describe, expect, it } from 'vitest';
import {
  MAX_KINGS_VALLEY_ROUNDS,
  kingsValleyBracketPhase,
  kingsValleyRoundMoves,
  type KingsValleyRoomBandCounts,
} from '../kings-valley';
import { isSeatable } from '../room-distribution';
import { getMinimumBracketUnits } from '../schedule-generation';
import type { RoomSize, TournamentRound } from '../types';

const FIXED_ROOM_SIZE: RoomSize = { min: 4, max: 4, ideal: 4 };
const FFA_ROOM_SIZE: RoomSize = { min: 6, max: 8, ideal: 8 };
const TEAM_2V2V2V2_ROOM_SIZE: RoomSize = { min: 3, max: 4, ideal: 4 };
const TEAM_3V3V3_ROOM_SIZE: RoomSize = { min: 2, max: 3, ideal: 3 };
// individual-1v1/team-3v3 (idealRoomSize 2) are gated out of Kings Valley
// generation as of 2026-09-28 (see "Kings Valley: gate out head-to-head
// formats" in HANDOFF_LOG.md) -- kingsValleyBracketPhase itself is still a
// pure function that would happily run at { min: 2, max: 2 }, but no real
// generation reaches that shape anymore, so the tests that pinned its
// specific behaviour there were removed rather than kept as dead coverage.

describe('kingsValleyBracketPhase', () => {
  it('matches the hand-traced band counts for a 3-room, 12-player round', () => {
    const rounds = kingsValleyBracketPhase(12, 1, { roomSize: FIXED_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.isKingsValley).toBe(true);
    expect(round.rooms).toEqual([4, 4, 4]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1]);
    // 12 [4,4,4] -> 10 [4,3,3]: room 3 must end up with 3, so room 2 demotes 2.
    expect(round.kvDemoteCounts).toEqual([1, 2, 0]);
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
  // kingsValleyRoundMoves instead of an inline bottom-room special case).
  it('team-2v2v2v2, 13 units: matches the hand-derived band counts (no lone room)', () => {
    const rounds = kingsValleyBracketPhase(13, 1, { roomSize: TEAM_2V2V2V2_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([4, 3, 3, 3]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1]);
    // 13 [4,3,3,3] -> 11 [4,4,3]: the merge needs only room 1 to demote.
    expect(round.kvDemoteCounts).toEqual([1, 0, 0, 0]);
    expect(round.kvEliminateCount).toBe(2);
    expect(round.advTotal).toBe(11);
  });

  it('team-3v3v3, 13 units: matches the hand-derived band counts (no lone room)', () => {
    const rounds = kingsValleyBracketPhase(13, 1, { roomSize: TEAM_3V3V3_ROOM_SIZE, finalsGames: 3 });
    const round = rounds[0];
    expect(round.rooms).toEqual([3, 3, 3, 2, 2]);
    expect(round.kvPromoteCounts).toEqual([1, 1, 1, 1, 1]);
    // 13 [3,3,3,2,2] -> 12 [3,3,2,2,2]: the layout change absorbs the last demotions.
    expect(round.kvDemoteCounts).toEqual([1, 1, 1, 0, 0]);
    expect(round.kvEliminateCount).toBe(1);
    expect(round.advTotal).toBe(12);
  });
});

// No room size: the plain per-room maths (the holding fallback).
function holdingBands(sizes: number[]): KingsValleyRoomBandCounts[] {
  return kingsValleyRoundMoves(sizes, undefined).bands;
}

describe('kingsValleyRoundMoves -- holding fallback', () => {
  it('a room with 0 or 1 units holds: promote 0, cut 0, eliminates false', () => {
    expect(holdingBands([1])).toEqual([{ promote: 0, cut: 0, eliminates: false }]);
  });

  it('[2,2,1] -- bottom lone: the last room with a real match (room 2) eliminates, room 3 holds', () => {
    const bands = holdingBands([2, 2, 1]);
    expect(bands).toEqual([
      { promote: 1, cut: 1, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
      { promote: 0, cut: 0, eliminates: false },
    ]);
  });

  it('[2,1,2] -- middle lone: the literal bottom room (room 3) still eliminates, room 2 holds', () => {
    const bands = holdingBands([2, 1, 2]);
    expect(bands).toEqual([
      { promote: 1, cut: 1, eliminates: false },
      { promote: 0, cut: 0, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
    ]);
  });

  it('[1,2,2] -- top lone: room 1 holds, the literal bottom room (room 3) eliminates', () => {
    const bands = holdingBands([1, 2, 2]);
    expect(bands).toEqual([
      { promote: 0, cut: 0, eliminates: false },
      { promote: 1, cut: 1, eliminates: false },
      { promote: 1, cut: 1, eliminates: true },
    ]);
  });

  it('[8,8,4] -- no lone room: matches the pre-fix formula exactly', () => {
    const bands = holdingBands([8, 8, 4]);
    expect(bands).toEqual([
      { promote: 2, cut: 2, eliminates: false },
      { promote: 2, cut: 2, eliminates: false },
      { promote: 1, cut: 2, eliminates: true },
    ]);
  });

  it('never lets promote + cut exceed the room size, for every case above', () => {
    for (const sizes of [[1], [2, 2, 1], [2, 1, 2], [1, 2, 2], [8, 8, 4]]) {
      for (const [index, band] of holdingBands(sizes).entries()) {
        expect(band.promote + band.cut).toBeLessThanOrEqual(sizes[index]);
      }
    }
  });
});

describe('getMinimumBracketUnits -- kings-valley', () => {
  it('returns 2 * roomSize.ideal, same floor as single-elimination', () => {
    expect(getMinimumBracketUnits('kings-valley', { min: 6, max: 8, ideal: 8 })).toBe(16);
  });
});

describe('kingsValleyRoundMoves -- solver', () => {
  // [rooms, cut, nextRooms, promote, demote for rooms 1..bottom-1]
  const table: [number[], number, number[], number[], number[]][] = [
    [[4, 4, 4, 4], 2, [4, 4, 3, 3], [1, 1, 1, 1], [1, 1, 2]],
    [[4, 4, 3, 3], 2, [4, 4, 4], [1, 1, 1, 1], [1, 1, 0]],
    [[4, 4, 4], 2, [4, 3, 3], [1, 1, 1], [1, 2]],
    [[4, 3, 3], 2, [4, 4], [1, 1, 1], [1, 0]],
    [[4, 4], 2, [3, 3], [1, 1], [2]],
    [[3, 3], 2, [4], [1, 1], [0]],
    [[3, 3, 3], 2, [4, 3], [1, 1, 1], [0, 0]],
    [[4, 3], 1, [3, 3], [1, 1], [2]],
  ];

  it.each(table)('%j: cut %i -> %j', (rooms, cut, nextRooms, promote, demote) => {
    const moves = kingsValleyRoundMoves(rooms, TEAM_2V2V2V2_ROOM_SIZE);
    expect(moves.nextRooms).toEqual(nextRooms);
    expect(moves.bands.map((band) => band.promote)).toEqual(promote);
    expect(moves.bands.slice(0, -1).map((band) => band.cut)).toEqual(demote);
    expect(moves.bands[moves.bands.length - 1]).toMatchObject({ cut, eliminates: true });
  });

  it('plans 9 teams as 9 -> 7 -> 6 -> Final 4, never a room of 2', () => {
    const rounds = kingsValleyBracketPhase(9, 1, { roomSize: TEAM_2V2V2V2_ROOM_SIZE, finalsGames: 3 });
    expect(rounds.map((round) => round.rooms)).toEqual([[3, 3, 3], [4, 3], [3, 3], [4]]);
  });

  it('plans 16 teams as 16 -> 14 -> 12 -> 10 -> 8 -> 6 -> Final 4', () => {
    const rounds = kingsValleyBracketPhase(16, 1, { roomSize: TEAM_2V2V2V2_ROOM_SIZE, finalsGames: 3 });
    expect(rounds.map((round) => round.rooms)).toEqual([
      [4, 4, 4, 4],
      [4, 4, 3, 3],
      [4, 4, 4],
      [4, 3, 3],
      [4, 4],
      [3, 3],
      [4],
    ]);
  });
});

/**
 * Next round's room sizes implied by applying the bands to a round's rooms,
 * written independently of the solver: room j receives the demote band above
 * it (room 1 keeps its own promote band), its own stay band, and the promote
 * band below it. Trailing empty rooms are dropped.
 */
function sizesProducedBy(rooms: number[], bands: KingsValleyRoomBandCounts[]): number[] {
  const produced = rooms.map((size, index) => {
    const stay = size - bands[index].promote - bands[index].cut;
    const fromAbove = index === 0 ? bands[0].promote : bands[index - 1].cut;
    const fromBelow = index === rooms.length - 1 ? 0 : bands[index + 1].promote;
    return fromAbove + stay + fromBelow;
  });
  while (produced.length > 0 && produced[produced.length - 1] === 0) produced.pop();
  return produced;
}

function bandsOf(round: TournamentRound): KingsValleyRoomBandCounts[] {
  const promotes = round.kvPromoteCounts ?? [];
  const demotes = round.kvDemoteCounts ?? [];
  return round.rooms.map((_, index) =>
    index === round.rooms.length - 1
      ? { promote: promotes[index], cut: round.kvEliminateCount ?? 0, eliminates: true }
      : { promote: promotes[index], cut: demotes[index], eliminates: false },
  );
}

describe('kingsValleyBracketPhase -- every seatable entry count', () => {
  // Covers every count from the format's minimum to 80, including the
  // awkward 31, 37, 43 and 53 (in 2v2v2v2 they hit the 14-round cap; the
  // cap's forced Final size is out of scope, so it is not asserted).
  const formats: [string, RoomSize][] = [
    ['team-2v2v2v2', TEAM_2V2V2V2_ROOM_SIZE],
    ['team-3v3v3', TEAM_3V3V3_ROOM_SIZE],
    ['ffa-individual', FFA_ROOM_SIZE],
  ];

  it.each(formats)('%s: rooms stay legal and the moves land exactly on the next round', (_name, roomSize) => {
    for (let count = getMinimumBracketUnits('kings-valley', roomSize); count <= 80; count += 1) {
      // An entry count that can't be seated is distributeRooms' open item, not this rule's.
      if (!isSeatable(count, roomSize)) continue;
      const rounds = kingsValleyBracketPhase(count, 1, { roomSize, finalsGames: 3 });
      const label = `${count} units`;
      const capped = rounds.length === MAX_KINGS_VALLEY_ROUNDS + 1;
      for (const [index, round] of rounds.entries()) {
        if (round.isFinal) continue;
        for (const size of round.rooms) {
          expect(size, label).toBeGreaterThanOrEqual(roomSize.min);
          expect(size, label).toBeLessThanOrEqual(roomSize.max);
        }
        const forcedFinalNext = capped && index === rounds.length - 2;
        if (!forcedFinalNext) {
          expect(sizesProducedBy(round.rooms, bandsOf(round)), `${label}, round ${round.roundNum}`).toEqual(
            rounds[index + 1].rooms,
          );
        }
        for (const [roomIndex, band] of bandsOf(round).entries()) {
          expect(band.promote, label).toBeGreaterThanOrEqual(0);
          expect(band.cut, label).toBeGreaterThanOrEqual(0);
          expect(band.promote + band.cut, label).toBeLessThanOrEqual(round.rooms[roomIndex]);
        }
      }
    }
  });
});
