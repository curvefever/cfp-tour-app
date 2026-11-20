// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fixtureTournaments } from '../../../e2e/screens/fixtures';
import { renderApp, tabsFor, type AppRole } from '../../test-support/test-app';
import { FALLBACK } from './app-shell-sweep';

// Only what reaches the network is replaced, as in the other render tests of the shell.
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

const ROLES: AppRole[] = ['viewer', 'admin'];

const layered = (() => {
  const fixture = fixtureTournaments().find((entry) => entry.id === 'layered-31');
  if (!fixture) throw new Error('the layered-31 fixture is missing');
  return fixture;
})();

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('a layered bracket at 31 players, played into its first bracket round', () => {
  it('is a layered bracket in its first round: Semi-Final A and the Lower level of 8 + 7', () => {
    const labels = layered.state.rounds
      .filter((round) => round.isWaterfall)
      .map((round) => round.customLabel);
    expect(labels).toEqual(['Semi-Final A', 'Round 4 - Lower', 'Round 5 - Lower', 'Semi-Final B', 'Final']);
    expect(layered.state.rounds[layered.state.curRound].customLabel).toBe('Semi-Final A');
    expect(layered.state.gamemodeConfig.layeredVersion).toBe(1);
  });

  it.each(ROLES.flatMap((role) => tabsFor(layered, role).map((tab) => [role, tab.label, tab.key] as const)))(
    'renders the %s %s tab without a failure',
    (role, _label, tab) => {
      const view = renderApp(layered, { role, tab });

      expect(consoleError).not.toHaveBeenCalled();
      expect(view.queryByText(FALLBACK)).toBeNull();
    },
  );

  it.each(ROLES)('shows the layered round names on the Bracket as a %s', (role) => {
    const view = renderApp(layered, { role, tab: 'bracket' });

    for (const name of ['Semi-Final A', 'Round 4 - Lower', 'Round 5 - Lower', 'Semi-Final B', 'Final']) {
      expect(view.queryAllByText(name).length, name).toBeGreaterThan(0);
    }
  });

  it('shows the Info tab the layered bracket by its own name', () => {
    const view = renderApp(layered, { role: 'viewer', tab: 'info' });

    expect(view.container.textContent).toContain('Layered bracket');
  });
});
