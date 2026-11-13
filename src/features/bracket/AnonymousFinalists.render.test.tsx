// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  atEntry,
  playDependency,
  STRATEGIES,
} from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { UPPER_LOWER_GRAPH } from '../../domain/tournament/__tests__/upper-lower-graph';
import { flagFinalGameAnonymous } from '../../domain/tournament/mutations';
import type { TournamentState } from '../../domain/tournament/types';
import { goBack } from '../../domain/tournament/waterfall-steps';
import { renderApp } from '../shell/test-app';

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const bracketOf = (state: TournamentState, role: 'admin' | 'viewer') =>
  renderApp(
    {
      id: 'anon-final',
      state: { ...state, tournamentId: 'anon-final' },
      status: 'published' as const,
      tabs: ['Bracket'],
    },
    { role, tab: 'bracket', context: { updateState: () => {} } },
  );

describe('the Bracket with a Final game marked anonymous', () => {
  const flagged = flagFinalGameAnonymous(
    playDependency(atEntry(37, UPPER_LOWER_GRAPH), STRATEGIES['all at once']),
    1,
  );

  it('shows the anonymous card beside the drawn Final', () => {
    const view = bracketOf(flagged, 'admin');
    expect(view.container.textContent).toContain('Anonymous matches');
    expect(view.container.textContent).toContain('Finalist-1');
  });

  it.each(['admin', 'viewer'] as const)(
    'renders for the %s once the Final is not drawn: the mark stays, the list is empty',
    (role) => {
      const undone = goBack(flagged);
      const finalRound = undone.rounds.find((round) => round.isFinal);
      expect(finalRound?.anonymousGames).toEqual([1]);
      expect(undone.anonymousFinalists).toEqual([]);
      const view = bracketOf(undone, role);
      expect(view.container.textContent).not.toContain('Anonymous matches');
    },
  );
});
