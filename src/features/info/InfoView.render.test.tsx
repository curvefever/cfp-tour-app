// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
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

const PREVIEW = /Preview the whole schedule/;

describe('the FORMAT card of Info', () => {
  it.each(['viewer', 'admin'] as const)(
    'is a button that opens the schedule window, as a %s',
    async (role) => {
      const view = renderApp(fixture('ffa37-quarters'), { role, tab: 'info' });
      await settle();
      const button = view.getByRole('button', { name: PREVIEW });
      expect(button.textContent).toContain('Format');
      expect(view.queryByRole('dialog')).toBeNull();

      fireEvent.click(button);
      const dialog = view.getByRole('dialog');
      expect(within(dialog).getByText('Schedule')).not.toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(view.queryByRole('dialog')).toBeNull();
    },
  );

  it('closes the window with Escape', async () => {
    const view = renderApp(fixture('ffa37-quarters'), { role: 'viewer', tab: 'info' });
    await settle();
    fireEvent.click(view.getByRole('button', { name: PREVIEW }));
    expect(view.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('has no Schedule section any more', async () => {
    const view = renderApp(fixture('layered-31'), { role: 'viewer', tab: 'info' });
    await settle();
    expect(view.queryByRole('region', { name: 'Schedule' })).toBeNull();
    expect(view.queryByText('Schedule')).toBeNull();
  });

  it('is a plain card before any round exists: no button, no link', async () => {
    const view = renderApp(fixture('upcoming-info'), { role: 'viewer', tab: 'info' });
    await settle();
    expect(view.queryByRole('button', { name: PREVIEW })).toBeNull();
    expect(view.queryByText(PREVIEW)).toBeNull();
    expect(view.getByText('Format')).not.toBeNull();
  });

  it('does not crash where there is no canvas: the window opens empty, with no error', async () => {
    const view = renderApp(fixture('layered-31'), { role: 'viewer', tab: 'info' });
    await settle();
    fireEvent.click(view.getByRole('button', { name: PREVIEW }));
    await settle();
    expect(view.container.ownerDocument.querySelector('img[alt^="The schedule"]')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
