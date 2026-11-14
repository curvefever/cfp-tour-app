// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import { withEarlierPointsRule } from '../../domain/tournament/__tests__/play-through';

import { noteGameCount, roundNoteNames } from '../../domain/tournament/round-notes';
import { FALLBACK } from './app-shell-sweep';

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
    return { ...fixture, state: withEarlierPointsRule(fixture.state) };
  };
  const rowOf = (view: ReturnType<typeof renderApp>, name: string) =>
    view
      .getAllByRole('button', { expanded: false })
      .find((button) => button.textContent?.includes(name) && button.className.includes('min-h-11'));

  it('shows the table for a desktop and the list for a phone, one hidden by CSS each', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });

    expect(view.getByRole('table').parentElement?.className).toContain('max-[700px]:hidden');
    const row = rowOf(view, 'Player 26');
    expect(row?.closest('div[class*="min-[701px]:hidden"]')).not.toBeNull();
    expect(row?.textContent).toContain('8 · 8 · 6');
  });

  it('unfolds a row on tap to its round lines and tie-break, and folds it on a second tap', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });
    const row = rowOf(view, 'Player 26');
    if (!row) throw new Error('no Player 26 row');

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const detail = view.getByText('Round 3 · 66 · 3rd · 6 pts');
    expect(detail.parentElement?.id).toBe(row.getAttribute('aria-controls'));
    expect(view.getByText('Tie-break 144%')).toBeDefined();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByText('Round 3 · 66 · 3rd · 6 pts')).toBeNull();
  });

  it('lets several rows stay open, and gives both of two units on one whole percent the precise value', () => {
    const view = renderApp(quarters(), { role: 'viewer', tab: 'standings' });

    fireEvent.click(rowOf(view, 'Player 16') as HTMLElement);
    fireEvent.click(rowOf(view, 'Player 08') as HTMLElement);

    expect(view.getByText('Tie-break 110% (109.99%)')).toBeDefined();
    expect(view.getByText('Tie-break 110% (109.86%)')).toBeDefined();
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

describe('Bracket tab, the round settings notes', () => {
  const withNotes = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'waterfall-column-19');
    if (!fixture) throw new Error('the waterfall-column-19 fixture is missing');
    return fixture;
  };
  const toggleOf = (view: ReturnType<typeof renderApp>, pressed: boolean) =>
    view.getByRole('button', { name: 'Round settings', pressed });
  const titleBarButtons = (view: ReturnType<typeof renderApp>) =>
    view.queryAllByRole('button', { name: 'Round settings', expanded: false });

  afterEach(() => window.localStorage.clear());

  it.each(ROLES)('shows %s a band on each round with a note, and the toggle pressed', (role) => {
    const view = renderApp(withNotes(), { role, tab: 'bracket' });

    expect(toggleOf(view, true).getAttribute('title')).toBe('Hide round settings');
    const bands = view.queryAllByRole('note', { name: 'Round settings' });
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(view.getAllByText('Target score:', { exact: false }).length).toBeGreaterThanOrEqual(3);
    expect(view.queryAllByText('No specific settings').length).toBeGreaterThan(0);
    expect(titleBarButtons(view)).toHaveLength(0);
  });

  it('hides the bands when the toggle is pressed, remembers it, and opens a note from its title bar button', () => {
    const view = renderApp(withNotes(), { role: 'viewer', tab: 'bracket' });
    fireEvent.click(toggleOf(view, true));

    expect(toggleOf(view, false).getAttribute('title')).toBe('Show round settings');
    expect(view.queryAllByRole('note')).toHaveLength(0);
    expect(view.queryAllByText('No specific settings')).toHaveLength(0);
    expect(window.localStorage.getItem('curveFFA_round_settings_hidden')).toBe('hidden');
    const buttons = titleBarButtons(view);
    expect(buttons.length).toBeGreaterThanOrEqual(3);

    fireEvent.mouseEnter(buttons[0]);
    expect(within(view.getByRole('tooltip')).getByText(/Target score/)).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryAllByRole('tooltip')).toHaveLength(0);

    fireEvent.click(toggleOf(view, false));
    expect(view.queryAllByRole('note', { name: 'Round settings' }).length).toBeGreaterThanOrEqual(3);
    expect(window.localStorage.getItem('curveFFA_round_settings_hidden')).toBeNull();
  });

  it('starts hidden for a browser that chose so', () => {
    window.localStorage.setItem('curveFFA_round_settings_hidden', 'hidden');
    const view = renderApp(withNotes(), { role: 'viewer', tab: 'bracket' });

    expect(toggleOf(view, false)).toBeTruthy();
    expect(view.queryAllByRole('note')).toHaveLength(0);
    expect(titleBarButtons(view).length).toBeGreaterThanOrEqual(3);
  });

  it('has no toggle, no band and no title bar button on a tournament without notes', () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa37-quarters');
    if (!fixture) throw new Error('the ffa37-quarters fixture is missing');
    const view = renderApp(fixture, { role: 'viewer', tab: 'bracket' });

    expect(view.queryAllByRole('button', { name: 'Round settings' })).toHaveLength(0);
    expect(view.queryAllByRole('note')).toHaveLength(0);
    expect(view.queryAllByText('No specific settings')).toHaveLength(0);
  });
});

describe('Bracket tab, the game lines of the round settings', () => {
  it("lists the games with a note in the Final's band, and leaves every other round quiet", () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'ffa43-quarters');
    if (!fixture) throw new Error('the ffa43-quarters fixture is missing');
    const view = renderApp(fixture, { role: 'viewer', tab: 'bracket' });
    const bands = view.queryAllByRole('note');

    expect(bands).toHaveLength(1);
    expect(bands[0].textContent).toContain('G1Powers: Ghost');
    expect(bands[0].textContent).toContain('G3Target score: 120Map size: small');
    expect(bands[0].textContent).not.toContain('G2');
    expect(view.queryAllByText('No specific settings').length).toBeGreaterThan(0);
  });
});

describe('Round settings editor', () => {
  const fixtureOf = (id: string) => {
    const fixture = fixtureTournaments().find((entry) => entry.id === id);
    if (!fixture) throw new Error(`the ${id} fixture is missing`);
    return fixture;
  };
  const boxesOf = (view: ReturnType<typeof renderApp>) =>
    [...view.container.querySelectorAll<HTMLTextAreaElement>('textarea[id^="info-round-note-"]')].filter(
      (box) => /^info-round-note-\d+$/.test(box.id),
    );
  const gameBoxesOf = (view: ReturnType<typeof renderApp>) => [
    ...view.container.querySelectorAll<HTMLTextAreaElement>('textarea[id^="info-round-note-"][id*="-g"]'),
  ];

  it.each(['drawn-ffa-31', 'waterfall-column-19'])(
    'gives an admin one one-line box per round of %s, named after the round, in schedule order',
    (id) => {
      const fixture = fixtureOf(id);
      const view = renderApp(fixture, { role: 'admin', tab: 'admin' });
      const boxes = boxesOf(view);

      expect(boxes.map((box) => box.id)).toEqual(boxes.map((_box, index) => `info-round-note-${index}`));
      expect(boxes.map((box) => view.container.querySelector(`label[for="${box.id}"]`)?.textContent)).toEqual(
        roundNoteNames(loadedState(fixture)),
      );
      expect(boxes.length).toBeGreaterThan(3);
      expect(boxes.every((box) => box.rows === 1 && box.maxLength === 160)).toBe(true);
      expect(boxes.every((box) => box.placeholder === 'No specific settings')).toBe(true);
      expect(view.queryAllByText(/Generate the schedule to add/)).toHaveLength(0);
    },
  );

  it('shows the stored note of each round in its own box', () => {
    const view = renderApp(fixtureOf('waterfall-column-19'), { role: 'admin', tab: 'admin' });

    expect((view.getByLabelText('Round 1') as HTMLTextAreaElement).value).toBe('Powers: **Ghost**');
    expect((view.getByLabelText('Round 5 Upper') as HTMLTextAreaElement).value).toBe(
      'Target score: **80**\nMap size: large\nPowers: Ghost and Zap',
    );
    expect((view.getByLabelText('Round 6') as HTMLTextAreaElement).value).toBe('');
  });

  it('gives a round of several games a labelled box and a picture tile per game, under its own box', () => {
    const fixture = fixtureOf('drawn-ffa-31');
    const state = loadedState(fixture);
    const view = renderApp(fixture, { role: 'admin', tab: 'admin' });
    const gameBoxes = gameBoxesOf(view);
    const names = roundNoteNames(state);
    const expected = names.flatMap((name, index) =>
      Array.from({ length: noteGameCount(state, index) }, (_game, game) => `${index}-g${game + 1}`),
    );

    expect(expected.length).toBeGreaterThan(0);
    expect(gameBoxes.map((box) => box.id)).toEqual(expected.map((suffix) => `info-round-note-${suffix}`));
    expect(gameBoxes.every((box) => box.rows === 1 && box.maxLength === 160)).toBe(true);
    expect(view.getAllByText('Game 1').length).toBeGreaterThan(0);
    expect(view.getAllByLabelText(/^Add a picture to /)).toHaveLength(names.length + expected.length);
    expect(view.getByText('0 of 24 settings pictures used')).toBeTruthy();
  });

  it('asks the organiser to generate the schedule first when there are no rounds', () => {
    const view = renderApp(fixtureOf('upcoming-info'), { role: 'admin', tab: 'admin' });

    expect(boxesOf(view)).toHaveLength(0);
    expect(view.queryAllByText("Generate the schedule to add each round's settings.")).toHaveLength(1);
  });
});

describe('Bracket tab, the round settings of a double elimination wave box', () => {
  const waveFixture = () => {
    const fixture = fixtureTournaments().find((entry) => entry.id === 'double-elim-1v1-16');
    if (!fixture) throw new Error('the double-elim-1v1-16 fixture is missing');
    return fixture;
  };

  afterEach(() => window.localStorage.clear());

  it('titles the winners round and each losers round with a title bar of its own', () => {
    const view = renderApp(waveFixture(), { role: 'viewer', tab: 'bracket' });

    for (const title of ['R3 · Winners', 'R3 · Losers', 'R4 · Winners', 'R4.1 · Losers', 'R4.2 · Losers']) {
      expect(view.getAllByRole('heading', { name: title }).length).toBeGreaterThan(0);
    }
    expect(view.queryByText('Losers bracket', { selector: 'div' })).toBeNull();
  });

  it('gives the winners round the box band and each losers round its own band, quiet without a note', () => {
    const view = renderApp(waveFixture(), { role: 'viewer', tab: 'bracket' });

    const bands = view.queryAllByRole('note', { name: 'Round settings' }).map((band) => band.textContent);
    expect(bands).toContain('Target score: 60');
    expect(bands).toContain('Powers: Zap only');
    expect(bands).toContain('Powers: GhostMap: large');
    expect(view.queryAllByText('No specific settings').length).toBeGreaterThan(0);
  });

  it('puts a losers round note on a button in its title bar while the settings are hidden', () => {
    window.localStorage.setItem('curveFFA_round_settings_hidden', 'hidden');
    const view = renderApp(waveFixture(), { role: 'viewer', tab: 'bracket' });

    expect(view.queryAllByRole('note')).toHaveLength(0);
    const bar = view.getByRole('heading', { name: 'R3 · Losers' }).parentElement as HTMLElement;
    const losers = within(bar).getByRole('button', { name: 'Round settings', expanded: false });
    fireEvent.mouseEnter(losers);
    expect(within(view.getByRole('tooltip')).getByText('Zap')).toBeTruthy();
  });
});

describe('Bracket tab, the preview before the start', () => {
  const published = () => {
    const fixture = fixtureTournaments().find((candidate) => candidate.id === 'published-upper-lower-37');
    if (!fixture) throw new Error('the published fixture is missing');
    return fixture;
  };
  const NOTE = 'Bracket preview: players are placed in rooms when the tournament starts.';
  const bracketSection = (view: ReturnType<typeof renderApp>) =>
    view.container.querySelector('#br-content') as HTMLElement;

  it('shows a viewer the shape of a published tournament: the note, no name, and Round 1 as empty seats', () => {
    const fixture = published();
    const view = renderApp(fixture, { role: 'viewer', tab: 'bracket' });
    const section = bracketSection(view);

    expect(view.queryByText(FALLBACK)).toBeNull();
    expect(within(section).getByText(NOTE)).toBeTruthy();
    expect(section.textContent).not.toMatch(/Player \d\d/);
    expect(within(section).queryByText('Nobody reached this round.')).toBeNull();
    expect(view.queryByPlaceholderText('Follow a player or team…')).toBeNull();

    const roundOne = view.getAllByRole('heading', { name: 'Round 1' })[0].closest('[data-round-column]');
    const seats = within(roundOne as HTMLElement).getAllByText('—');
    expect(seats).toHaveLength(fixture.state.rounds[0].rooms.reduce((total, size) => total + size, 0));
    const roomSizes = fixture.state.rounds[0].rooms;
    expect(roomSizes.length).toBeGreaterThan(1);
  });

  it('keeps the slot labels of the later rounds', () => {
    const view = renderApp(published(), { role: 'viewer', tab: 'bracket' });
    expect(within(bracketSection(view)).getAllByText(/^Round 1 · \d/).length).toBeGreaterThan(0);
  });

  it('shows an admin the same tournament with its names and no preview note', () => {
    const view = renderApp(published(), { role: 'admin', tab: 'bracket' });
    const section = bracketSection(view);

    expect(within(section).queryByText(NOTE)).toBeNull();
    expect(section.textContent).toMatch(/Player \d\d/);
  });

  it('shows a viewer a group stage as empty seats, not its drawn pairings', () => {
    const fixture = fixtureTournaments().find((candidate) => candidate.id === 'published-groups-1v1-13');
    if (!fixture) throw new Error('the published group stage fixture is missing');
    const view = renderApp(fixture, { role: 'viewer', tab: 'bracket' });
    const section = bracketSection(view);

    expect(view.queryByText(FALLBACK)).toBeNull();
    expect(section.textContent).not.toMatch(/Player \d\d/);
    const roundOne = view.getAllByRole('heading', { name: 'Round 1' })[0].closest('[data-round-column]');
    const seats = within(roundOne as HTMLElement).getAllByText('—');
    const [first] = fixture.state.rounds;
    expect(first.matches?.length).toBeGreaterThan(1);
    expect(seats).toHaveLength(first.rooms.reduce((total, size) => total + size, 0));
    cleanup();
    expect(renderApp(fixture, { role: 'admin', tab: 'bracket' }).container.textContent).toMatch(
      /Player \d\d/,
    );
  });

  it('shows a viewer no Standings tab before the start', () => {
    const view = renderApp(published(), { role: 'viewer', tab: 'bracket' });
    expect(view.queryByRole('button', { name: 'Qualification' })).toBeNull();
  });
});
