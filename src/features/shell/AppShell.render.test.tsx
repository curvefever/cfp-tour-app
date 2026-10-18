// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActiveTab, TournamentState } from '../../domain/tournament/types';
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

describe('Players tab, drawn rooms and the start', () => {
  const drawn = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'drawn-ffa-31');
    if (!fixture) throw new Error('the drawn-ffa-31 fixture is missing');
    return fixture;
  };

  it('shows a viewer the plain roster: no rooms, no Download image', () => {
    const view = renderApp(drawn(), { role: 'viewer', tab: 'rankings' });

    expect(view.queryAllByText(/31 players registered so far/)).toHaveLength(1);
    expect(view.queryAllByText(/Round 1 ·/)).toHaveLength(0);
    expect(view.queryByRole('button', { name: /Download image/ })).toBeNull();
  });

  it('still shows a viewer the rankings once the tournament has started', () => {
    const started = fixtureTournaments().find((entry) => entry.id === 'ffa37-pooling');
    if (!started) throw new Error('the ffa37-pooling fixture is missing');

    const view = renderApp(started, { role: 'viewer', tab: 'rankings' });

    expect(view.queryByRole('button', { name: /Download image/ })).not.toBeNull();
    expect(view.queryAllByText(/(Round [0-9]+|Qualification) ·/).length).toBeGreaterThan(0);
  });

  it('still shows an admin the drawn rooms', () => {
    const view = renderApp(drawn(), { role: 'admin', tab: 'rankings' });

    expect(view.queryAllByText(/Round 1 ·/).length).toBeGreaterThan(0);
  });
});

describe('Players tab, confirmations in the organiser tools', () => {
  const upcomingFixture = (id: string, patch: Partial<TournamentState>): FixtureTournament => {
    const fixture = fixtureTournaments().find((entry) => entry.id === id);
    if (!fixture) throw new Error(`the ${id} fixture is missing`);
    return { ...fixture, state: { ...fixture.state, ...patch } };
  };
  const confirmed = (...names: string[]) => Object.fromEntries(names.map((name) => [name, true as const]));
  const pressed = (view: ReturnType<typeof renderApp>, name: string) =>
    view.getByRole('button', { name: `Confirmed: ${name}` }).getAttribute('aria-pressed');

  it('gives each of 37 players a toggle, and counts the confirmed ones in the header', () => {
    const fixture = upcomingFixture('upcoming-info', {
      confirmations: confirmed('Player 01', 'Player 05'),
    });
    const view = renderApp(fixture, { role: 'admin', tab: 'rankings' });

    expect(view.queryAllByRole('button', { name: /^Confirmed: Player / })).toHaveLength(37);
    expect(pressed(view, 'Player 01')).toBe('true');
    expect(pressed(view, 'Player 05')).toBe('true');
    expect(pressed(view, 'Player 02')).toBe('false');
    expect(view.queryAllByText('2 of 37 confirmed')).toHaveLength(1);
  });

  it('gives a reserve its own toggle, and leaves reserves out of the header count', () => {
    const fixture = upcomingFixture('upcoming-info', { confirmations: confirmed('Larch') });
    const view = renderApp(fixture, { role: 'admin', tab: 'rankings' });

    expect(pressed(view, 'Larch')).toBe('true');
    expect(pressed(view, 'Nimbus')).toBe('false');
    expect(view.queryAllByText('0 of 37 confirmed')).toHaveLength(1);
  });

  it('shows the team dots and counts for 13 teams of 2: one all, one some, eleven none', () => {
    const fixture = upcomingFixture('upcoming-teams-13', {
      confirmations: confirmed('T1-a', 'T1-b', 'T2-a'),
    });
    const view = renderApp(fixture, { role: 'admin', tab: 'rankings' });

    expect(view.queryAllByText('1 of 13 teams confirmed · 3 of 26 players')).toHaveLength(1);
    expect(view.queryAllByRole('img', { name: 'all confirmed' })).toHaveLength(1);
    expect(view.queryAllByRole('img', { name: '1 of 2 confirmed' })).toHaveLength(1);
    expect(view.queryAllByRole('img', { name: 'none confirmed' })).toHaveLength(11);
    expect(view.queryAllByText('1/2')).toHaveLength(1);
    expect(view.queryByText('2/2')).toBeNull();
    expect(view.queryByText('0/2')).toBeNull();
    expect(pressed(view, 'T2-a')).toBe('true');
    expect(pressed(view, 'T2-b')).toBe('false');
  });

  it('shows a reserve team behind its dot with a toggle per member, and the individual reserves of a team format', () => {
    const fixture = upcomingFixture('upcoming-teams-13', {
      reserves: [{ teamId: 'r1', teamName: 'Bench', members: [{ name: 'B1' }, { name: 'B2' }] }],
      reserveIndividuals: [{ name: 'Solo' }, { name: 'Odd' }],
      confirmations: confirmed('B1', 'Solo'),
    });
    const view = renderApp(fixture, { role: 'admin', tab: 'rankings' });

    expect(pressed(view, 'B1')).toBe('true');
    expect(pressed(view, 'B2')).toBe('false');
    expect(pressed(view, 'Solo')).toBe('true');
    expect(pressed(view, 'Odd')).toBe('false');
    expect(view.queryAllByRole('img', { name: '1 of 2 confirmed' })).toHaveLength(1);
    expect(view.queryAllByText('0 of 13 teams confirmed · 0 of 26 players')).toHaveLength(1);
  });

  it('locks the toggle of a player who has a score, and counts them without a manual mark', () => {
    const started = fixtureTournaments().find((entry) => entry.id === 'ffa37-pooling');
    if (!started) throw new Error('the ffa37-pooling fixture is missing');
    const view = renderApp(started, { role: 'admin', tab: 'rankings' });

    const locked = view.queryAllByTitle('Confirmed — has a score');
    expect(locked.length).toBeGreaterThan(0);
    for (const toggle of locked) {
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(toggle).toHaveProperty('disabled', true);
    }
    expect(view.queryAllByText(`${locked.length} of 37 confirmed`)).toHaveLength(1);
  });

  it.each(['upcoming-info', 'upcoming-teams-13'])('shows a viewer nothing of it on %s', (id) => {
    const fixture = upcomingFixture(id, { confirmations: confirmed('Player 01', 'T1-a', 'Larch') });
    const view = renderApp(fixture, { role: 'viewer', tab: 'rankings' });

    expect(view.queryAllByRole('button', { name: /^Confirmed: / })).toHaveLength(0);
    expect(view.queryAllByRole('img', { name: /confirmed/ })).toHaveLength(0);
    expect(view.queryAllByText(/ confirmed/)).toHaveLength(0);
  });
});

describe('Bracket tab, a waterfall column of two rounds', () => {
  const column = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'waterfall-column-19');
    if (!fixture) throw new Error('the waterfall-column-19 fixture is missing');
    return fixture;
  };

  it('shows both rounds of the current column under their own title bars, with one NOW pill', () => {
    const view = renderApp(column(), { role: 'viewer', tab: 'bracket' });

    expect(view.queryAllByRole('heading', { name: 'Round 5 Upper' })).toHaveLength(1);
    expect(view.queryAllByRole('heading', { name: 'Round 5 Lower' })).toHaveLength(1);
    expect(view.queryAllByText('NOW')).toHaveLength(1);
  });

  it('shows an admin the same column with its score fields', () => {
    const view = renderApp(column(), { role: 'admin', tab: 'bracket' });

    expect(view.queryAllByRole('heading', { name: 'Round 5 Lower' })).toHaveLength(1);
    expect(view.queryAllByRole('button', { name: /Next Round/ }).length).toBeGreaterThan(0);
  });
});
