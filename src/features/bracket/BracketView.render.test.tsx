// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { testAppContext } from '../../test-support/test-app';
import { getAnonymousAuthSnapshot } from '../auth/auth.shared';
import { AuthProvider } from '../auth/AuthProvider';
import { TournamentContext } from '../tournament/TournamentProvider';
import { BracketView } from './BracketView';

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));

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

afterEach(cleanup);

const fixtureOf = (state: TournamentState) => ({
  id: 'bracket-view-hooks',
  state: { ...state, tournamentId: 'bracket-view-hooks' },
  status: 'published' as const,
  tabs: ['Bracket'],
});

/** The Bracket page of a tournament the viewer already has open, as the app builds it for this state. */
function bracketOf(state: TournamentState) {
  return (
    <AuthProvider initialAuth={getAnonymousAuthSnapshot()}>
      <TournamentContext.Provider value={testAppContext(fixtureOf(state), 'viewer', 'bracket')}>
        <BracketView />
      </TournamentContext.Provider>
    </AuthProvider>
  );
}

describe('the Bracket page while the rounds are not there yet', () => {
  it('shows the rounds once they arrive in a page that was already open (every hook runs on every render)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(bracketOf(createDefaultTournamentState()));
    expect(view.getByText('No tournament has started yet.')).toBeTruthy();

    view.rerender(bracketOf(built(31)));

    expect(view.queryByText('No tournament has started yet.')).toBeNull();
    expect(view.getByRole('heading', { name: 'Round 1' })).toBeTruthy();
    expect(errors).not.toHaveBeenCalled();
  });
});
