import { render } from '@testing-library/react';
import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import type { ActiveTab } from '../../domain/tournament/types';
import { getAnonymousAuthSnapshot, Role, type AuthSnapshot } from '../auth/auth.shared';
import { AuthProvider } from '../auth/AuthProvider';
import { TournamentContext, type TournamentAppContext } from '../tournament/TournamentProvider';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import {
  fixtureIndexEntry,
  loadedState,
  setupOf,
  type FixtureTournament,
} from '../../../e2e/screens/fixtures';
import { AppShell } from './AppShell';
import { tabContextFor, visibleTabs } from './tabs';

/** Test helpers: render the real `AppShell` for a fixture tournament, without Firebase, sync or server functions. */

export type AppRole = 'viewer' | 'admin';

const ADMIN_AUTH: AuthSnapshot = {
  roles: [Role.TOUR_HOST],
  status: 'authenticated',
  userId: 'test-host',
  username: 'Test Host',
};

function authOf(role: AppRole): AuthSnapshot {
  return role === 'admin' ? ADMIN_AUTH : getAnonymousAuthSnapshot();
}

function summaryOf(fixture: FixtureTournament): TournamentSummary {
  return { id: fixture.id, ...fixtureIndexEntry(fixture) };
}

/** The tabs the app lists for this fixture and role: the same inputs `AppShell` gives the tab rules. */
export function tabsFor(fixture: FixtureTournament, role: AppRole): Array<{ key: ActiveTab; label: string }> {
  const context = tabContextFor({
    state: loadedState(fixture),
    summary: summaryOf(fixture),
    canAdmin: role === 'admin',
    stateReceived: true,
    nowMs: Date.now(),
  });
  return visibleTabs(context);
}

/** The app context for a fixture: its loaded state and Setup, the tab to show, and callbacks that do nothing. */
export function testAppContext(
  fixture: FixtureTournament,
  role: AppRole,
  tab: ActiveTab,
): TournamentAppContext {
  const state = loadedState(fixture);
  const nothing = () => {};
  const resolvesNull = () => Promise.resolve(null);
  return {
    state,
    setup: createDefaultSetup(setupOf(fixture)),
    activeTab: tab,
    hydrated: true,
    unlocked: role === 'admin',
    isViewer: role === 'viewer',
    tournaments: { status: 'ready', summaries: [summaryOf(fixture)] },
    visitResolved: true,
    visitNotice: null,
    dismissVisitNotice: nothing,
    runtime: createTournamentRuntime(),
    syncStatus: { kind: 'active' },
    setActiveTab: nothing,
    updateState: nothing,
    updateSetup: nothing,
    unlockAdmin: nothing,
    lockAdmin: nothing,
    loadTournament: () => Promise.resolve(),
    unloadTournament: () => Promise.resolve(),
    openTournament: () => Promise.resolve(),
    exitTournament: () => Promise.resolve(),
    createTournamentRecord: resolvesNull,
    startTournamentNow: resolvesNull,
    backToDraft: resolvesNull,
    changeStatus: resolvesNull,
    readOnly: state.lifecycle?.status === 'finished',
  };
}

/** Renders the app shell on one tab of a fixture, as a signed-out viewer or as a Tour Host. */
export function renderApp(
  fixture: FixtureTournament,
  options: { role: AppRole; tab: ActiveTab; context?: Partial<TournamentAppContext> },
) {
  return render(
    <AuthProvider initialAuth={authOf(options.role)}>
      <TournamentContext.Provider
        value={{ ...testAppContext(fixture, options.role, options.tab), ...options.context }}
      >
        <AppShell />
      </TournamentContext.Provider>
    </AuthProvider>,
  );
}
