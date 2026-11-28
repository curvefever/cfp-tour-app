import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import {
  USUAL_FORM_VALUES,
  differsFromUsualValues,
  layeredByHand,
  layeredGamesOf,
  layeredTypedOf,
} from '../layered-form';
import { bracketGames, USUAL_GAMES } from '../layered-plan';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { rosterFor, testRuntime } from './test-fixtures';

/** The form of a layered bracket: its typed numbers, the games it counts, "Adjust rounds by hand". */

type Setup = Parameters<typeof createDefaultSetup>[0];

const FFA_QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;
const ROOM = { min: 6, ideal: 8, max: 8 };

const formOf = (setup: Setup = {}) => createDefaultSetup({ scheduleLogic: 'layered', ...FFA_QUAL, ...setup });

function generate(count: number, setup: Setup = {}) {
  const form = formOf(setup);
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
}

function generated(count: number, setup: Setup = {}) {
  const result = generate(count, setup);
  if (result.status !== 'generated') throw new Error(JSON.stringify(result));
  return result.state;
}

describe('the numbers typed into the form', () => {
  it('are none when every field is empty', () => {
    expect(layeredTypedOf(formOf(), 4)).toEqual({ ok: true, typed: {}, orphans: [] });
  });

  it('read each field as its own number', () => {
    expect(
      layeredTypedOf(
        formOf({
          layeredExpected: '26',
          layeredInBracket: '20',
          layeredRounds: '5',
          layeredLevels: '3',
          layeredTop: '14',
        }),
        4,
      ),
    ).toEqual({
      ok: true,
      typed: { play: 26, inBracket: 20, bracketRounds: 5, levels: 3, topLevel: 14 },
      orphans: [],
    });
  });

  it.each([
    [{ layeredExpected: 'many' }, 'Expected to play must be a whole number — got "many".'],
    [{ layeredInBracket: '0' }, 'In the bracket must be a whole number — got "0".'],
    [{ layeredRounds: '4.5' }, 'Bracket rounds must be a whole number — got "4.5".'],
    [{ layeredTop: '-8' }, 'Top level must be a whole number — got "-8".'],
    [{ layeredLevels: '4' }, 'Levels must be 2 or 3 — got "4".'],
  ])('refuse %j in words', (setup, message) => {
    expect(layeredTypedOf(formOf(setup), 4)).toEqual({ ok: false, message });
  });
});

describe('generating with typed numbers', () => {
  it('31 registered, 26 expected to play: 22 in the bracket, and the number the plan was made for is 26', () => {
    const state = generated(31, { layeredExpected: '26' });
    expect(state.cfg.qualAdv).toBe(22);
    expect(state.gamemodeConfig.layeredPlay).toBe(26);
  });

  it('a typed size is taken: 53 registered with 30 in the bracket', () => {
    expect(generated(53, { layeredInBracket: '30' }).cfg.qualAdv).toBe(30);
  });

  it('two levels asked of 53 registered, with the bracket rounds typed', () => {
    const state = generated(53, { layeredLevels: '2', layeredRounds: '5' });
    expect(state.rounds.filter((round) => round.isWaterfall).length).toBeGreaterThan(0);
  });

  it('refuses a typed number that is no number, in words, before anything is drawn', () => {
    expect(generate(31, { layeredExpected: 'many' })).toEqual({
      status: 'invalid',
      message: 'Expected to play must be a whole number — got "many".',
    });
  });

  it('refuses a typed bracket no plan seats, in the plan words', () => {
    expect(generate(31, { layeredInBracket: '99' })).toMatchObject({
      status: 'invalid',
      message: expect.stringMatching(/in the bracket is outside what a layered bracket takes/),
    });
  });

  it('the typed numbers are kept in the settings snapshot', () => {
    const state = generated(31, { layeredExpected: '26', layeredLevels: '2' });
    expect(state.settings).toMatchObject({ layeredExpected: '26', layeredLevels: '2', layeredTop: '' });
  });
});

describe('the games of the whole tournament, counted from the form', () => {
  it('default form: 3 table rounds of one game, single-game bracket rounds, a Final of three games', () => {
    expect(layeredGamesOf(formOf(), ROOM, 31)).toEqual({ table: 3, bracket: 1, semis: 1, final: 3 });
  });

  it('the usual values: 4 table rounds, two games for the Semi-Finals and the Final', () => {
    const games = layeredGamesOf(formOf(USUAL_FORM_VALUES), ROOM, 31);
    expect(games).toEqual({ table: 4, bracket: 1, semis: 2, final: 2 });
    expect(games).toMatchObject({
      table: USUAL_GAMES.table,
      semis: USUAL_GAMES.semis,
      final: USUAL_GAMES.final,
    });
  });

  it('counts a Best of N at the most games a full room can need', () => {
    const games = layeredGamesOf(formOf({ semisBestOf: '3', finalsBestOf: '5' }), ROOM, 31);
    expect(games.semis).toBe(9);
    expect(games.final).toBe(17);
  });

  it('counts the table rounds the form has: a rounds override and the games of the table format', () => {
    expect(layeredGamesOf(formOf({ qualRoundsOverride: '5', poolingGames: '2' }), ROOM, 31).table).toBe(10);
  });

  it('counts the games of an ordinary bracket round in the length, the first semi-final round taking the longer', () => {
    const usual = { ...USUAL_GAMES };
    expect(bracketGames(usual, 3)).toBe(12);
    expect(bracketGames({ ...usual, bracket: 1 }, 3)).toBe(12);
    // 4 table + 2 ordinary rounds of 3 + the round of the first semi-final (3) + the last semi-final (2) + the Final (2).
    expect(bracketGames({ ...usual, bracket: 3 }, 3)).toBe(4 + 6 + 3 + 2 + 2);
    // A first semi-final over more games than an ordinary round: it takes its own.
    expect(bracketGames({ table: 4, bracket: 1, semis: 3, final: 2 }, 3)).toBe(4 + 2 + 3 + 3 + 2);
  });
});

describe('the usual values', () => {
  it('differ from the default form, and from none of themselves', () => {
    expect(differsFromUsualValues(formOf(), 31)).toBe(true);
    expect(differsFromUsualValues(formOf(USUAL_FORM_VALUES), 31)).toBe(false);
  });

  it('are what the empty table fields give under the app rule, and not without the switch', () => {
    const empty = { ...USUAL_FORM_VALUES, qualRoundsOverride: '', nonCountingRounds: '' };
    expect(differsFromUsualValues(formOf({ ...empty, poolingDefaultsVersion: '1' }), 31)).toBe(false);
    expect(differsFromUsualValues(formOf(empty), 31)).toBe(true);
  });
});

describe('"Adjust rounds by hand"', () => {
  it('writes the worked-out rounds with the format of each stage, the Final with none', () => {
    const text = layeredByHand(formOf({ semisBestOf: '3', bracketGames: '2' }), 31);
    if (!text.ok) throw new Error(text.message);
    expect(text.text).toContain('Semi-Final A = 8 BO3');
    expect(text.text).toContain('Semi-Final B = 8 BO3');
    expect(text.text).toContain('Round 4 - Lower = 8+7 GAMES 2');
    expect(text.text).toContain('Final = 8 FINAL\n');
  });

  it('a per-round override wins over its stage', () => {
    const text = layeredByHand(formOf({ bracketGames: '2', matchOverrides: 'Round 5 - Lower: BO5' }), 31);
    if (!text.ok) throw new Error(text.message);
    expect(text.text).toContain('Round 5 - Lower = 8 BO5');
    expect(text.text).toContain('Round 4 - Lower = 8+7 GAMES 2');
  });

  it('gives the refusal of the plan when there is no bracket', () => {
    expect(layeredByHand(formOf({ poolingPhase: 'swiss' }), 31)).toMatchObject({ ok: false });
    expect(layeredByHand(formOf(), 17)).toMatchObject({ ok: false });
  });

  it.each([24, 31, 37, 43, 53])(
    'at %i registered the text, as a Custom bracket, generates the same rounds and rooms',
    (count) => {
      const text = layeredByHand(formOf(), count);
      if (!text.ok) throw new Error(text.message);
      const byHand = generated(count, { scheduleLogic: 'waterfall-bracket', waterfallGraph: text.text });
      const written = generated(count);
      const shape = (state: ReturnType<typeof generated>) =>
        state.rounds.filter((round) => round.isWaterfall).map((round) => [round.customLabel, round.rooms]);
      expect(shape(byHand)).toEqual(shape(written));
      expect(byHand.gamemodeConfig.layeredVersion).toBeUndefined();
    },
  );
});
