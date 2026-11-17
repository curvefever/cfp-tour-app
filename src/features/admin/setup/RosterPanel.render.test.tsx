// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { RosterPanel } from './RosterPanel';

let current: { state: TournamentState; setup: PersistedSetup };
/** What the panel handed to `updateState`, in order. */
const saved: TournamentState[] = [];
let loaded: number;
let alerts: string[];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    runtime: testRuntime(),
    updateState: (next: TournamentState) => saved.push(next),
    updateSetup: () => {},
  }),
}));

beforeEach(() => {
  saved.length = 0;
  loaded = 0;
  alerts = [];
  vi.spyOn(window, 'alert').mockImplementation((message) => void alerts.push(String(message)));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function load(setup: Partial<PersistedSetup>) {
  current = { state: createDefaultTournamentState(), setup: createDefaultSetup(setup) };
  render(<RosterPanel onLoaded={() => (loaded += 1)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Load roster & reserves' }));
}

const unstorable = (name: string) =>
  `"${name}" contains a character that can't be used (. # $ / [ ]) — pick a different name.`;

describe('Load roster & reserves, players: the first problem of a typed roster', () => {
  const players = (roster: string, reserves = '') => load({ gameFormat: 'ffa-individual', roster, reserves });

  it('loads a good roster and says how many', () => {
    players('Ann\nBob\nCy', 'Dee');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0].players).toEqual(['Ann', 'Bob', 'Cy']);
    expect(saved[0].reserves).toEqual(['Dee']);
    expect(loaded).toBe(1);
  });

  it('refuses a name that cannot be stored, in the roster or in the reserves', () => {
    players('Ann\nB.ob');
    expect(alerts).toEqual([unstorable('B.ob')]);
    cleanup();
    alerts.length = 0;
    players('Ann\nBob', 'Cy/x');
    expect(alerts).toEqual([unstorable('Cy/x')]);
    expect(saved).toHaveLength(0);
    expect(loaded).toBe(0);
  });

  it('refuses a name used twice across the roster and the reserves', () => {
    players('Ann\nBob', 'Ann');
    expect(alerts).toEqual([
      'These name(s) are used more than once across the roster and reserves — every player needs a unique name:\n\nAnn',
    ]);
    expect(saved).toHaveLength(0);
  });

  it('names a name that cannot be stored before a name used twice', () => {
    players('A.b\nA.b\nBob\nBob');
    expect(alerts).toEqual([unstorable('A.b')]);
  });
});

describe('Load roster & reserves, teams: the first problem of a typed roster', () => {
  const teams = (roster: string, reserves = '', reserveIndividuals = '') =>
    load({ gameFormat: 'team-2v2', roster, reserves, reserveIndividuals });
  const duplicateMessage = (names: string) =>
    `These team name(s) are used more than once across the roster and reserves — every team needs a unique name:\n\n${names}`;
  const emptyMessage = (names: string) =>
    `These team(s) have no players listed at all — add at least one "TeamName, Player1, ..." member, or remove the line:\n\n${names}`;

  it('loads good teams', () => {
    teams('Red, Ann, Bob\nBlue, Cy, Dee', 'Green, Eve, Fay', 'Gus');
    expect(alerts).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(loaded).toBe(1);
  });

  it('refuses a team, member or individual reserve name that cannot be stored', () => {
    teams('Red, An.n, Bob');
    expect(alerts).toEqual([unstorable('An.n')]);
    cleanup();
    alerts.length = 0;
    teams('Red, Ann, Bob', '', 'Gu#s');
    expect(alerts).toEqual([unstorable('Gu#s')]);
    cleanup();
    alerts.length = 0;
    teams('Re/d, Ann, Bob');
    expect(alerts).toEqual([unstorable('Re/d')]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a team with no players listed, naming each such team', () => {
    teams('Red\nBlue, Cy, Dee', 'Green');
    expect(alerts).toEqual([emptyMessage('Red\nGreen')]);
    expect(saved).toHaveLength(0);
  });

  it('refuses a team name used twice across the roster and the reserves', () => {
    teams('Red, Ann, Bob\nBlue, Cy, Dee', 'Red, Eve, Fay');
    expect(alerts).toEqual([duplicateMessage('Red')]);
    expect(saved).toHaveLength(0);
  });

  it('puts the checks in this order when a typed roster has two problems: stored names, empty teams, duplicates', () => {
    teams('Re.d\nRe.d');
    expect(alerts).toEqual([unstorable('Re.d')]);
    cleanup();
    alerts.length = 0;
    teams('Red\nRed');
    expect(alerts).toEqual([emptyMessage('Red\nRed')]);
    cleanup();
    alerts.length = 0;
    teams('Red, Ann, Bob\nRed, Cy, Dee');
    expect(alerts).toEqual([duplicateMessage('Red')]);
  });
});
