// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rosterFor } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { FormatPanel } from './FormatPanel';
import { LayeredPanel } from './LayeredPanel';

let current: { state: ReturnType<typeof createDefaultTournamentState>; setup: PersistedSetup };
/** What the panels handed to `updateSetup`: the form after each change. */
const setups: PersistedSetup[] = [];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    updateState: () => {},
    updateSetup: (change: (current: PersistedSetup) => PersistedSetup) => setups.push(change(current.setup)),
    setup: current.setup,
  }),
}));

beforeEach(() => {
  setups.length = 0;
});

afterEach(cleanup);

const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;

function atCount(count: number | null, setup: Partial<PersistedSetup> = {}) {
  const form = createDefaultSetup({ scheduleLogic: 'layered', ...QUAL, ...setup });
  current = {
    state: createDefaultTournamentState(
      count === null ? {} : { confirmedCount: count, players: rosterFor(form.gameFormat, count) },
    ),
    setup: form,
  };
}

const formatPanel = () =>
  render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);

describe('the Setup panel of a layered bracket', () => {
  it('shows nothing for another schedule logic', () => {
    atCount(31, { scheduleLogic: 'waterfall-bracket' });
    render(<LayeredPanel />);
    expect(screen.queryByText('LAYERED BRACKET')).toBeNull();
  });

  it('asks for a roster', () => {
    atCount(null);
    render(<LayeredPanel />);
    expect(
      screen.getByText('Works out the levels, rooms and rounds from the head count once a roster is loaded.'),
    ).toBeTruthy();
  });

  it('shows a refusal as an alert, in the words of generation', () => {
    atCount(31, { poolingPhase: 'swiss' });
    render(<LayeredPanel />);
    expect(document.getElementById('layered-summary')?.textContent).toMatch(
      /^A layered bracket cannot be written after a Swiss yet/,
    );
    expect(screen.queryByRole('button', { name: 'Adjust rounds by hand' })).toBeNull();
  });

  it('31 registered: the heading, the numbers with who set each, the rounds as boxes', () => {
    atCount(31);
    render(<LayeredPanel />);
    expect(
      screen.getByText(
        '31 registered · 28 expected to play · 23 in the bracket · 5 out at the table · 9 games',
      ),
    ).toBeTruthy();
    const numbers = within(document.getElementById('layered-numbers') as HTMLElement);
    expect(numbers.getByText("the app's: 9 in 10 of the 31 registered")).toBeTruthy();
    expect(numbers.getByText('2: Upper 8 · Lower 15')).toBeTruthy();
    const wide = within(document.querySelector('[data-grid="wide"]') as HTMLElement);
    expect(wide.getAllByText('Semi-Final A').length).toBeGreaterThan(0);
    expect(wide.getByText('Round 4')).toBeTruthy();
    expect(wide.getByText('Upper')).toBeTruthy();
    expect(wide.getByText('Lower')).toBeTruthy();
    expect(wide.getByText('4 wait for Semi-Final B · 4 out')).toBeTruthy();
  });

  it('draws one block per round for a phone, the same rounds as the grid', () => {
    atCount(53);
    render(<LayeredPanel />);
    const blocks = within(document.querySelector('[data-grid="phone"]') as HTMLElement);
    for (const title of ['Round 4', 'Round 5', 'Round 6', 'Semi-Final B', 'Final']) {
      expect(blocks.getAllByText(title).length, title).toBeGreaterThan(0);
    }
    expect(document.querySelectorAll('[data-grid="phone"] section')).toHaveLength(5);
  });

  it('80 registered: three levels, and the flag in words', () => {
    atCount(80);
    render(<LayeredPanel />);
    expect(document.getElementById('layered-flags')?.textContent).toBe(
      '1 room where more than half of the players do not stay in their level',
    );
    expect(
      within(document.querySelector('[data-grid="wide"]') as HTMLElement).getByText('Middle'),
    ).toBeTruthy();
  });

  it('shows a typed number as "yours"', () => {
    atCount(31, { layeredExpected: '26' });
    render(<LayeredPanel />);
    expect(within(document.getElementById('layered-numbers') as HTMLElement).getByText('yours')).toBeTruthy();
  });
});

describe('the line about the usual values', () => {
  it('is shown when the form differs, and its button sets the usual values and nothing else', () => {
    atCount(31);
    render(<LayeredPanel />);
    expect(screen.getByText(/The usual tournament has 4 table rounds/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the usual values' }));
    expect(setups).toHaveLength(1);
    expect(setups[0]).toMatchObject({
      qualRoundsOverride: '4',
      nonCountingRounds: '1',
      semisGames: '2',
      finalsGames: '2',
    });
    expect({
      ...setups[0],
      qualRoundsOverride: '',
      nonCountingRounds: '0',
      semisGames: '1',
      finalsGames: '3',
    }).toEqual(current.setup);
  });

  it('is not shown once the form has the usual values, and nothing is set without a press', () => {
    atCount(31, { qualRoundsOverride: '4', nonCountingRounds: '1', semisGames: '2', finalsGames: '2' });
    render(<LayeredPanel />);
    expect(screen.queryByText(/The usual tournament has/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use the usual values' })).toBeNull();
    expect(setups).toHaveLength(0);
  });
});

describe('"Adjust rounds by hand"', () => {
  const asked = (answer: boolean) => vi.spyOn(window, 'confirm').mockReturnValue(answer);

  it('after a confirm writes the worked-out text, with the formats of the selects, and makes it a Custom bracket', () => {
    atCount(31, { semisBestOf: '3' });
    const confirm = asked(true);
    render(<LayeredPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rounds by hand' }));
    expect(confirm.mock.calls[0][0]).toMatch(/no longer work the levels and rooms out/);
    expect(setups).toHaveLength(1);
    expect(setups[0].scheduleLogic).toBe('waterfall-bracket');
    expect(setups[0].waterfallGraph).toContain('Semi-Final A = 8 BO3');
    expect(setups[0].waterfallGraph).toContain('Qual: 1-8->Semi-Final A, 9-23->Round 4 - Lower');
    confirm.mockRestore();
  });

  it('changes nothing when the confirm is declined', () => {
    atCount(31);
    const confirm = asked(false);
    render(<LayeredPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rounds by hand' }));
    expect(setups).toHaveLength(0);
    confirm.mockRestore();
  });
});

describe('the Format panel', () => {
  it('offers the layered bracket for FFA after a qualification table, with its numbers as fields', () => {
    atCount(31, { scheduleLogic: 'single-elimination' });
    formatPanel();
    expect(screen.getByRole('option', { name: 'Layered bracket (the app writes it)' })).toBeTruthy();
    expect(screen.queryByLabelText('Expected to play (optional)')).toBeNull();
  });

  it.each([
    ['a Swiss', { poolingPhase: 'swiss' as const, gameFormat: 'individual-1v1' as const }],
    ['no pooling phase', { poolingPhase: 'none' as const }],
    ['a head-to-head format', { gameFormat: 'individual-1v1' as const }],
    ['a team format', { gameFormat: 'team-2v2v2v2' as const }],
  ])('hides it after %s', (_what, setup) => {
    atCount(31, { scheduleLogic: 'single-elimination', ...setup });
    formatPanel();
    expect(screen.queryByRole('option', { name: 'Layered bracket (the app writes it)' })).toBeNull();
  });

  it('keeps the option while it is the chosen one, so the refusal can be read', () => {
    atCount(31, { poolingPhase: 'swiss' });
    formatPanel();
    expect(screen.getByRole('option', { name: 'Layered bracket (the app writes it)' })).toBeTruthy();
  });

  it('shows the five numbers empty, with the app as placeholder, and the bracket formats; not the table advance', () => {
    atCount(31);
    formatPanel();
    const field = (label: string) => screen.getByLabelText(label);
    expect(field('Expected to play (optional)').placeholder).toBe('28');
    expect(field('In the bracket (optional)').placeholder).toBe('23');
    expect(field('Bracket rounds (optional)').placeholder).toBe('4');
    expect(field('Top level (optional)').placeholder).toBe('8');
    expect(screen.getByRole('option', { name: 'Automatic: 2' })).toBeTruthy();
    for (const label of [
      'Expected to play (optional)',
      'In the bracket (optional)',
      'Bracket rounds (optional)',
      'Top level (optional)',
    ]) {
      expect(field(label).value).toBe('');
    }
    expect(screen.queryByLabelText('Advance to bracket')).toBeNull();
    expect(screen.queryByLabelText('Advance to bracket (optional)')).toBeNull();
    expect(screen.getByLabelText('Bracket rounds format')).toBeTruthy();
    expect(screen.getByLabelText('Semis format')).toBeTruthy();
    expect(screen.getByLabelText('Finals format')).toBeTruthy();
  });

  it('types a number into the form', () => {
    atCount(31);
    formatPanel();
    fireEvent.change(screen.getByLabelText('Expected to play (optional)'), { target: { value: '26' } });
    expect(setups.at(-1)?.layeredExpected).toBe('26');
    fireEvent.change(screen.getByLabelText('Levels (optional)'), { target: { value: '3' } });
    expect(setups.at(-1)?.layeredLevels).toBe('3');
  });

  it('shows the placeholder of a field given what else is typed', () => {
    atCount(31, { layeredExpected: '26' });
    formatPanel();
    expect(screen.getByLabelText('In the bracket (optional)').placeholder).toBe('22');
  });
});
