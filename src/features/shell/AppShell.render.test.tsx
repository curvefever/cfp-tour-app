// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ActiveTab, TournamentState } from '../../domain/tournament/types';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { scoreByHash } from '../../domain/tournament/__tests__/spread-play';
import { nextColumnStart } from '../../domain/tournament/round-columns';
import { TabErrorBoundary } from './TabErrorBoundary';
import { renderApp, tabsFor, type AppRole } from './test-app';

// Only what reaches the network is replaced: the presence subscription and the presence server function.
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
    expect(view.queryAllByText(/Round 1 · Room/)).toHaveLength(0);
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

    expect(view.queryAllByText(/Round 1 · Room/).length).toBeGreaterThan(0);
  });
});

describe('Bracket, the expected draw', () => {
  const CUTOFF_PLACEHOLDER = 'Qualifier from standings (seed TBD)';

  /** The last qualification round of the pooling fixture, with every room scored or one score missing. */
  const lastQualification = (complete: boolean): FixtureTournament => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-pooling');
    if (!fixture) throw new Error('the ffa37-pooling fixture is missing');
    const scored = scoreByHash(fixture.state).state;
    const missing = `r${scored.curRound}-rm1-p0`;
    const { [missing]: _removed, ...scores } = scored.scores;
    return { ...fixture, state: complete ? scored : { ...scored, scores } };
  };

  it.each(ROLES)(
    'shows %s the next round with its units and an EXPECTED tag once the round in play is scored',
    (role) => {
      const view = renderApp(lastQualification(true), { role, tab: 'bracket' });

      expect(view.queryAllByText('EXPECTED')).toHaveLength(1);
      expect(view.queryAllByText(CUTOFF_PLACEHOLDER)).toHaveLength(0);
      // The rounds after it keep their placeholders, with no tag of their own.
      expect(view.queryAllByText(/ · \d+(st|nd|rd|th)$/).length).toBeGreaterThan(0);
    },
  );

  it('shows the rooms the next round will really have, not a stale plan with one room more', () => {
    const fixture = lastQualification(true);
    const next = nextColumnStart(fixture.state);
    const planned = fixture.state.rounds[next].rooms;
    const rounds = fixture.state.rounds.map((round, index) =>
      index === next ? { ...round, rooms: [...round.rooms, 1] } : round,
    );

    const view = renderApp(
      { ...fixture, state: { ...fixture.state, rounds } },
      { role: 'viewer', tab: 'bracket' },
    );

    const column = view.getByText('EXPECTED').closest('[class*="min-w-82.5"]') as HTMLElement;
    expect(within(column).queryAllByText(/^Room [A-Z]$/)).toHaveLength(planned.length);
  });

  it.each(ROLES)('shows %s placeholders and no tag while a room of the round in play is unscored', (role) => {
    const view = renderApp(lastQualification(false), { role, tab: 'bracket' });

    expect(view.queryAllByText('EXPECTED')).toHaveLength(0);
    expect(view.queryAllByText(CUTOFF_PLACEHOLDER).length).toBeGreaterThan(0);
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

describe('Bracket tab on a phone: the round strip', () => {
  const HIDDEN = 'max-[700px]:hidden';
  const quarters = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!fixture) throw new Error('the ffa37-quarters fixture is missing');
    return fixture;
  };

  /** The element of the rounds row that holds the column titled `title` (open: its heading). */
  const boxOf = (view: ReturnType<typeof renderApp>, title: string) => {
    let element: HTMLElement | null = view.getAllByRole('heading', { name: title })[0] ?? null;
    while (element && element.parentElement?.id !== 'br-rounds') element = element.parentElement;
    if (!element) throw new Error(`no box titled ${title}`);
    return element;
  };
  const tab = (view: ReturnType<typeof renderApp>, name: string) => view.getByRole('tab', { name });
  const selectedTabs = (view: ReturnType<typeof renderApp>) =>
    view.getAllByRole('tab').filter((candidate) => candidate.getAttribute('aria-selected') === 'true');

  it('has one tab per item, the box in play selected and shown, the others hidden on a phone', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'bracket' });

    expect(view.getAllByRole('tab').map((entry) => entry.textContent)).toEqual([
      'R1–3✓done',
      'Qualification',
      'Round 4now',
      'Round 5',
      'Semis',
      'Final',
    ]);
    expect(selectedTabs(view).map((entry) => entry.textContent)).toEqual(['Round 4now']);
    expect(boxOf(view, 'Round 4').className).not.toContain(HIDDEN);
    expect(boxOf(view, 'Round 5').className).toContain(HIDDEN);
    expect(boxOf(view, 'Final').className).toContain(HIDDEN);
    expect(
      view.getByRole('heading', { name: 'Qualification' }).closest('[data-standings-column]')?.className,
    ).toContain(HIDDEN);
  });

  it('shows the box of another tab, and the standings column from its own tab', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'bracket' });

    fireEvent.click(tab(view, 'Semis'));
    expect(selectedTabs(view).map((entry) => entry.textContent)).toEqual(['Semis']);
    expect(boxOf(view, 'Semis').className).not.toContain(HIDDEN);
    expect(boxOf(view, 'Round 4').className).toContain(HIDDEN);

    fireEvent.click(tab(view, 'Qualification'));
    expect(selectedTabs(view).map((entry) => entry.textContent)).toEqual(['Qualification']);
    const standings = view.getByRole('heading', { name: 'Qualification' }).closest('[data-standings-column]');
    expect(standings?.className).not.toContain(HIDDEN);
    expect(boxOf(view, 'Semis').className).toContain(HIDDEN);
  });

  it('opens the group as a list of its boxes; picking one shows it open and keeps the group selected', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'bracket' });

    fireEvent.click(tab(view, 'R1–3 done'));
    expect(view.getAllByRole('menuitem').map((entry) => entry.textContent)).toEqual([
      'Round 1✓done',
      'Round 2✓done',
      'Round 3✓done',
    ]);

    fireEvent.click(view.getByRole('menuitem', { name: 'Round 2 done' }));
    expect(view.queryByRole('menu')).toBeNull();
    expect(selectedTabs(view).map((entry) => entry.textContent)).toEqual(['R1–3✓done']);
    // Round 2 is folded on a desktop: its open body is there for the phone, its folded box is hidden on a phone.
    expect(boxOf(view, 'Round 2').className).not.toContain(HIDDEN);
    expect(view.getByRole('button', { name: 'Show Round 2' }).className).toContain(HIDDEN);
    expect(boxOf(view, 'Round 4').className).toContain(HIDDEN);
  });

  it('closes the group list with Escape', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'bracket' });

    fireEvent.click(tab(view, 'R1–3 done'));
    expect(view.queryByRole('menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(view.queryByRole('menu')).toBeNull();
  });
});

describe('Standings tab on a phone: the compact list', () => {
  const quarters = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!fixture) throw new Error('the ffa37-quarters fixture is missing');
    return fixture;
  };
  const rowOf = (view: ReturnType<typeof renderApp>, name: string) =>
    view
      .getAllByRole('button', { expanded: false })
      .find((button) => button.textContent?.includes(name) && button.className.includes('min-h-11'));

  it('shows the table for a desktop and the list for a phone, one hidden by CSS each', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });

    expect(view.getByRole('table').parentElement?.className).toContain('max-[700px]:hidden');
    const row = rowOf(view, 'Player 08');
    expect(row?.closest('div[class*="min-[701px]:hidden"]')).not.toBeNull();
    expect(row?.textContent).toContain('8 · 8 · 6');
  });

  it('unfolds a row on tap to its round lines and tie-break, and folds it on a second tap', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });
    const row = rowOf(view, 'Player 08');
    if (!row) throw new Error('no Player 08 row');

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const detail = view.getByText('Round 3 · 66 · 3rd · 6 pts');
    expect(detail.parentElement?.id).toBe(row.getAttribute('aria-controls'));
    expect(view.getByText('Tie-break 142%')).toBeDefined();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('Round 3 · 66 · 3rd · 6 pts')).toBeNull();
  });

  it('lets several rows stay open, and gives both of two units on one whole percent the precise value', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });

    fireEvent.click(rowOf(view, 'Player 09') as HTMLElement);
    fireEvent.click(rowOf(view, 'Player 11') as HTMLElement);

    expect(view.getByText('Tie-break 113% (113.05%)')).toBeDefined();
    expect(view.getByText('Tie-break 113% (112.62%)')).toBeDefined();
  });

  it('names the rounds in a row as the table header does, for Swiss too', () => {
    const swiss = fixtureTournaments().find((entry) => entry.id === 'teams-4v4-13');
    if (!swiss) throw new Error('the teams-4v4-13 fixture is missing');
    const view = renderApp(swiss, { role: 'viewer', tab: 'standings' });
    const headers = within(view.getByRole('table'))
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
      .filter((text) => text?.startsWith('Round'));

    const listHead = view.getAllByText('Pos').find((element) => element.tagName === 'SPAN');
    const firstRow = listHead?.parentElement?.parentElement?.querySelector('button');
    if (!firstRow) throw new Error('no row');
    fireEvent.click(firstRow);
    const lines = firstRow.parentElement?.querySelectorAll('[id] > div') ?? [];
    expect([...lines].slice(0, headers.length).map((line) => line.textContent?.split(' · ')[0])).toEqual(
      headers,
    );
  });

  it('folds the explanation into one line that unfolds, open on a desktop', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });
    const toggle = view.getByRole('button', { name: 'How qualification works' });
    const text = view.getByText(/After 3 of 3 rounds|These are the final standings|After \d of \d rounds/);

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(text.parentElement?.className).toContain('max-[700px]:hidden');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(text.parentElement?.className).not.toContain('max-[700px]:hidden');
  });
});

describe('Rankings tab on a phone', () => {
  const finished = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-finished');
    if (!fixture) throw new Error('the ffa37-finished fixture is missing');
    return fixture;
  };

  it('keeps the podium in 2nd · 1st · 3rd order for a desktop, but puts 1st first and full width on a phone', () => {
    const view = renderApp(finished(), { role: 'viewer', tab: 'rankings' });
    const cards = [...view.getByRole('region', { name: 'Podium' }).children] as HTMLElement[];

    expect(cards.map((card) => card.textContent?.slice(0, 3))).toEqual(['2nd', '1st', '3rd']);
    const [second, first, third] = cards;
    expect(first.className).toContain('max-[700px]:order-first');
    expect(first.className).toContain('max-[700px]:basis-full');
    for (const card of [second, third]) {
      expect(card.className).not.toContain('max-[700px]:order-first');
      expect(card.className).toContain('max-[700px]:basis-[calc(50%-9px)]');
    }
  });

  it('has one Download image button, named the same whatever its look', () => {
    const view = renderApp(finished(), { role: 'viewer', tab: 'rankings' });

    expect(view.getAllByRole('button', { name: 'Download image' })).toHaveLength(1);
  });
});

describe('Setup on a phone: Confirm & Start', () => {
  const drawn = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'drawn-ffa-31');
    if (!fixture) throw new Error('the drawn-ffa-31 fixture is missing');
    return fixture;
  };

  it('has an inline copy under the preview (hidden on a phone) and a pinned copy at the end (hidden on a desktop)', () => {
    const view = renderApp(drawn(), { role: 'admin', tab: 'admin' });
    const buttons = view.getAllByRole('button', { name: 'Confirm & Start' });
    const bars = buttons.map((button) => button.closest('[data-confirm-start]') as HTMLElement);

    expect(buttons).toHaveLength(2);
    const inline = bars.find((bar) => bar.dataset.confirmStart === 'inline');
    const pinned = bars.find((bar) => bar.dataset.confirmStart === 'pinned');
    expect(inline?.className).toContain('max-[700px]:hidden');
    expect(pinned?.className).toContain('min-[701px]:hidden');
    expect(pinned?.className).toContain('sticky');
    expect(pinned?.className).toContain('bottom-0');
    // The pinned bar is a child of the page itself, so it can stay at the screen's bottom along the whole page.
    expect(pinned?.parentElement?.id).toBe('panel-setup');
  });

  it('shows neither once the tournament has started', () => {
    const started = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!started) throw new Error('the ffa37-quarters fixture is missing');
    const view = renderApp(started, { role: 'admin', tab: 'admin' });

    expect(view.queryAllByRole('button', { name: 'Confirm & Start' })).toHaveLength(0);
  });
});

describe('Admin tab on a phone', () => {
  const quarters = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!fixture) throw new Error('the ffa37-quarters fixture is missing');
    return fixture;
  };

  it('has a Copy viewer link at the heading for a desktop and a full-width one under the status for a phone', () => {
    const view = renderApp(quarters(), { role: 'admin', tab: 'admin' });
    const links = view.getAllByRole('button', { name: 'Copy viewer link' });
    const status = view.getByRole('region', { name: 'Tournament status' });

    expect(links).toHaveLength(2);
    const [desktop, phone] = [
      links.find((link) => link.className.includes('max-[700px]:hidden')),
      links.find((link) => link.className.includes('min-[701px]:hidden')),
    ];
    expect(desktop).toBeDefined();
    expect(phone?.className).toContain('max-[700px]:w-full');
    // The phone copy follows the status panel directly.
    expect(status.nextElementSibling).toBe(phone);
  });

  it('makes the status panel buttons full width on a phone', () => {
    const view = renderApp(quarters(), { role: 'admin', tab: 'admin' });
    const status = view.getByRole('region', { name: 'Tournament status' });

    expect(within(status).getByRole('button', { name: 'Finish tournament' }).className).toContain(
      'max-[700px]:w-full',
    );
  });

  it('lists each room once with its status word and scores in, the same cells for a table and a card', () => {
    const view = renderApp(quarters(), { role: 'admin', tab: 'admin' });
    const rooms = view.getByRole('region', { name: 'Tournament progress' });

    for (const [room, status, scores] of [
      ['Room A', 'Scored', '8/8'],
      ['Room B', 'Scored', '8/8'],
      ['Room C', 'Not started', '0/8'],
    ]) {
      const row = within(rooms).getByText(room, { exact: true }).parentElement;
      expect(row?.textContent).toContain(status);
      expect(row?.textContent).toContain(scores);
    }
    expect(within(rooms).getAllByText('Room A', { exact: true })).toHaveLength(1);
  });
});
