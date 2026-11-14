// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { TournamentState } from '../../domain/tournament/types';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';

import { scoreTied } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { scoreByHash } from '../../domain/tournament/__tests__/spread-play';
import { expectedRounds } from '../../domain/tournament/expected-draw';
import { nextColumnStart } from '../../domain/tournament/round-columns';

import { FALLBACK } from './app-shell-sweep';
import { TabErrorBoundary } from './TabErrorBoundary';
import { renderApp, type AppRole } from './test-app';

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

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
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

    const column = view.getByText('EXPECTED').closest('[data-round-column]') as HTMLElement;
    expect(within(column).queryAllByText(/^Room [A-Z]$/)).toHaveLength(planned.length);
  });

  it.each(ROLES)('shows %s placeholders and no tag while a room of the round in play is unscored', (role) => {
    const view = renderApp(lastQualification(false), { role, tab: 'bracket' });

    expect(view.queryAllByText('EXPECTED')).toHaveLength(0);
    expect(view.queryAllByText(CUTOFF_PLACEHOLDER).length).toBeGreaterThan(0);
  });

  it.each(ROLES)(
    'shows %s the draw of R6L and R6R once R5L alone is scored, while SemiB and the Final keep their place labels',
    (role) => {
      const fixture = fixtureTournaments().find((entry) => entry.id === 'upper-lower-37');
      if (!fixture) throw new Error('the upper-lower-37 fixture is missing');
      const view = renderApp(fixture, { role, tab: 'bracket' });
      const placeholder = /, Rank \d+$/;
      const columnOf = (title: string) => {
        const column = view
          .getAllByRole('heading', { name: title })
          .map((heading) => heading.closest<HTMLElement>('[data-round-column]'))
          .find((found) => found !== null);
        if (!column) throw new Error(`no column ${title}`);
        return column;
      };
      const labelOf = (title: string) =>
        fixture.state.rounds.findIndex((round) => round.customLabel === title);
      const draw = expectedRounds(fixture.state);

      expect(view.queryAllByText('EXPECTED')).toHaveLength(2);
      for (const title of ['R6L', 'R6R']) {
        const names = draw?.get(labelOf(title))?.assignments.map((entry) => entry.name) ?? [];
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) expect(within(columnOf(title)).queryAllByText(name)).not.toHaveLength(0);
        expect(within(columnOf(title)).queryAllByText(placeholder)).toHaveLength(0);
      }
      for (const title of ['SemiB', 'Final']) {
        expect(within(columnOf(title)).queryAllByText('EXPECTED')).toHaveLength(0);
        expect(within(columnOf(title)).queryAllByText(placeholder).length).toBeGreaterThan(0);
      }
    },
  );
});

describe('Bracket, dependency play', () => {
  const dependency = (id: string): FixtureTournament => {
    const fixture = fixtureTournaments().find((entry) => entry.id === id);
    if (!fixture) throw new Error(`the ${id} fixture is missing`);
    return fixture;
  };
  const columnOf = (view: ReturnType<typeof renderApp>, title: string) => {
    const column = view
      .getAllByRole('heading', { name: title })
      .map((heading) => heading.closest<HTMLElement>('[data-round-column], .flex-col'))
      .find((found) => found !== null);
    if (!column) throw new Error(`no column ${title}`);
    return column;
  };
  const barOf = (view: ReturnType<typeof renderApp>, title: string) =>
    view.getAllByRole('heading', { name: title })[0].parentElement as HTMLElement;

  it.each(ROLES)(
    'puts NOW on each round in play and DONE on a round sent on, in a column played together (%s)',
    (role) => {
      const view = renderApp(dependency('dependency-play-in-play'), { role, tab: 'bracket' });
      // SemiA, R6R and R6L are in play: one NOW each. R5R and R5L, the other rounds of SemiA's column, were sent on.
      expect(view.queryAllByText('NOW')).toHaveLength(3);
      expect(within(barOf(view, 'SemiA')).queryAllByText('NOW')).toHaveLength(1);
      expect(within(barOf(view, 'R5L')).queryAllByText('DONE')).toHaveLength(1);
      expect(within(barOf(view, 'R5L')).queryAllByText('NOW')).toHaveLength(0);
      expect(within(barOf(view, 'R5R')).queryAllByText('DONE')).toHaveLength(1);
    },
  );

  it('shows the organiser score fields only in the rounds in play', () => {
    const view = renderApp(dependency('dependency-play-in-play'), { role: 'admin', tab: 'bracket' });
    expect(columnOf(view, 'SemiA').querySelectorAll('input').length).toBeGreaterThan(0);
    expect(columnOf(view, 'R5L').querySelectorAll('input')).toHaveLength(0);
    const viewer = renderApp(dependency('dependency-play-in-play'), { role: 'viewer', tab: 'bracket' });
    expect(
      viewer.container.querySelectorAll('#br-content input[type="number"], #br-content input[inputmode]'),
    ).toHaveLength(0);
  });

  it('gives a viewer no Next Round button and no line, and an admin both', () => {
    const viewer = renderApp(dependency('dependency-play-in-play'), { role: 'viewer', tab: 'bracket' });
    expect(viewer.queryAllByRole('button', { name: /Next Round/ })).toHaveLength(0);
    expect(viewer.queryAllByText(/nothing to draw yet/)).toHaveLength(0);
    cleanup();
    const admin = renderApp(dependency('dependency-play-in-play'), { role: 'admin', tab: 'bracket' });
    expect(admin.getByRole('button', { name: /Next Round/ })).toHaveProperty('disabled', false);
    expect(admin.getByText('Sends on R6R; nothing to draw yet. SemiA and R6L stay in play.')).toBeTruthy();
  });

  it.each([
    ['dependency-play-draws', 'Draws R6R and R6L. SemiA stays in play.'],
    [
      'dependency-play-nothing-finished',
      'Nothing is finished: Next Round sends on SemiA, R6R and R6L as they stand.',
    ],
  ])('says what a press does under the button: %s', (id, line) => {
    const view = renderApp(dependency(id), { role: 'admin', tab: 'bracket' });
    expect(view.getByText(line)).toBeTruthy();
    expect(view.getByRole('button', { name: /Next Round/ })).toHaveProperty('disabled', false);
  });

  it('shows the reopened note instead of the drawn-ahead note, and keeps Next Round and Previous', () => {
    const view = renderApp(dependency('dependency-play-reopened'), { role: 'admin', tab: 'bracket' });
    expect(
      view.getByText(
        "R5R and R5L are open again. R6R and R6L are already drawn: a correction here won't change their draw.",
      ),
    ).toBeTruthy();
    expect(view.queryAllByText(/is already drawn/)).toHaveLength(0);
    expect(view.getByRole('button', { name: /Next Round/ })).toBeTruthy();
    expect(view.getByRole('button', { name: /Previous/ })).toBeTruthy();
  });

  it('keeps Next Round enabled while R6L has a tie and R6R is finished, and disables it with the same tie when nothing is finished', () => {
    const tied = (id: string): FixtureTournament => {
      const fixture = dependency(id);
      const r6l = fixture.state.rounds.findIndex((round) => round.customLabel === 'R6L');
      return { ...fixture, state: scoreTied(fixture.state, r6l) };
    };
    const finished = renderApp(tied('dependency-play-in-play'), { role: 'admin', tab: 'bracket' });
    expect(finished.getByRole('button', { name: /Next Round/ })).toHaveProperty('disabled', false);
    cleanup();
    const nothing = renderApp(tied('dependency-play-nothing-finished'), { role: 'admin', tab: 'bracket' });
    const button = nothing.getByRole('button', { name: /Next Round/ });
    expect(button).toHaveProperty('disabled', true);
    expect(button.getAttribute('title')).toBe('Resolve the tie-break above first');
  });

  it('asks about the rooms not fully scored, only when nothing is finished', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      const nothing = renderApp(dependency('dependency-play-nothing-finished'), {
        role: 'admin',
        tab: 'bracket',
      });
      fireEvent.click(nothing.getByRole('button', { name: /Next Round/ }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(String(confirm.mock.calls[0][0])).toMatch(
        /^Not all scores in: .*SemiA · Room A.*Go on anyway[?]$/,
      );
      cleanup();
      confirm.mockClear();
      const finished = renderApp(dependency('dependency-play-in-play'), { role: 'admin', tab: 'bracket' });
      fireEvent.click(finished.getByRole('button', { name: /Next Round/ }));
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
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
