import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { upperLowerByHand } from '../upper-lower-form';
import { expectPlaysToTheFinal } from './dependency-play-fixtures';
import { rosterFor, testRuntime } from './test-fixtures';

/**
 * "Adjust rounds by hand": the worked-out rounds as the graph text of a Custom bracket, with the match format each round
 * has now (the Setup selects and the per-round overrides). Generated as a Custom bracket it is the bracket the app
 * worked out, and it plays the same.
 */

type Setup = Parameters<typeof createDefaultSetup>[0];

/** FFA: "Advance to bracket" 32 asks for everyone who fits (the automatic entry reads the pooling setting, default 24). */
const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '32' } as const;
const SWISS = {
  gameFormat: 'individual-1v1',
  poolingPhase: 'swiss',
  oddCountStrategy: 'bye',
  qualAdv: '8',
} as const;

function generate(count: number, setup: Setup) {
  const form = createDefaultSetup(setup);
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

function textOf(count: number, setup: Setup): string {
  const text = upperLowerByHand(createDefaultSetup({ scheduleLogic: 'upper-lower', ...setup }), count);
  if (!text.ok) throw new Error(text.message);
  return text.text;
}

/** What each round of the bracket is and plays, by name. */
const roundsOf = (state: TournamentState) =>
  state.rounds
    .filter((round) => round.isWaterfall)
    .map((round) => ({
      name: round.customLabel,
      rooms: round.rooms,
      declaredRooms: round.declaredRooms,
      players: round.players,
      bestOf: round.bestOf,
      numGames: round.numGames,
      ranking: round.waterfallRanking,
      routes: round.waterfallRoutes,
    }));

describe('the text of "Adjust rounds by hand"', () => {
  it('has no format token while every round plays one game', () => {
    expect(textOf(31, QUAL)).not.toMatch(/ BO[0-9]| GAMES /);
  });

  it('writes the format of each round from the selects and the per-round overrides, the Final with none', () => {
    const text = textOf(31, {
      ...QUAL,
      semisBestOf: '3',
      bracketGames: '2',
      finalsBestOf: '5',
      matchOverrides: 'Round 4 - Lower: BO5',
    });
    const lines = text.split('\n');
    const line = (name: string) => lines.find((entry) => entry.startsWith(`${name} = `));
    expect(line('Semi-Final A')).toBe('Semi-Final A = 8 BO3');
    expect(line('Semi-Final B')).toBe('Semi-Final B = 8 BO3');
    expect(line('Round 4 - Upper')).toBe('Round 4 - Upper = 2x8 GAMES 2');
    expect(line('Round 4 - Lower')).toBe('Round 4 - Lower = 2x8 BO5');
    expect(line('Round 5 - Ranking')).toBe('Round 5 - Ranking = 7 RANKING GAMES 2');
    expect(line('Final')).toBe('Final = 8 FINAL');
  });

  it('carries "Upper rooms" and "Advance to bracket"', () => {
    const text = textOf(29, { ...QUAL, upperLowerUpper: '16', upperLowerAdvance: '28' });
    expect(text).toContain('Qual: 1-16->Round 4 - Upper, 17-28->Round 4 - Lower');
  });

  it('is refused in the words of generation when there is no bracket', () => {
    const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...QUAL, upperLowerAdvance: '20' });
    expect(upperLowerByHand(form, 30)).toEqual({
      ok: false,
      message: 'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    });
    expect(upperLowerByHand(form, 11)).toEqual({
      ok: false,
      message: 'This format needs at least 12 registered players. Registered: 11.',
    });
  });
});

describe('as a Custom bracket it is the bracket the app worked out', () => {
  const FORMATS = {
    semisBestOf: '3',
    bracketGames: '2',
    finalsBestOf: '5',
    matchOverrides: 'Round 5 - Lower: BO3',
  } as const;

  it.each([
    ['FFA 31, a short entry round', 31, QUAL],
    ['FFA 29, Upper rooms 16', 29, { ...QUAL, upperLowerUpper: '16' }],
    ['FFA 37, 32 enter', 37, QUAL],
    ['1v1 Swiss 9', 9, SWISS],
    [
      '4v4 groups 13',
      13,
      {
        gameFormat: 'team-4v4',
        poolingPhase: 'group-stage',
        groupSize: '4',
        groupExit: 'fair-cut',
        oddCountStrategy: 'bye',
      },
    ],
  ] as const)(
    '%s: the same rounds, rooms, routes and formats, and it plays to the Final',
    (_label, count, setup) => {
      const worked = built(count, { scheduleLogic: 'upper-lower', ...setup, ...FORMATS });
      const text = textOf(count, { ...setup, ...FORMATS });
      const custom = built(count, {
        ...setup,
        ...FORMATS,
        scheduleLogic: 'waterfall-bracket',
        waterfallGraph: text,
      });
      expect(custom.gamemodeConfig.upperLowerVersion).toBeUndefined();
      expect(custom.scheduleLogic).toBe('waterfall-bracket');
      expect(roundsOf(custom)).toEqual(roundsOf(worked));
      expect(custom.cfg.qualAdv).toBe(worked.cfg.qualAdv);
      expectPlaysToTheFinal(custom);
    },
  );
});
