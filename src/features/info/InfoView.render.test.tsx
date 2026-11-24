// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fixtureTournaments } from '../../../e2e/screens/fixtures';
import { renderApp, settle } from '../../test-support/test-app';

// Only what reaches the network is replaced, as in the other render checks.
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

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

const fixture = (id: string) => {
  const found = fixtureTournaments().find((entry) => entry.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe('the Schedule section of Info', () => {
  it.each(['viewer', 'admin'] as const)('is there as a %s once the schedule has rounds', async (role) => {
    const view = renderApp(fixture('ffa37-quarters'), { role, tab: 'info' });
    await settle();
    expect(view.queryByRole('region', { name: 'Schedule' })).not.toBeNull();
    expect(view.queryByText('Schedule')).not.toBeNull();
  });

  it('is not there before any round exists', async () => {
    const view = renderApp(fixture('upcoming-info'), { role: 'viewer', tab: 'info' });
    await settle();
    expect(view.queryByRole('region', { name: 'Schedule' })).toBeNull();
  });

  it('does not crash where there is no canvas: no picture, no error', async () => {
    const view = renderApp(fixture('layered-31'), { role: 'viewer', tab: 'info' });
    await settle();
    expect(view.queryByRole('region', { name: 'Schedule' })).not.toBeNull();
    expect(view.container.querySelector('img[alt^="The schedule"]')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
