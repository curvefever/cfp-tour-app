import { describe, expect, it } from 'vitest';
import type { RoomExitBand } from '../../domain/tournament/room-exits';
import { bandBlock, placesBlock, roomBlocks, type BlockContext } from './schedule-picture-bands';

const labels = ['Round 1', 'Semi-Final A', 'LB Round 2', 'Round 8', 'Final'].map((label, index) => ({
  label,
  roundNumber: index + 1,
}));

function context(overrides: Partial<BlockContext> = {}): BlockContext {
  return { labels, roomSize: 8, toLast: false, luckyRooms: () => 3, luckyDestination: 1, ...overrides };
}

const read = (band: RoomExitBand, overrides: Partial<BlockContext> = {}) =>
  bandBlock(band, context(overrides));

describe('bandBlock', () => {
  it('writes an advance band in the colour of its destination group, and a drop purple', () => {
    expect(read({ kind: 'advance', fromRank: 1, toRank: 4, destination: 1 })).toEqual({
      tones: ['green'],
      lines: ['1st–4th → Semi-Final A'],
    });
    expect(read({ kind: 'advance', fromRank: 5, toRank: 8, destination: 3, group: 1 })).toEqual({
      tones: ['yellow'],
      lines: ['5th–8th → Round 8'],
    });
    expect(read({ kind: 'drop', fromRank: 2, toRank: 2, destination: 2 })).toEqual({
      tones: ['purple'],
      lines: ['2nd → LB Round 2'],
    });
  });

  it('writes out red, and a ranking round neutral', () => {
    expect(read({ kind: 'eliminate', fromRank: 5, toRank: 8 })).toEqual({
      tones: ['red'],
      lines: ['5th–8th out'],
    });
    expect(read({ kind: 'eliminate', fromRank: 1, toRank: 8, placement: true })).toEqual({
      tones: ['neutral'],
      lines: ['1st–8th play for places'],
    });
    expect(read({ kind: 'advance', fromRank: 1, toRank: 2, destination: 4, placement: true }).tones).toEqual([
      'neutral',
    ]);
  });

  it('writes the last band to the end of the room when asked', () => {
    const band: RoomExitBand = { kind: 'eliminate', fromRank: 5, toRank: 8 };
    expect(read(band, { toLast: true }).lines).toEqual(['5th–last out']);
    expect(read({ ...band, toRank: 6 }, { toLast: true }).lines).toEqual(['5th–6th out']);
  });

  it('writes a lucky place in two lines and two tones: through, then out or to the losers bracket', () => {
    const lucky: RoomExitBand = { kind: 'lucky-chance', rank: 3, spots: 2, otherwise: 'eliminate' };
    expect(read(lucky, { luckyRooms: () => 5 })).toEqual({
      tones: ['green', 'red'],
      lines: ['3rd: the best 2 → Semi-Final A', 'the others out'],
    });
    expect(read({ ...lucky, otherwise: { drop: 2 } }, { luckyRooms: () => 5 })).toEqual({
      tones: ['green', 'purple'],
      lines: ['3rd: the best 2 → Semi-Final A', 'the others → LB Round 2'],
    });
    expect(read({ ...lucky, spots: 1 }, { luckyRooms: () => 2 }).lines).toEqual([
      '3rd: the best one → Semi-Final A',
      'the other out',
    ]);
  });

  it('writes the spots of a lucky place as a range when the fair cut has two room sizes', () => {
    const lucky: RoomExitBand = {
      kind: 'lucky-chance',
      rank: 6,
      spots: 2,
      minSpots: 1,
      size: 7,
      rooms: 2,
      otherwise: 'eliminate',
    };
    expect(read(lucky).lines[0]).toBe('6th: the best 1–2 → Semi-Final A');
  });

  it('writes a best of a place with the tone of each route', () => {
    const best: RoomExitBand = {
      kind: 'best-place',
      rank: 4,
      spots: 1,
      rooms: 2,
      destination: 1,
      otherwise: { advance: 3, group: 1 },
    };
    expect(read(best)).toEqual({
      tones: ['green', 'yellow'],
      lines: ['4th: the best one → Semi-Final A', 'the other → Round 8'],
    });
    expect(read({ ...best, spots: 2, rooms: 5, otherwise: 'eliminate' })).toEqual({
      tones: ['green', 'red'],
      lines: ['4th: the best 2 → Semi-Final A', 'the others out'],
    });
  });

  it('writes the Kings Valley moves in their colours', () => {
    expect(read({ kind: 'promote', fromRank: 1, toRank: 2, targetRoom: 1 })).toEqual({
      tones: ['green'],
      lines: ['1st–2nd → Room A'],
    });
    expect(read({ kind: 'stay', fromRank: 3, toRank: 5 })).toEqual({
      tones: ['yellow'],
      lines: ['3rd–5th stay'],
    });
    expect(read({ kind: 'demote', fromRank: 6, toRank: 7, targetRoom: 3 })).toEqual({
      tones: ['orange'],
      lines: ['6th–7th → Room C'],
    });
  });
});

describe('placesBlock and roomBlocks', () => {
  it('writes the places of a room that has no exit', () => {
    expect(placesBlock(8, false)).toEqual({ tones: ['neutral'], lines: ['Places 1st–8th'] });
    expect(placesBlock(8, true).lines).toEqual(['Places 1st–last']);
  });

  it('writes one block per band, in order', () => {
    const blocks = roomBlocks(
      [
        { kind: 'advance', fromRank: 1, toRank: 4, destination: 1 },
        { kind: 'eliminate', fromRank: 5, toRank: 8 },
      ],
      context(),
    );
    expect(blocks.map((block) => block.lines[0])).toEqual(['1st–4th → Semi-Final A', '5th–8th out']);
  });
});
