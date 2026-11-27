import { describe, expect, it } from 'vitest';
import { practiceBracketEntry, requestedBracketEntry } from '../bracket-entry-default';
import { deriveRoomSize, getGameFormat } from '../formats';
import { generateTournament } from '../generation';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { GameFormatKey, RoomSize, ScheduleLogicKey } from '../types';
import { generatedState, rosterFor, testRuntime } from './test-fixtures';

const roomSizeOf = (gameFormat: GameFormatKey): RoomSize => deriveRoomSize(getGameFormat(gameFormat)!);

const FFA = roomSizeOf('ffa-individual');
const HEAD_TO_HEAD = roomSizeOf('individual-1v1');

const entryAt = (
  registered: number,
  roomSize: RoomSize,
  scheduleLogic: ScheduleLogicKey = 'single-elimination',
) => practiceBracketEntry({ registered, roomSize, scheduleLogic });

describe('practiceBracketEntry', () => {
  it.each([
    [31, 28, 21, { count: 3, size: 7 }],
    [37, 33, 28, { count: 4, size: 7 }],
    [43, 39, 32, { count: 4, size: 8 }],
    [53, 48, 40, { count: 5, size: 8 }],
  ])(
    'FFA with %i registered: %i expected to play, %i advance in equal rooms',
    (registered, play, count, rooms) => {
      expect(entryAt(registered, FFA)).toEqual({ count, play, rooms });
    },
  );

  it('1v1 single elimination: a power of two when one is in the range, else the even count closest to 80%', () => {
    expect([31, 37, 43, 53].map((registered) => entryAt(registered, HEAD_TO_HEAD).count)).toEqual([
      22, 26, 32, 38,
    ]);
    expect(entryAt(43, HEAD_TO_HEAD).rooms).toBeNull();
    expect(entryAt(31, HEAD_TO_HEAD).rooms).toEqual({ count: 11, size: 2 });
  });

  it('takes the power of two for head-to-head eliminations only', () => {
    // 42 registered: 38 play, 29 to 32; the even count closest to 80% is 30.
    expect(entryAt(42, HEAD_TO_HEAD, 'single-elimination').count).toBe(32);
    expect(entryAt(42, HEAD_TO_HEAD, 'double-elimination').count).toBe(32);
    expect(entryAt(42, HEAD_TO_HEAD, 'waterfall-bracket').count).toBe(30);
  });

  it('steps down from the ideal room size: 2v2v2v2 at 25 is 6 rooms of 3', () => {
    expect(entryAt(25, roomSizeOf('team-2v2v2v2'))).toEqual({
      count: 18,
      play: 23,
      rooms: { count: 6, size: 3 },
    });
  });

  it('takes the larger of two counts as close to 80%', () => {
    // 94 registered: 85 play, 64 to 72; both are rooms of 8, and 68 is halfway.
    expect(entryAt(94, FFA).count).toBe(72);
  });

  it('keeps to the bracket floor when the range falls under it', () => {
    expect(entryAt(14, FFA)).toEqual({ count: 12, play: 13, rooms: null });
  });

  it('takes everyone in a field at or below the floor', () => {
    expect(entryAt(12, FFA).count).toBe(12);
    expect(entryAt(10, FFA).count).toBe(10);
  });
});

describe('practiceBracketEntry among the counts a bracket can seat', () => {
  const SEATED = [12, 13, 14, 15, 16, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const countAt = (registered: number) =>
    practiceBracketEntry({ registered, roomSize: FFA, scheduleLogic: 'upper-lower', allowed: SEATED }).count;

  it('picks by the same rooms inside the range', () => {
    // 37: 25 to 28, and 28 is four rooms of 7, though 26 is closer to 80%. 43: 32 is four rooms of 8.
    expect([37, 43].map(countAt)).toEqual([28, 32]);
  });

  it('takes the closest seated count to 80% when none is in the range', () => {
    // 31: 21 to 23, with 16 and 24 on each side of 22.4. 53: 36 to 40, above them all.
    expect([31, 53].map(countAt)).toEqual([24, 32]);
  });

  it('is everyone in a field under every seated count', () => {
    expect(countAt(10)).toBe(10);
  });
});

describe('requestedBracketEntry', () => {
  const requested = (qualAdv: string) =>
    requestedBracketEntry({ qualAdv, scheduleLogic: 'single-elimination' }, 37, FFA);

  it('reads a typed number as typed, even above the head count', () => {
    expect(requested('20')).toBe(20);
    expect(requested('99')).toBe(99);
  });

  it('works the number out for an empty field', () => {
    expect(requested('')).toBe(28);
    expect(requested('  ')).toBe(28);
  });

  it('is null for text that is no positive whole number', () => {
    expect(requested('abc')).toBeNull();
    expect(requested('0')).toBeNull();
  });
});

describe('generating with "Advance to bracket"', () => {
  const generate = (qualAdv: string) =>
    generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players: rosterFor('ffa-individual', 37) }),
      createDefaultSetup({ poolingPhase: 'qual-table', qualAdv }),
      testRuntime(),
    );
  const firstBracketRoundSeats = (qualAdv: string) => {
    const state = generatedState(generate(qualAdv));
    const first = state.rounds.find((round) => !round.isQual)!;
    return { advance: state.cfg.qualAdv, seats: first.rooms.reduce((sum, seats) => sum + seats, 0) };
  };

  it('FFA at 37 after a qualification table, left empty: 28 advance and the first bracket round seats them', () => {
    expect(firstBracketRoundSeats('')).toEqual({ advance: 28, seats: 28 });
  });

  it('a typed 20 still gives 20', () => {
    expect(firstBracketRoundSeats('20')).toEqual({ advance: 20, seats: 20 });
  });

  it('a Group Stage that sends a total, left empty: 13 in 1v1 send 10 on', () => {
    // 13 registered: 12 expected to play, so 9 or 10; no power of two there, and 10 is even.
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      oddCountStrategy: 'bye',
      poolingPhase: 'group-stage',
      groupExit: 'fair-cut',
      qualAdv: '',
    });
    const state = createDefaultTournamentState({
      confirmedCount: 13,
      players: rosterFor('individual-1v1', 13),
    });
    expect(generatedState(generateTournament(state, form, testRuntime())).cfg.qualAdv).toBe(10);
  });

  it('"abc" is still refused', () => {
    expect(generate('abc')).toMatchObject({
      status: 'invalid',
      message: 'Advance to bracket must be a positive whole number — got "abc".',
    });
  });
});
