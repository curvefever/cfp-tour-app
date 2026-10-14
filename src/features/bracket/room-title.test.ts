import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { roomTitle } from './room-title';

describe('roomTitle', () => {
  it('names an ordinary room "Room A", "Room B", ...', () => {
    const round = buildRound({ roundNum: 4, rooms: [8, 8, 7] });
    expect([0, 1, 2].map((index) => roomTitle(round, index))).toEqual(['Room A', 'Room B', 'Room C']);
  });

  it('names Semis rooms "Semi A" and "Semi B"', () => {
    const round = buildRound({ roundNum: 6, rooms: [8, 8], isSemis: true });
    expect([0, 1].map((index) => roomTitle(round, index))).toEqual(['Semi A', 'Semi B']);
  });

  it('names the Final, and a double-elimination Grand Final, "Final"', () => {
    expect(roomTitle(buildRound({ roundNum: 7, rooms: [8], isFinal: true }), 0)).toBe('Final');
    expect(roomTitle(buildRound({ roundNum: 9, rooms: [2], bracket: 'grand-final', isFinal: true }), 0)).toBe(
      'Final',
    );
  });

  it('names a group-stage room with its group: "Group A · Room B"', () => {
    const round = buildRound({
      roundNum: 2,
      rooms: [4, 4, 4],
      isGroupStage: true,
      roomGroups: ['A', 'A', 'B'],
    });
    expect([0, 1, 2].map((index) => roomTitle(round, index))).toEqual([
      'Group A · Room A',
      'Group A · Room B',
      'Group B · Room C',
    ]);
  });

  it('reads the round flags, not its label: a waterfall round called "SemiA" or "Final" is just "Room A" unless it is flagged', () => {
    const waterfall = buildRound({ roundNum: 5, rooms: [8], isWaterfall: true, customLabel: 'SemiA' });
    expect(roomTitle(waterfall, 0)).toBe('Room A');
    const waterfallFinal = buildRound({
      roundNum: 6,
      rooms: [8],
      isWaterfall: true,
      customLabel: 'Final',
      isFinal: true,
    });
    expect(roomTitle(waterfallFinal, 0)).toBe('Final');
  });

  it('names the other round kinds (qual, Swiss, Kings Valley, winners and losers brackets) "Room A"', () => {
    for (const flags of [{ isQual: true }, { isSwiss: true }, { isKingsValley: true }]) {
      expect(roomTitle(buildRound({ roundNum: 1, rooms: [4], ...flags }), 0)).toBe('Room A');
    }
    expect(roomTitle(buildRound({ roundNum: 3, rooms: [2], bracket: 'winners' }), 0)).toBe('Room A');
    expect(roomTitle(buildRound({ roundNum: 4, rooms: [2], bracket: 'losers' }), 0)).toBe('Room A');
  });

  it('continues the letters past Z for a very large round', () => {
    const round = buildRound({ roundNum: 1, rooms: Array.from({ length: 27 }, () => 2) });
    expect(roomTitle(round, 25)).toBe('Room Z');
    expect(roomTitle(round, 26)).toBe('Room AA');
  });
});
