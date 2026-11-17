// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureIndexEntry, storedState, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { afterRound1 } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import { scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import type { ActiveTab, TournamentState } from '../../domain/tournament/types';
import { getAnonymousAuthSnapshot, Role } from '../auth/auth.shared';
import { AuthProvider } from '../auth/AuthProvider';
import type { SyncTransport } from '../sync/live-sync';
import {
  TournamentContext,
  TournamentProvider,
  useTournamentApp,
  type TournamentAppContext,
} from '../tournament/TournamentProvider';
import { AppShell } from './AppShell';
import { renderApp, settle, testAppContext } from '../../test-support/test-app';

const hoisted = vi.hoisted(() => ({ summaries: [] as unknown[] }));

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
  subscribeTournamentIndex: (onChange: (summaries: unknown[]) => void) => {
    onChange(hoisted.summaries);
    return () => {};
  },
  getFirebaseSetupTransport: () => null,
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

const ID = 'spectator-view';
const BAND = 'Spectator view: what viewers see.';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.__CURVE_TOUR_SYNC_TRANSPORT__;
  window.history.replaceState(null, '', '/');
});

const fixtureOf = (state: TournamentState): FixtureTournament => ({
  id: ID,
  state: { ...state, tournamentId: ID },
  status: 'published',
  tabs: ['Bracket'],
});

// 37 players, round 1 played with one player absent; round 2 is in play: that player's row says ABS?, and the admin has a
// likely-absent line. One more seat of round 2 holds a 0 nobody has answered yet (the admin's question bar).
const pending = (() => {
  const state = afterRound1([[1, 0]], 3, 37);
  const key = `r${state.curRound}-rm2-p0`;
  return fixtureOf({ ...state, scores: { ...state.scores, [key]: 0 } });
})();

// The same tournament with round 2 fully scored: Next Round would draw round 3, so the admin sees an EXPECTED round.
const scored = (() => {
  const base = afterRound1([[1, 0]], 3, 37);
  return fixtureOf(scoreCurrentRound(base, 0));
})();

const TABS: ActiveTab[] = ['bracket', 'rankings', 'standings', 'info', 'tournaments'];

/** What the page shows apart from the band: the tab bar and the page itself. */
function pageText(view: ReturnType<typeof renderApp>): { nav: string; main: string } {
  return {
    nav: view.container.querySelector('nav')?.textContent ?? '',
    main: view.container.querySelector('main')?.textContent ?? '',
  };
}

describe('the spectator view shows every tab as a viewer sees it', () => {
  it.each(
    TABS.flatMap((tab) => [
      [tab, 'a pending 0', pending] as const,
      [tab, 'an expected draw', scored] as const,
    ]),
  )('the %s tab, with %s', (tab, _label, fixture) => {
    const viewer = renderApp(fixture, { role: 'viewer', tab });
    const asViewer = pageText(viewer);
    cleanup();
    const spectator = renderApp(fixture, { role: 'admin', tab, spectating: true });

    expect(spectator.queryByText(BAND)).not.toBeNull();
    expect(pageText(spectator)).toEqual(asViewer);
  });

  it('differs from the admin view, so the equality above says something', () => {
    const tab = 'bracket';
    const viewer = pageText(renderApp(pending, { role: 'viewer', tab }));
    cleanup();
    const admin = renderApp(pending, { role: 'admin', tab });
    expect(pageText(admin).main).not.toEqual(viewer.main);
    expect(admin.container.querySelectorAll('input').length).toBeGreaterThan(0);
    expect(admin.queryByText(/Likely absent/)).not.toBeNull();
    cleanup();
    const expected = renderApp(scored, { role: 'admin', tab });
    expect(expected.queryAllByText('EXPECTED').length).toBeGreaterThan(0);
  });

  it('hides Copy players on Rankings, and keeps ABS? on the absent player’s row', () => {
    const admin = renderApp(scored, { role: 'admin', tab: 'rankings' });
    expect(admin.queryByRole('button', { name: /Copy players/ })).not.toBeNull();
    cleanup();
    const spectator = renderApp(scored, { role: 'admin', tab: 'rankings', spectating: true });
    expect(spectator.queryByRole('button', { name: /Copy players/ })).toBeNull();
    cleanup();
    const bracket = renderApp(pending, { role: 'admin', tab: 'bracket', spectating: true });
    expect(bracket.queryAllByText('ABS?')).toHaveLength(1);
    expect(
      bracket.container.querySelectorAll('#br-content input[type="number"], #br-content input[inputmode]'),
    ).toHaveLength(0);
  });
});

/** A shell whose context follows the switch the way the provider's does. */
function Switchable({ fixture, tab }: { fixture: FixtureTournament; tab: ActiveTab }): ReactNode {
  const [spectating, setSpectating] = useState(false);
  const value: TournamentAppContext = { ...testAppContext(fixture, 'admin', tab, spectating), setSpectating };
  return (
    <AuthProvider
      initialAuth={{ roles: [Role.TOUR_HOST], status: 'authenticated', userId: 'h', username: 'Host' }}
    >
      <TournamentContext.Provider value={value}>
        <AppShell />
      </TournamentContext.Provider>
    </AuthProvider>
  );
}

describe('the switch', () => {
  it('goes through the account menu, hides the Admin tab and the score boxes, and comes back with them', () => {
    const view = render(<Switchable fixture={pending} tab='bracket' />);
    const adminTab = () => view.queryByRole('button', { name: 'Admin' });
    const boxes = () =>
      view.container.querySelectorAll('#br-content input[type="number"], #br-content input[inputmode]')
        .length;
    expect(adminTab()).not.toBeNull();
    expect(boxes()).toBeGreaterThan(0);
    expect(view.queryByText(BAND)).toBeNull();

    fireEvent.click(view.getByRole('button', { name: /Signed in/ }));
    fireEvent.click(view.getByRole('menuitem', { name: 'View as spectator' }));

    expect(view.queryByText(BAND)).not.toBeNull();
    expect(adminTab()).toBeNull();
    expect(boxes()).toBe(0);
    // The account stays, now without the switch it already used.
    fireEvent.click(view.getByRole('button', { name: /Signed in/ }));
    expect(view.queryByRole('menuitem', { name: 'View as spectator' })).toBeNull();
    expect(view.queryByRole('menuitem', { name: /Sign out/ })).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: /Signed in/ }));

    fireEvent.click(view.getByRole('button', { name: 'Back to admin view' }));

    expect(view.queryByText(BAND)).toBeNull();
    expect(adminTab()).not.toBeNull();
    expect(boxes()).toBeGreaterThan(0);
  });

  it('is not offered to a viewer', () => {
    const view = renderApp(pending, { role: 'viewer', tab: 'bracket' });
    expect(view.queryByRole('button', { name: /Signed in/ })).toBeNull();
    expect(view.queryByText(BAND)).toBeNull();
  });
});

describe('the provider', () => {
  let transport: SyncTransport & {
    subscribe: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let app: TournamentAppContext;

  beforeEach(() => {
    hoisted.summaries = [{ id: ID, ...fixtureIndexEntry(pending) }];
    transport = {
      subscribe: vi.fn((_id: string, onValue: (payload: unknown) => void) => {
        onValue(storedState(pending));
        return () => {};
      }),
      update: vi.fn(() => Promise.resolve()),
    };
    window.__CURVE_TOUR_SYNC_TRANSPORT__ = transport;
  });

  function Probe() {
    app = useTournamentApp();
    return null;
  }

  async function renderProvider(admin: boolean) {
    render(
      <AuthProvider
        initialAuth={
          admin
            ? { roles: [Role.TOUR_HOST], status: 'authenticated', userId: 'h', username: 'Host' }
            : getAnonymousAuthSnapshot()
        }
      >
        <TournamentProvider>
          <Probe />
        </TournamentProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(app.visitResolved).toBe(true));
    await act(async () => {
      await app.loadTournament(ID);
    });
    await waitFor(() => expect(app.syncStatus.kind).toBe('active'));
  }

  it('keeps the sync a writer while spectating: no new subscription, and a score typed afterwards is saved', async () => {
    await renderProvider(true);
    expect(app.unlocked).toBe(true);
    expect(app.isViewer).toBe(false);
    expect(transport.subscribe).toHaveBeenCalledTimes(1);

    act(() => app.setSpectating(true));
    expect(app.spectating).toBe(true);
    expect(app.unlocked).toBe(false);
    expect(app.isViewer).toBe(true);

    const key = `r${app.state.curRound}-rm3-p0`;
    act(() => app.updateState((current) => ({ ...current, scores: { ...current.scores, [key]: 77 } })));
    await waitFor(() => expect(transport.update).toHaveBeenCalled());
    expect(JSON.stringify(transport.update.mock.calls)).toContain(key);
    expect(transport.subscribe).toHaveBeenCalledTimes(1);

    act(() => app.setSpectating(false));
    expect(app.unlocked).toBe(true);
    expect(app.isViewer).toBe(false);
    await settle();
    expect(transport.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a viewer', async () => {
    await renderProvider(false);
    act(() => app.setSpectating(true));
    expect(app.spectating).toBe(false);
    expect(app.isViewer).toBe(true);
    expect(app.unlocked).toBe(false);
  });
});
