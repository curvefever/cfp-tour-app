// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { playersWhoPlayed } from '../../domain/tournament/players-who-played';
import { renderApp } from '../../test-support/test-app';

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

function fixture(id: string): FixtureTournament {
  const found = fixtureTournaments().find((entry) => entry.id === id);
  if (!found) throw new Error(`the ${id} fixture is missing`);
  return found;
}

/** Replaces the clipboard with a mock; jsdom has none. */
function mockClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: spy } });
  return spy;
}

const COPY = { name: /Copy players/ };

describe('Copy players on the Rankings tab', () => {
  it('gives a viewer no button, and an admin none before the start', () => {
    const viewer = renderApp(fixture('ffa37-pooling'), { role: 'viewer', tab: 'rankings' });
    expect(viewer.queryByRole('button', COPY)).toBeNull();
    cleanup();
    const unstarted = renderApp(fixture('drawn-ffa-31'), { role: 'admin', tab: 'rankings' });
    expect(unstarted.queryByRole('button', COPY)).toBeNull();
  });

  it('copies the players, one name per line, and says how many', async () => {
    const writeText = mockClipboard(() => Promise.resolve());
    const { state } = fixture('ffa37-pooling');
    const expected = playersWhoPlayed(state);
    expect(expected.length).toBeGreaterThan(0);

    const view = renderApp(fixture('ffa37-pooling'), { role: 'admin', tab: 'rankings' });
    fireEvent.click(view.getByRole('button', COPY));

    await waitFor(() => expect(view.queryByText(`Copied ${expected.length} players`)).not.toBeNull());
    expect(writeText).toHaveBeenCalledWith(expected.join('\n'));
  });

  it('shows the list in a read-only box where the clipboard is refused', async () => {
    mockClipboard(() => Promise.reject(new Error('refused')));
    const { state } = fixture('ffa37-pooling');
    const view = renderApp(fixture('ffa37-pooling'), { role: 'admin', tab: 'rankings' });

    fireEvent.click(view.getByRole('button', COPY));

    const box = (await view.findByLabelText('Players to copy')) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe(playersWhoPlayed(state).join('\n'));
  });
});
