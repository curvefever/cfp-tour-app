// @vitest-environment jsdom
import { cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
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

const GRAPH = [
  'ROUNDS:',
  'R1 = 2x2 BO3',
  'Final = 2 FINAL BO3',
  'ROUTES:',
  'R1.A: 1->Final',
  'R1.B: 1->Final',
].join('\n');

function teams(): TournamentTeam[] {
  return Array.from({ length: 4 }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c', 'd'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

/** A 4v4 Custom bracket of 4 teams, one score per team: R1 is two head-to-head Best of 3 rooms, then a Best of 3 Final. */
function bestOfTournament(scores: TournamentState['scores']): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 4, players: teams(), title: 'Best Of Cup' }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      teamScoringRule: ONE_SCORE_PER_TEAM,
      waterfallGraph: GRAPH,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  // With no pooling phase the schedule opens with two warm-up rounds: play them, so R1 is the round in play.
  let state: TournamentState = { ...result.state, started: true, tournamentId: 'best-of' };
  while (state.rounds[state.curRound].customLabel !== 'R1') {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach R1: ${advanced.status}`);
    state = advanced.state;
  }
  state = { ...state, scores: { ...state.scores, ...scores } };
  return { id: 'best-of', state, status: 'published', tabs: ['Bracket'] };
}

/** The score key of a seat in R1's room A (the third round: two warm-up rounds come first). */
/** The same tournament with R1 decided 2-0 in both rooms and advanced, so the Final is in play with `finalScores`. */
function finalInPlay(games: Array<[number, number]>): FixtureTournament {
  const decided = bestOfTournament({
    [room(0, 1)]: 30,
    [room(1, 1)]: 10,
    [room(0, 2)]: 25,
    [room(1, 2)]: 5,
    'r2-rm2-p0-g1': 30,
    'r2-rm2-p1-g1': 10,
    'r2-rm2-p0-g2': 25,
    'r2-rm2-p1-g2': 5,
  });
  const advanced = advanceTournamentRound(decided.state);
  if (advanced.status !== 'advanced') throw new Error(`could not reach the Final: ${advanced.status}`);
  const finalists = advanced.state.assignments[advanced.state.curRound].map((entry) => entry.name);
  const finalScores = Object.fromEntries(
    games.flatMap((pair, game) => pair.map((score, seat) => [`game${game + 1}-${finalists[seat]}`, score])),
  );
  return { ...decided, state: { ...advanced.state, finalScores } };
}

const room = (position: number, game: number) => `r2-rm1-p${position}-g${game}`;

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

describe('a Best-of room in the Bracket', () => {
  it('titles the column and the Final "best of 3"', () => {
    const view = bracketOf(bestOfTournament({}), 'viewer');
    expect(view.queryAllByText('BEST OF 3').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the viewer the games won so far while the match is on, and the wins once it is decided', () => {
    const inPlay = bestOfTournament({ [room(0, 1)]: 30, [room(1, 1)]: 10 });
    const during = bracketOf(inPlay, 'viewer');
    expect(
      within(during.container)
        .getAllByTitle('Games won so far')
        .map((cell) => cell.textContent),
    ).toEqual(['1', '0']);
    cleanup();

    const decided = bestOfTournament({
      [room(0, 1)]: 30,
      [room(1, 1)]: 10,
      [room(0, 2)]: 25,
      [room(1, 2)]: 5,
    });
    const after = bracketOf(decided, 'viewer');
    expect(within(after.container).queryAllByTitle('Games won so far')).toHaveLength(0);
    expect(after.container.textContent).toContain('Team 1');
  });

  it('gives the admin game boxes, the wins, and switches off the games a decided match does not need', () => {
    const decided = bestOfTournament({
      [room(0, 1)]: 30,
      [room(1, 1)]: 10,
      [room(0, 2)]: 25,
      [room(1, 2)]: 5,
    });
    const view = bracketOf(decided, 'admin');
    const game3 = view.container.querySelector<HTMLInputElement>(`input[data-key="${room(0, 3)}"]`);
    const game2 = view.container.querySelector<HTMLInputElement>(`input[data-key="${room(0, 2)}"]`);
    expect(game3?.disabled).toBe(true);
    expect(game2?.disabled).toBe(false);
    expect(view.queryAllByText(/G3 not needed/).length).toBeGreaterThan(0);
    expect(view.queryAllByText('Wins 2').length).toBeGreaterThan(0);
    expect(view.queryAllByText(/^Total/)).toHaveLength(0);
  });

  it('keeps all games open while the match is level', () => {
    const level = bestOfTournament({
      [room(0, 1)]: 30,
      [room(1, 1)]: 10,
      [room(0, 2)]: 5,
      [room(1, 2)]: 25,
    });
    const view = bracketOf(level, 'admin');
    const game3 = view.container.querySelector<HTMLInputElement>(`input[data-key="${room(0, 3)}"]`);
    expect(game3?.disabled).toBe(false);
    expect(view.queryAllByText(/not needed/)).toHaveLength(0);
  });
});

describe('a Best-of Final in the Bracket', () => {
  it('names its total column and tab Wins, and switches off the games a decided match does not need', () => {
    const fixture = finalInPlay([
      [30, 10],
      [25, 5],
    ]);
    const final = fixture.state.rounds.findIndex((round) => round.isFinal);
    expect(fixture.state.curRound).toBe(final);
    const view = bracketOf(fixture, 'admin');
    expect(view.queryAllByText('WINS').length).toBeGreaterThan(0);
    expect(view.queryByRole('button', { name: /Wins/ })).not.toBeNull();
    expect(view.queryByRole('button', { name: /Total/ })).toBeNull();
    const tabs = view.getAllByRole('button', { name: /^G3$/ });
    expect(tabs.every((tab) => (tab as HTMLButtonElement).disabled)).toBe(true);
  });

  it('keeps every game tab open while the Final is level', () => {
    const view = bracketOf(
      finalInPlay([
        [30, 10],
        [5, 25],
      ]),
      'admin',
    );
    const tabs = view.getAllByRole('button', { name: /^G3$/ });
    expect(tabs.some((tab) => (tab as HTMLButtonElement).disabled)).toBe(false);
  });
});
