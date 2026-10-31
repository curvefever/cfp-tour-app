// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState, TournamentTeam } from '../../domain/tournament/types';
import type { FixtureTournament } from '../../../e2e/screens/fixtures';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { renderApp, type AppRole } from '../shell/test-app';
import { ONE_SCORE_PER_TEAM } from '../../domain/tournament/formats';

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));
vi.mock('../auth/server/session-check.server-fns', () => ({ checkSession: () => Promise.resolve('valid') }));
vi.mock('../version/build-id.server-fns', async () => {
  const { TOUR_BUILD_ID } = await import('../version/build-id');
  return { getLiveBuild: () => Promise.resolve(TOUR_BUILD_ID) };
});

window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function teams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c', 'd'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

/** A single elimination 4v4 tournament of `count` teams, played up to the Semis (two rooms of two), with `games` typed in Semis room 1. */
function semisInPlay(
  count: number,
  setup: Partial<PersistedSetup>,
  games: Array<[number, number]>,
): { fixture: FixtureTournament } {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teams(count), title: 'Game Scores Cup' }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      teamScoringRule: ONE_SCORE_PER_TEAM,
      ...setup,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  let state: TournamentState = { ...result.state, started: true, tournamentId: 'game-scores' };
  while (!state.rounds[state.curRound].isSemis) {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach the Semis: ${advanced.status}`);
    state = advanced.state;
  }
  const typed = Object.fromEntries(
    games.flatMap((pair, game) =>
      pair.map((score, position) => [`r${state.curRound}-rm1-p${position}-g${game + 1}`, score]),
    ),
  );
  state = { ...state, scores: { ...state.scores, ...typed } };
  return { fixture: { id: 'game-scores', state, status: 'published', tabs: ['Bracket'] } };
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function bracketOf(fixture: FixtureTournament, role: AppRole) {
  const view = renderApp(fixture, { role, tab: 'bracket' });
  expect(consoleError).not.toHaveBeenCalled();
  return view;
}

describe('each game of a multi-game room in the Bracket', () => {
  it('gives a viewer the games in columns of a Best of 3 Semis at 37 teams, with a dash for the game not needed', () => {
    const { fixture } = semisInPlay(37, { semisBestOf: '3' }, [
      [301, 101],
      [252, 52],
    ]);
    const view = bracketOf(fixture, 'viewer');
    const semis = fixture.state.curRound;
    expect(fixture.state.rounds[semis]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(['G1', 'G2', 'G3', 'WINS'].map((label) => view.queryAllByText(label).length > 0)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    const row = Array.from(view.getAllByText('301')[0].parentElement?.children ?? []);
    expect(row.map((cell) => cell.textContent).slice(-4)).toEqual(['301', '252', '—', '2']);
  });

  it('names the result column TOTAL in a summed 2-game room', () => {
    const { fixture } = semisInPlay(37, { semisGames: '2' }, [[301, 101]]);
    const view = bracketOf(fixture, 'viewer');
    expect(fixture.state.rounds[fixture.state.curRound]).toMatchObject({ numGames: 2 });
    expect(view.queryAllByText('G2').length).toBeGreaterThan(0);
    expect(view.queryAllByText('TOTAL').length).toBeGreaterThan(0);
    expect(view.queryAllByText('301').length).toBeGreaterThan(0);
  });

  it('shows a Best of 5 in columns too, G1 to G5, never as a line under the name', () => {
    const { fixture } = semisInPlay(37, { semisBestOf: '5' }, [
      [301, 101],
      [252, 52],
    ]);
    const view = bracketOf(fixture, 'viewer');
    expect(view.queryAllByText('G5').length).toBeGreaterThan(0);
    expect(view.queryAllByText('301 · 252 · — · — · —')).toHaveLength(0);
    const row = Array.from(view.getAllByText('301')[0].parentElement?.children ?? []);
    expect(row.map((cell) => cell.textContent).slice(-6)).toEqual(['301', '252', '—', '—', '—', '2']);
  });

  it('shows 4 summed games in columns under a TOTAL header', () => {
    const { fixture } = semisInPlay(37, { semisGames: '4' }, [[301, 101]]);
    const view = bracketOf(fixture, 'viewer');
    expect(['G1', 'G4', 'TOTAL'].map((label) => view.queryAllByText(label).length > 0)).toEqual([
      true,
      true,
      true,
    ]);
    expect(view.queryAllByText('301 · — · — · —')).toHaveLength(0);
  });

  it('leaves the admin in edit mode with the score boxes, and no game columns', () => {
    const { fixture } = semisInPlay(37, { semisBestOf: '3' }, [[301, 101]]);
    const view = bracketOf(fixture, 'admin');
    expect(view.queryAllByText('WINS')).toHaveLength(0);
    expect(view.container.querySelector('input[data-key$="-g3"]')).not.toBeNull();
  });

  it('has no header row in a single-game Semis room', () => {
    const { fixture } = semisInPlay(37, {}, []);
    const view = bracketOf(fixture, 'viewer');
    expect(fixture.state.rounds[fixture.state.curRound].numGames ?? 1).toBe(1);
    expect(view.queryAllByText('G1')).toHaveLength(0);
    expect(view.queryAllByText('TOTAL')).toHaveLength(0);
  });
});
