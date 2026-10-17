// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActiveTab } from '../../domain/tournament/types';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { TabErrorBoundary } from './TabErrorBoundary';
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

const FALLBACK = "This page couldn't be shown.";

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
    expect(view.queryByText(FALLBACK)).toBeNull();
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

function Thrower(): never {
  throw new Error('boom');
}

describe('TabErrorBoundary', () => {
  it('shows the fallback and a Reload button instead of a child that throws, and logs the error', () => {
    const view = render(
      <TabErrorBoundary isAdmin={false}>
        <Thrower />
      </TabErrorBoundary>,
    );

    expect(view.queryByText(FALLBACK)).not.toBeNull();
    expect(view.queryByRole('button', { name: 'Reload' })).not.toBeNull();
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('shows the error message to an admin only', () => {
    const asAdmin = render(
      <TabErrorBoundary isAdmin>
        <Thrower />
      </TabErrorBoundary>,
    );
    expect(asAdmin.queryByText('boom')).not.toBeNull();
    cleanup();

    const asViewer = render(
      <TabErrorBoundary isAdmin={false}>
        <Thrower />
      </TabErrorBoundary>,
    );
    expect(asViewer.queryByText('boom')).toBeNull();
  });

  it('renders a child that does not throw as it is', () => {
    const view = render(
      <TabErrorBoundary isAdmin={false}>
        <p>fine</p>
      </TabErrorBoundary>,
    );

    expect(view.queryByText('fine')).not.toBeNull();
    expect(view.queryByText(FALLBACK)).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('leaves the tab bar standing when a tab fails: a team roster stored with the individual format', () => {
    const teams = fixtureTournaments().find((entry) => entry.id === 'upcoming-teams-13');
    if (!teams) throw new Error('the upcoming-teams-13 fixture is missing');
    const wrongFormat = { ...teams, state: { ...teams.state, gameFormat: 'ffa-individual' as const } };

    const view = renderApp(wrongFormat, { role: 'admin', tab: 'rankings' });

    expect(view.queryByText(FALLBACK)).not.toBeNull();
    const tabBar = view.getByRole('navigation', { name: 'Tournament sections' });
    expect(tabBar.querySelectorAll('button').length).toBeGreaterThan(1);
  });
});
