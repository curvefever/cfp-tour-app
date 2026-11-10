import { describe, expect, it } from 'vitest';
import { deriveRoomSize, getGameFormat } from '../formats';
import { generateTournament } from '../generation';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { upperLowerEntry, upperLowerShape, upperLowerUpper, upperLowerUpperRange } from '../upper-lower';
import {
  STRATEGIES,
  expectEveryUnitRankedOnce,
  expectPlaysToTheFinal,
  playDependency,
  playToBracketEntry,
} from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

/** "Upper rooms": how many of the units that enter start in the upper rooms, each side split evenly over its own rooms. */

type Setup = Parameters<typeof createDefaultSetup>[0];

const ffa = deriveRoomSize(getGameFormat('ffa-individual') as never);

function generate(count: number, setup: Setup) {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
}

function built(count: number, setup: Setup): TournamentState {
  const result = generate(count, setup);
  if (result.status !== 'generated') throw new Error(result.message);
  return { ...result.state, started: true };
}

/** FFA: "Advance to bracket" 32 asks for everyone who fits (the automatic entry reads the pooling setting, default 24). */
const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '32' } as const;
const roomsOf = (state: TournamentState, label: string) =>
  state.rounds.find((round) => round.customLabel === label)?.rooms;

describe('the numbers that seat', () => {
  it('29 entering: 13 to 16 start in the upper rooms', () => {
    expect(upperLowerUpperRange(29, ffa)).toEqual({ min: 13, max: 16 });
  });

  it('two rooms: one room a side, within the format bounds', () => {
    expect(upperLowerUpperRange(14, ffa)).toEqual({ min: 6, max: 8 });
    expect(upperLowerUpperRange(16, ffa)).toEqual({ min: 8, max: 8 });
  });

  it('empty is evenly, a number that seats is taken, one that does not is refused naming the ones that do', () => {
    expect(upperLowerUpper(29, '', ffa)).toEqual({ ok: true, upper: null });
    expect(upperLowerUpper(29, '16', ffa)).toEqual({ ok: true, upper: 16 });
    expect(upperLowerUpper(29, '20', ffa)).toEqual({
      ok: false,
      message: "Upper rooms (20) can't be seated: with 29 entering, use 13 to 16.",
    });
    expect(upperLowerUpper(29, '12', ffa)).toMatchObject({ ok: false });
    expect(upperLowerUpper(16, '9', ffa)).toEqual({
      ok: false,
      message: "Upper rooms (9) can't be seated: with 16 entering, use 8.",
    });
    expect(upperLowerUpper(29, 'half', ffa)).toEqual({
      ok: false,
      message: 'Upper rooms must be a positive whole number — got "half".',
    });
  });
});

describe('the shape with an Upper rooms number', () => {
  it('29 with 16 upper: 8, 8 above and 7, 6 below, the rooms of the later rounds following it', () => {
    const shape = upperLowerShape(29, ffa, 4, 16);
    expect([shape.upper, shape.lower]).toEqual([
      [8, 8],
      [7, 6],
    ]);
    expect(shape.pooling.map((band) => [band.first, band.last, band.to])).toEqual([
      [1, 16, 'Round 4 - Upper'],
      [17, 29, 'Round 4 - Lower'],
    ]);
    const lowerRound = shape.rounds.find((round) => round.name === 'Round 4 - Lower');
    expect(lowerRound?.real).toEqual([7, 6]);
    expect(lowerRound?.declared).toEqual([7, 7]);
  });

  it('none, or the even split typed in, is the shape it was', () => {
    expect(upperLowerShape(29, ffa, 4, null)).toEqual(upperLowerShape(29, ffa, 4));
    expect(upperLowerShape(29, ffa, 4, 15)).toEqual(upperLowerShape(29, ffa, 4));
    expect(upperLowerShape(14, ffa, 4, 7)).toEqual(upperLowerShape(14, ffa, 4));
  });

  it('two rooms: 14 with 8 upper is a room of 8 above and 6 below', () => {
    const shape = upperLowerShape(14, ffa, 4, 8);
    expect([shape.upper, shape.lower]).toEqual([[8], [6]]);
  });
});

describe('generating with Upper rooms', () => {
  it('29 with 16: the rooms are those of the shape, and the units enter by their pooling place', () => {
    const state = built(29, { ...QUAL, upperLowerUpper: '16' });
    expect(roomsOf(state, 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([7, 6]);
    expect(state.settings?.upperLowerUpper).toBe('16');
    expect(state.gamemodeConfig.upperLowerVersion).toBe(1);
    expect(state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes).toHaveLength(29);
  });

  it('a number that cannot be seated is refused, in the words of the shape', () => {
    expect(generate(29, { ...QUAL, upperLowerUpper: '20' })).toEqual({
      status: 'invalid',
      message: "Upper rooms (20) can't be seated: with 29 entering, use 13 to 16.",
    });
  });

  it('follows "Advance to bracket": 28 of 31 with 16 upper', () => {
    const state = built(31, { ...QUAL, upperLowerAdvance: '28', upperLowerUpper: '16' });
    expect(roomsOf(state, 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(state, 'Round 4 - Lower')).toEqual([6, 6]);
  });
});

describe('every Upper rooms number that seats is played to the Final', () => {
  const CASES: Array<{ label: string; count: number; setup: Setup }> = [
    { label: 'FFA 13', count: 13, setup: QUAL },
    { label: 'FFA 14', count: 14, setup: QUAL },
    { label: 'FFA 29', count: 29, setup: QUAL },
    { label: 'FFA 31', count: 31, setup: QUAL },
    { label: 'FFA 32', count: 32, setup: QUAL },
    { label: '2v2v2v2 15', count: 15, setup: { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table' } },
    { label: '2v2v2 11', count: 11, setup: { gameFormat: 'team-2v2v2', poolingPhase: 'qual-table' } },
    {
      label: '1v1 Swiss 9',
      count: 9,
      setup: { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' },
    },
  ];
  for (const { label, count, setup } of CASES) {
    it(label, () => {
      const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup });
      const roomSize = deriveRoomSize(getGameFormat(form.gameFormat) as never);
      const entry = upperLowerEntry(count, null, roomSize);
      if (!entry.ok) throw new Error(entry.message);
      const { min, max } = upperLowerUpperRange(entry.entry, roomSize);
      for (let upper = min; upper <= max; upper += 1) {
        const state = built(count, { ...setup, upperLowerUpper: String(upper) });
        const entered = playToBracketEntry(state);
        const played = playDependency(entered, STRATEGIES['all at once'], (current) => {
          expectEveryUnitRankedOnce(current, count);
          return current;
        });
        expectEveryUnitRankedOnce(played, count);
      }
    });
  }

  it('the five press orders at FFA 29 with 16 upper, ranking rooms below their column', () => {
    expectPlaysToTheFinal(built(29, { ...QUAL, upperLowerUpper: '16' }));
  });
});
