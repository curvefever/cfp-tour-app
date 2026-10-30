// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fixtureTournaments, scoreCurrentRound, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { renderApp, tabsFor, type AppRole } from '../shell/test-app';

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

/** 13 players 1v1, Swiss into single elimination, Best of 3 in the pooling and elimination rounds, in the first elimination round with one room scored. */
function bestOfFixture(): FixtureTournament {
  const found = fixtureTournaments().find((fixture) => fixture.id === 'best-of-1v1-13');
  if (!found) throw new Error('no best-of fixture');
  return found;
}

/** The fixture after its first elimination round was scored and advanced (a tie at the cut-off is avoided by trying other seeds). */
function afterFirstEliminationRound(): FixtureTournament {
  const fixture = bestOfFixture();
  for (let seed = 1; seed < 40; seed += 1) {
    const result = advanceTournamentRound(scoreCurrentRound(fixture.state, { seed }));
    if (result.status === 'advanced') return { ...fixture, state: result.state };
  }
  throw new Error('could not advance the first elimination round');
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

describe('Best of 3 in a pooling round and an elimination round', () => {
  it('titles the elimination round in play "best of 3"', () => {
    const view = bracketOf(bestOfFixture(), 'viewer');
    expect(view.queryAllByText('BEST OF 3').length).toBeGreaterThan(0);
  });

  it('titles a pooling round "best of 3" too', () => {
    const fixture = bestOfFixture();
    const pooling = fixture.state.rounds.findIndex((round) => round.isSwiss);
    const view = bracketOf(advanceBackTo(fixture, pooling), 'viewer');
    expect(view.container.textContent).toMatch(/Round 1\s*NOW\s*BEST OF 3/);
    expect(view.queryAllByText('BEST OF 3').length).toBeGreaterThan(0);
  });

  it('gives a pooling room the wins and the games it needs, as an elimination room has them', () => {
    const fixture = bestOfFixture();
    const pooling = fixture.state.rounds.findIndex((round) => round.isSwiss);
    expect(fixture.state.rounds[pooling]).toMatchObject({ bestOf: 3, numGames: 3 });
    const played = advanceBackTo(fixture, pooling);
    const view = bracketOf(played, 'admin');
    expect(
      view.queryAllByText(/G3 not needed/).length + view.queryAllByText(/^Wins \d/).length,
    ).toBeGreaterThan(0);
    expect(within(view.container).queryAllByText(/^Total/)).toHaveLength(0);
  });
});

/** The fixture's first pooling round with every room scored 2-0: a state to show the room cards of a decided pooling round. */
function advanceBackTo(fixture: FixtureTournament, poolingIndex: number): FixtureTournament {
  const round = fixture.state.rounds[poolingIndex];
  const scores: Record<string, number> = {};
  fixture.state.assignments[poolingIndex].forEach((entry, seat, all) => {
    if (entry.room === null) return;
    const position = all.filter((other, index) => index < seat && other.room === entry.room).length;
    for (let game = 1; game <= 2; game += 1) {
      scores[`r${poolingIndex}-rm${entry.room}-p${position}-g${game}`] = position === 0 ? 30 : 10;
    }
  });
  expect(round.numGames).toBe(3);
  return {
    ...fixture,
    state: { ...fixture.state, curRound: poolingIndex, scores: { ...fixture.state.scores, ...scores } },
  };
}

describe('the Standings of a Best of 3 pooling round', () => {
  it('reads the games each unit won, and the points beside them', () => {
    const fixture = bestOfFixture();
    const swiss = tabsFor(fixture, 'viewer').find((tab) => tab.label === 'Swiss');
    if (!swiss) throw new Error('no Swiss tab');
    const view = renderApp(fixture, { role: 'viewer', tab: swiss.key });
    expect(view.queryAllByText(/^[012] wins?$/).length).toBeGreaterThan(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reads them in the phone list too, once a row is opened', () => {
    const fixture = bestOfFixture();
    const swiss = tabsFor(fixture, 'viewer').find((tab) => tab.label === 'Swiss');
    if (!swiss) throw new Error('no Swiss tab');
    const view = renderApp(fixture, { role: 'viewer', tab: swiss.key });
    // Both lists are in the page (a CSS switch picks one by width); the phone list's rows are the buttons that expand.
    const row = [...view.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"]')].find(
      (button) => button.textContent?.includes('Player'),
    );
    if (!row) throw new Error('no phone list row');
    fireEvent.click(row);
    expect(view.container.textContent).toMatch(/Round 1 · [012] wins? · \d+(st|nd|rd|th) · [\d.]+ pts?/);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('a unit out in a Best of 3 elimination round, in Rankings', () => {
  it('reads like any other: the round, the room and the place', () => {
    const view = renderApp(afterFirstEliminationRound(), { role: 'viewer', tab: 'rankings' });
    expect(view.container.textContent).toMatch(/Round \d+ · Room [A-Z] · 2nd/);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
