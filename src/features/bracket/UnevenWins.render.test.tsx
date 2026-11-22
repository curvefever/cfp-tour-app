// @vitest-environment jsdom
import { cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { ONE_SCORE_PER_TEAM } from '../../domain/tournament/formats';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import type { FixtureTournament } from '../../../e2e/screens/fixtures';
import { renderApp, type AppRole } from '../../test-support/test-app';

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

/** R1's room A sends its winner to the Semi and its loser to the Final, so the Final's two finalists come from R1 and from the Semi. */
const GRAPH = [
  'ROUNDS:',
  'R1 = 2x2',
  'Semi = 2',
  'Final = 2 FINAL WINS',
  'ROUTES:',
  'R1.A: 1->Semi, 2->Final',
  'R1.B: 1->Semi',
  'Semi: 1->Final',
].join('\n');

function teams(): TournamentTeam[] {
  return Array.from({ length: 4 }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c', 'd'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

function started(graph = GRAPH): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 4, players: teams(), title: 'Uneven Cup' }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      teamScoringRule: ONE_SCORE_PER_TEAM,
      waterfallGraph: graph,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  let state: TournamentState = { ...result.state, started: true, tournamentId: 'uneven' };
  while (state.rounds[state.curRound].customLabel !== 'R1') state = advanced(scoreCurrentRound(state, 0));
  return state;
}

function advanced(state: TournamentState): TournamentState {
  const next = advanceTournamentRound(state);
  if (next.status !== 'advanced') throw new Error(`could not advance: ${next.status}`);
  return next.state;
}

const fixture = (state: TournamentState): FixtureTournament => ({
  id: 'uneven',
  state,
  status: 'published',
  tabs: ['Bracket'],
});

/** The tournament with the Final drawn and `games` typed, `games[g]` being [the unit needing 1 win, the unit needing 2]. */
function finalInPlay(games: Array<[number, number]> = []): TournamentState {
  const atFinal = advanced(scoreCurrentRound(advanced(scoreCurrentRound(started(), 0)), 0));
  const final = atFinal.rounds.findIndex((round) => round.isFinal);
  expect(atFinal.curRound).toBe(final);
  const [one, two] = ['1', '2'].map(
    (needs) => atFinal.assignments[final].find((entry) => String(entry.winsNeeded) === needs)?.name as string,
  );
  const finalScores = Object.fromEntries(
    games.flatMap((pair, game) => [
      [`game${game + 1}-${one}`, pair[0]],
      [`game${game + 1}-${two}`, pair[1]],
    ]),
  );
  return { ...atFinal, finalScores };
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function bracketOf(state: TournamentState, role: AppRole) {
  const view = renderApp(fixture(state), { role, tab: 'bracket' });
  expect(consoleError).not.toHaveBeenCalled();
  return view;
}

describe('an uneven-wins Final in the Bracket', () => {
  it('names the match format in the Final column and the Final room, in the title bar and the header', () => {
    const view = bracketOf(finalInPlay(), 'viewer');
    expect(view.queryAllByText('UNEVEN WINS 1 · 2').length).toBeGreaterThanOrEqual(2);
  });

  it('opens with "0/1" and "0/2" and says what they mean', () => {
    const view = bracketOf(finalInPlay(), 'viewer');
    expect(within(view.container).getAllByTitle('0 of 1 wins needed')).toHaveLength(1);
    expect(within(view.container).getAllByTitle('0 of 2 wins needed')).toHaveLength(1);
    expect(view.queryAllByText('0/1')).toHaveLength(1);
    expect(view.queryAllByText('0/2')).toHaveLength(1);
  });

  it('is decided by the finalist needing 1 win taking game 1: "1/1" and "0/2", the second game off', () => {
    const view = bracketOf(finalInPlay([[300, 100]]), 'admin');
    expect(view.queryAllByText('1/1')).toHaveLength(1);
    expect(view.queryAllByText('0/2')).toHaveLength(1);
    const tabs = view.getAllByRole('button', { name: /^G2$/ });
    expect(tabs.every((tab) => (tab as HTMLButtonElement).disabled)).toBe(true);
  });

  it('is decided by the finalist needing 2 wins taking both games: "0/1" and "2/2"', () => {
    const view = bracketOf(
      finalInPlay([
        [100, 300],
        [100, 300],
      ]),
      'viewer',
    );
    expect(view.queryAllByText('2/2')).toHaveLength(1);
    expect(view.queryAllByText('0/1')).toHaveLength(1);
  });

  it('names the wins each slot of the Final needs before it is drawn', () => {
    const start = started();
    const view = bracketOf(start, 'viewer');
    expect(view.container.textContent).toContain('needs 1 win');
    expect(view.container.textContent).toContain('needs 2 wins');
  });
});
