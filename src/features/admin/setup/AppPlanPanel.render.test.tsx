// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTournament } from '../../../domain/tournament/generation';
import { createDefaultTournamentState, newTournamentSetup } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { generatedState, rosterFor, testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { AppPlanPanel } from './AppPlanPanel';
import { schedulePreviewRows } from './schedule-preview-rows';
import { useAppPlan } from './useAppPlan';

let current: { state: TournamentState; setup: PersistedSetup };

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    tournaments: { summaries: [] },
    startTournamentNow: () => Promise.resolve(''),
  }),
}));

beforeEach(() => {
  show(null);
});

afterEach(cleanup);

/** A new tournament's Setup, with a roster of `count` loaded or none. */
function show(count: number | null, setup: Partial<PersistedSetup> = {}) {
  const form = { ...newTournamentSetup(), ...setup };
  const roster = count === null ? {} : { confirmedCount: count, players: rosterFor(form.gameFormat, count) };
  current = { state: createDefaultTournamentState(roster), setup: form };
}

/** The panel with its plan, as SetupView holds the typed head count. */
function Panel({ lbQualifiers }: { lbQualifiers: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const plan = useAppPlan(typed, lbQualifiers);
  return <AppPlanPanel onTypedChange={setTyped} plan={plan} typed={typed} />;
}

const panel = (lbQualifiers = '2') => <Panel lbQualifiers={lbQualifiers} />;

const countField = () => document.getElementById('app-plan-count') as HTMLInputElement;
const typeCount = (value: string) => fireEvent.change(countField(), { target: { value } });

/** The text of each item of one of the panel's two lists; empty when the list is not shown. */
function itemsOf(name: "The plan's numbers" | "The plan's rounds"): string[] {
  const list = screen.queryByRole('list', { name });
  return list
    ? within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent ?? '')
    : [];
}
const numbers = () => itemsOf("The plan's numbers");
const rounds = () => itemsOf("The plan's rounds");

const text = () => document.body.textContent ?? '';
const NOTHING = 'Type a head count, or load the roster, to see the plan.';
const STALE = 'The generated schedule uses the earlier settings: Generate again before Confirm & Start.';

describe('THE APP’S PLAN before a roster', () => {
  it('asks for a head count', () => {
    render(panel());
    expect(screen.getByText("THE APP'S PLAN")).toBeTruthy();
    expect(text()).toContain(NOTHING);
    expect(countField().value).toBe('');
    expect(numbers()).toEqual([]);
    expect(rounds()).toEqual([]);
  });

  it('plans a typed 43: its numbers, tagged, and its rounds', () => {
    render(panel());
    typeCount('43');
    expect(text()).not.toContain(NOTHING);
    expect(numbers()).toEqual([
      'Qualification: 4 roundsapp',
      'Not counted: the first roundapp',
      'Rooms: 8 · 7 · 7 · 7 · 7 · 7app',
      'In the bracket: 32 of 39 expectedapp',
      'Semis: 16 players (2 rooms of 8)app',
      'Final: 8 playersapp',
    ]);
    expect(rounds()).toHaveLength(10);
    expect(rounds()[0]).toContain('8 · 7 · 7 · 7 · 7 · 7 players');
    expect(text()).toContain('Room sizes, advancement and lucky losers are worked out for 43 players.');
    expect(text()).not.toContain('(the roster)');
  });

  it('tags a typed number', () => {
    show(null, { semisOverride: '14' });
    render(panel());
    typeCount('37');
    expect(numbers()).toContain('Semis: 14 players (2 rooms of 7)typed');
  });

  it('counts teams in a team format', () => {
    show(null, { gameFormat: 'team-2v2v2v2', teamScoringRule: 'sum-members' });
    render(panel());
    typeCount('31');
    expect(text()).toContain('worked out for 31 teams.');
    expect(countField().getAttribute('aria-label')).toBe('Number of teams the plan is for');
  });

  it('shows generation’s refusal in place of the plan, and the count stays editable', () => {
    render(panel());
    typeCount('11');
    expect(document.getElementById('app-plan-refusal')?.textContent).toBe(
      'This format needs at least 12 registered players (Semis needs 2 rooms of at least 6). Registered: 11.',
    );
    expect(numbers()).toEqual([]);
    expect(rounds()).toEqual([]);
    expect(screen.queryByRole('button', { name: /Schedule picture/ })).toBeNull();
    typeCount('12');
    expect(numbers()).not.toEqual([]);
  });

  it('works out typed counts up to 200 only', () => {
    render(panel());
    typeCount('201');
    expect(text()).toContain('Type up to 200 players to see the plan.');
    expect(numbers()).toEqual([]);
    typeCount('200');
    expect(numbers()).not.toEqual([]);
  });
});

describe('the head count with a roster', () => {
  it('is the roster’s, until another is typed', () => {
    show(37);
    render(panel());
    expect(countField().value).toBe('37');
    expect(text()).toContain('(the roster)');
    expect(numbers()).toContain('In the bracket: 28 of 33 expectedapp');
    typeCount('53');
    expect(text()).not.toContain('(the roster)');
    expect(numbers()).toContain('In the bracket: 40 of 48 expectedapp');
  });

  it('is the roster’s while the field is emptied, which shows its number again once left', () => {
    show(37);
    render(panel());
    typeCount('');
    expect(countField().value).toBe('');
    expect(text()).toContain('(the roster)');
    expect(numbers()).toContain('In the bracket: 28 of 33 expectedapp');
    fireEvent.blur(countField());
    expect(countField().value).toBe('37');
  });

  it('plans a roster above the typed limit', () => {
    show(211);
    render(panel());
    expect(text()).not.toContain('Type up to');
    expect(text()).toContain('worked out for 211 players.');
  });
});

describe('a generated schedule', () => {
  function generateNow(lbQualifiers = '2') {
    const form = { ...current.setup, lbQualifiers };
    current = { ...current, state: generatedState(generateTournament(current.state, form, testRuntime())) };
  }

  it('shows the rounds Confirm & Start would start, with no stale line', () => {
    show(43);
    generateNow();
    render(panel());
    const generated = schedulePreviewRows(current.state, 'players');
    expect(rounds()).toEqual(generated.map((row) => `${row.name}${row.meta}${row.detail}`));
    expect(text()).not.toContain(STALE);
    expect(screen.getByRole('button', { name: 'Confirm & Start' })).toBeTruthy();
  });

  it('says so once the form differs, until Generate', () => {
    show(37);
    generateNow();
    const view = render(panel());
    current = { ...current, setup: { ...current.setup, qualRoundsOverride: '3' } };
    view.rerender(panel());
    expect(text()).toContain(STALE);
    expect(numbers()[0]).toBe('Qualification: 3 roundstyped');
    expect(screen.getByRole('button', { name: 'Confirm & Start' })).toBeTruthy();
    generateNow();
    view.rerender(panel());
    expect(text()).not.toContain(STALE);
  });

  it('counts "LB qualifiers" among the settings', () => {
    show(37, { scheduleLogic: 'double-elimination-shared-final' });
    generateNow('2');
    render(panel('3'));
    expect(text()).toContain(STALE);
  });

  const otherCount = () => document.getElementById('app-plan-other-count')?.textContent ?? null;

  it('says which count Confirm & Start starts while the rounds shown are another’s', () => {
    show(37);
    generateNow();
    render(panel());
    expect(otherCount()).toBeNull();
    typeCount('31');
    expect(otherCount()).toBe(
      'These rounds are for 31 players. Confirm & Start starts the schedule generated for 37.',
    );
    expect(text()).not.toContain(STALE);
    typeCount('37');
    expect(otherCount()).toBeNull();
    typeCount('53');
    typeCount('');
    expect(otherCount()).toBeNull();
  });

  it('counts teams in that line, and puts it after the stale line', () => {
    show(31, { gameFormat: 'team-2v2v2v2', teamScoringRule: 'sum-members' });
    generateNow();
    const view = render(panel());
    current = { ...current, setup: { ...current.setup, qualRoundsOverride: '3' } };
    view.rerender(panel());
    typeCount('43');
    expect(otherCount()).toBe(
      'These rounds are for 43 teams. Confirm & Start starts the schedule generated for 31.',
    );
    const ids = [...document.querySelectorAll('[id^="app-plan-"]')].map((node) => node.id);
    expect(ids.indexOf('app-plan-stale')).toBeGreaterThan(-1);
    expect(ids.indexOf('app-plan-stale')).toBeLessThan(ids.indexOf('app-plan-other-count'));
  });

  it('has no such line without rounds to speak of, or before Generate', () => {
    show(37);
    render(panel());
    typeCount('31');
    expect(otherCount()).toBeNull();
    cleanup();
    generateNow();
    render(panel());
    typeCount('11');
    expect(otherCount()).toBeNull();
  });

  it('is gone once the tournament has started', () => {
    show(37);
    generateNow();
    current = { ...current, state: { ...current.state, started: true } };
    render(panel());
    expect(document.getElementById('preview-wrap')).toBeNull();
  });
});

describe('the schedule picture of a plan', () => {
  it('opens in a window for a typed count, with no schedule generated', () => {
    render(panel());
    typeCount('31');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Schedule picture/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Schedule')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
