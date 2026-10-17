// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActiveTab } from '../../domain/tournament/types';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { renderApp, tabsFor, type AppRole } from './test-app';

// Only what reaches the network is replaced: the presence subscription and the presence server function.
vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));

// jsdom has no layout engine: the few browser APIs the tabs read are stubbed with their "nothing matches" answers.
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

interface Row {
  name: string;
  fixture: FixtureTournament;
  role: AppRole;
  tab: ActiveTab;
}

const rows: Row[] = fixtureTournaments().flatMap((fixture) =>
  ROLES.flatMap((role) =>
    tabsFor(fixture, role).map(({ key, label }) => ({
      name: `${fixture.id} · ${role} · ${label}`,
      fixture,
      role,
      tab: key,
    })),
  ),
);

function teamsOf(fixture: FixtureTournament) {
  return fixture.state.players.filter((player) => typeof player === 'object');
}

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('AppShell, every tab of every fixture', () => {
  it.each(rows)('$name', ({ fixture, role, tab }) => {
    const view = renderApp(fixture, { role, tab });

    expect(consoleError).not.toHaveBeenCalled();
    if (tab !== 'tournaments') {
      expect(view.queryAllByRole('heading', { name: fixture.state.title }).length).toBeGreaterThan(0);
    }
    if (tab === 'rankings') {
      for (const team of teamsOf(fixture)) {
        expect(view.queryAllByText(team.teamId, { exact: true })).toHaveLength(0);
        expect(view.queryAllByText(team.teamName, { exact: true }).length).toBeGreaterThan(0);
      }
    }
  });
});
