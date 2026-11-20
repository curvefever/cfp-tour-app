import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import {
  NO_LAYERED_ROSTER_TEXT,
  layeredPlaceholders,
  layeredSummary,
  type GridColumn,
  type LayeredSummary,
} from './layered-summary';

const form = (setup: Parameters<typeof createDefaultSetup>[0] = {}) =>
  createDefaultSetup({
    scheduleLogic: 'layered',
    gameFormat: 'ffa-individual',
    poolingPhase: 'qual-table',
    ...setup,
  });

const USUAL = {
  qualRoundsOverride: '4',
  nonCountingRounds: '1',
  semisGames: '2',
  finalsGames: '2',
} as const;

function readyOf(summary: LayeredSummary) {
  if (summary.kind !== 'ready')
    throw new Error(`expected ready, got ${summary.kind}: ${JSON.stringify(summary)}`);
  return summary;
}

/** A grid column as one line: each level's rooms as seats/top, and the players waiting and out. */
function lineOf(column: GridColumn): string {
  const cells = column.cells.map((cell) =>
    cell ? `${cell.name} ${cell.rooms.map((room) => `${room.seats}/${room.top}`).join('+')}` : '-',
  );
  return `${column.title}: ${cells.join(' | ')} · wait ${column.waiting} · out ${column.out}`;
}

describe('the Setup panel of a layered bracket', () => {
  it('waits for a roster', () => {
    expect(layeredSummary(form(), null)).toEqual({ kind: 'waiting', message: NO_LAYERED_ROSTER_TEXT });
  });

  it('is refused in the words of the gate: a Swiss, no pooling phase, a head-to-head format', () => {
    expect(layeredSummary(form({ poolingPhase: 'swiss' }), 31)).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/^A layered bracket cannot be written after a Swiss yet/),
    });
    expect(layeredSummary(form({ poolingPhase: 'none' }), 31)).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/^A layered bracket cannot be written without a pooling phase yet/),
    });
    expect(layeredSummary(form({ gameFormat: 'individual-1v1' }), 31)).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/^A layered bracket is not available for/),
    });
  });

  it('is refused in the words of the plan under 18 registered', () => {
    expect(layeredSummary(form(), 17)).toMatchObject({
      kind: 'refused',
      message: expect.stringMatching(/^A layered bracket needs at least 18 players registered/),
    });
  });

  it('says a typed number that is no number, before anything is planned', () => {
    expect(layeredSummary(form({ layeredExpected: 'many' }), 31)).toEqual({
      kind: 'refused',
      message: 'Expected to play must be a whole number — got "many".',
    });
    expect(layeredSummary(form({ layeredLevels: '4' }), 31)).toEqual({
      kind: 'refused',
      message: 'Levels must be 2 or 3 — got "4".',
    });
  });

  it('31 registered: the heading, then the numbers with the app as their source', () => {
    const summary = readyOf(layeredSummary(form(), 31));
    expect(summary.heading).toBe(
      '31 registered · 28 expected to play · 23 in the bracket · 5 out at the table · 9 games',
    );
    expect(summary.numbers.map((number) => [number.label, number.value])).toEqual([
      ['Expected to play', '28'],
      ['In the bracket', '23'],
      ['Levels', '2: Upper 8 · Lower 15'],
      ['Top level', '8'],
      ['Bracket rounds', '4'],
    ]);
    expect(summary.numbers[0].source).toBe("the app's: 9 in 10 of the 31 registered");
    expect(summary.numbers.every((number) => number.source.startsWith("the app's: "))).toBe(true);
    expect(summary.flags).toEqual([]);
  });

  it('31 registered, two levels: Semi-Final A takes the top row in the first round, and the others wait', () => {
    const { grid } = readyOf(layeredSummary(form(), 31));
    expect(grid.rows).toEqual(['Upper', 'Lower']);
    expect(grid.columns.map(lineOf)).toEqual([
      'Round 4: Semi-Final A 8/4 | Lower 8/4+7/4 · wait 0 · out 7',
      'Round 5: - | Lower 8/4 · wait 4 · out 4',
      'Semi-Final B: Semi-Final B 8/4 | - · wait 0 · out 4',
      'Final: Final 8/null | - · wait 0 · out 0',
    ]);
    expect(grid.columns[0].cells[0]?.note).toBe('the others wait for Semi-Final B');
    expect(grid.columns[1].cells[1]?.note).toBe('the top 4 go to Semi-Final B');
  });

  it('53 registered, two levels: Upper 2 x 8 above Lower 3 x 8, Semi-Final A in the second round', () => {
    const { grid } = readyOf(layeredSummary(form(), 53));
    expect(grid.columns.map(lineOf)).toEqual([
      'Round 4: Upper 8/4+8/4 | Lower 8/5+8/5+8/5 · wait 0 · out 9',
      'Round 5: Semi-Final A 8/4 | Lower 8/4+8/4+7/4 · wait 0 · out 11',
      'Round 6: - | Lower 8/4+8/4 · wait 0 · out 8',
      'Semi-Final B: Semi-Final B 8/4 | - · wait 0 · out 4',
      'Final: Final 8/null | - · wait 0 · out 0',
    ]);
    expect(grid.columns[1].cells[0]?.note).toBe('the others play on in the level below');
  });

  it('80 registered, three levels: a row each, the players waiting in their round, the flag in words', () => {
    const summary = readyOf(layeredSummary(form(), 80));
    expect(summary.grid.rows).toEqual(['Upper', 'Middle', 'Lower']);
    expect(summary.grid.columns.map(lineOf).slice(0, 2)).toEqual([
      'Round 4: Upper 8/4+8/4 | Middle 6/3+6/3 | Lower 8/4+8/4+8/4+8/4 · wait 0 · out 16',
      'Round 5: Semi-Final A 8/4 | Middle 7/4+7/4 | Lower 8/4+7/4+7/4 · wait 0 · out 10',
    ]);
    expect(lineOf(summary.grid.columns[4])).toBe('Round 8: - | - | Lower 6/3+6/3 · wait 2 · out 6');
    expect(summary.numbers[4].source).toBe(
      "the app's: 7 bracket rounds, one more than the usual 6 for three levels: with 6, only 52 of the 72 who play would be in the bracket (under 75%)",
    );
    expect(summary.flags).toEqual(['1 room where more than half of the players do not stay in their level']);
  });

  it('shows a typed number as yours, and plans around it', () => {
    const summary = readyOf(layeredSummary(form({ layeredExpected: '26' }), 31));
    expect(summary.numbers[0]).toEqual({
      key: 'play',
      label: 'Expected to play',
      value: '26',
      source: 'yours',
    });
    expect(summary.numbers[1].value).toBe('22');
    expect(summary.numbers[1].source.startsWith("the app's: ")).toBe(true);
  });

  it('shows a typed number the plan cannot take as it is: yours, and what the app made of it', () => {
    const summary = readyOf(layeredSummary(form({ layeredRounds: '5' }), 31));
    expect(summary.numbers[4]).toEqual({
      key: 'bracketRounds',
      label: 'Bracket rounds',
      value: '4',
      source: 'yours: you asked for 5 bracket rounds; this bracket takes 4',
    });
    // The numbers the organiser did not type stay the app's.
    expect(summary.numbers.slice(0, 4).every((number) => number.source.startsWith("the app's: "))).toBe(true);
  });

  it('words the bracket rounds the app chose: the usual number, or one fewer because that seats better', () => {
    expect(readyOf(layeredSummary(form(), 53)).numbers[4].source).toBe(
      "the app's: the usual 5 bracket rounds for two levels",
    );
    expect(readyOf(layeredSummary(form(), 31)).numbers[4].source).toBe(
      "the app's: 4 bracket rounds, one fewer than the usual 5 for two levels, because that seats better",
    );
  });

  it('words the through and last-semi notes with the count: of each room, or for a single room', () => {
    const { grid } = readyOf(layeredSummary(form(), 80));
    expect(grid.columns[3].cells[1]?.note).toBe('the top 2 go to Semi-Final B');
    expect(grid.columns[4].cells[2]?.note).toBe('the top 3 of each room go to Semi-Final B');
  });

  it('never words a number as "enter" alone or "4 stay"', () => {
    for (const registered of [24, 31, 37, 43, 53, 80]) {
      const summary = readyOf(layeredSummary(form(), registered));
      const words = [
        summary.heading,
        ...summary.numbers.flatMap((number) => [number.value, number.source]),
        ...summary.flags,
        ...summary.grid.columns.flatMap((column) => column.cells.map((cell) => cell?.note ?? '')),
      ].join(' | ');
      expect(words, `${registered} registered`).not.toMatch(/\benter\b|\d stay\b/);
    }
  });

  it('counts the games from the form: the usual values give 11 at 31 registered, a Best of 3 Semis up to 25', () => {
    expect(readyOf(layeredSummary(form(USUAL), 31)).heading).toContain('11 games');
    const longer = readyOf(layeredSummary(form({ ...USUAL, semisBestOf: '3' }), 31)).heading;
    // A Best of 3 in a room of 8 can need 9 games, the most the format allows: 4 + 1 + 9 + 9 + 2.
    expect(longer).toContain('25 games');
  });

  it('counts the table rounds and the bracket rounds format of the form', () => {
    expect(readyOf(layeredSummary(form({ ...USUAL, bracketGames: '2' }), 31)).heading).toContain('12 games');
    expect(readyOf(layeredSummary(form({ ...USUAL, poolingGames: '2' }), 31)).heading).toContain('15 games');
  });

  it('says whether the form differs from the usual values', () => {
    expect(readyOf(layeredSummary(form(), 31)).differsFromUsual).toBe(true);
    expect(readyOf(layeredSummary(form(USUAL), 31)).differsFromUsual).toBe(false);
    for (const change of [
      { qualRoundsOverride: '3' },
      { nonCountingRounds: '0' },
      { semisGames: '1' },
      { finalsGames: '3' },
      { semisBestOf: '3' },
      { finalsBestOf: '3' },
    ]) {
      expect(
        readyOf(layeredSummary(form({ ...USUAL, ...change }), 31)).differsFromUsual,
        `${JSON.stringify(change)}`,
      ).toBe(true);
    }
  });

  it.each([31, 37, 43, 53])(
    'a field of %i plans, every column of the grid has a cell per row',
    (registered) => {
      const { grid } = readyOf(layeredSummary(form(), registered));
      for (const column of grid.columns) expect(column.cells).toHaveLength(grid.rows.length);
      expect(grid.columns.at(-1)?.title).toBe('Final');
      expect(grid.columns.at(-2)?.title).toBe('Semi-Final B');
    },
  );
});

describe('the placeholders of the typed fields', () => {
  it('are the numbers the app works out', () => {
    expect(layeredPlaceholders(form(), 31)).toEqual({
      play: '28',
      inBracket: '23',
      levels: '2',
      topLevel: '8',
      bracketRounds: '4',
    });
  });

  it('follow what else is typed', () => {
    expect(layeredPlaceholders(form({ layeredExpected: '26' }), 31).inBracket).toBe('22');
  });

  it('read "automatic" with no roster or no plan', () => {
    const automatic = {
      play: 'automatic',
      inBracket: 'automatic',
      levels: 'automatic',
      topLevel: 'automatic',
      bracketRounds: 'automatic',
    };
    expect(layeredPlaceholders(form(), null)).toEqual(automatic);
    expect(layeredPlaceholders(form({ poolingPhase: 'swiss' }), 31)).toEqual(automatic);
  });
});
