// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureTournaments } from '../../../e2e/screens/fixtures';
import { renderApp, type AppRole } from '../shell/test-app';
import { TOUR_BUILD_ID } from './build-id';

// A plain function, not `vi.fn`: its result tracking leaves a rejected promise unhandled.
const liveBuild = vi.hoisted(() => ({ asks: 0, answer: (): Promise<string> => Promise.resolve('') }));
vi.mock('./build-id.server-fns', () => ({
  getLiveBuild: () => {
    liveBuild.asks += 1;
    return liveBuild.answer();
  },
}));
vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));

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

const BANNER = 'A new version is live — reload to keep editing.';

/** Fires the window's focus event and lets the resulting ask settle. */
const focusWindow = () =>
  act(() => {
    window.dispatchEvent(new Event('focus'));
    return Promise.resolve();
  });

function renderTab(role: AppRole) {
  const view = renderApp(fixtureTournaments()[0], { role, tab: 'info' });
  expect(liveBuild.asks).toBe(0);
  expect(view.queryByText(BANNER)).toBeNull();
  return view;
}

beforeEach(() => {
  liveBuild.asks = 0;
});
afterEach(cleanup);

describe('the new-version banner', () => {
  it('shows an admin the banner and a Reload button when the live build is another one', async () => {
    liveBuild.answer = () => Promise.resolve('another-build');
    const view = renderTab('admin');
    await focusWindow();
    expect(view.queryByText(BANNER)).not.toBeNull();
    expect(view.queryByRole('button', { name: 'Reload' })).not.toBeNull();
  });

  it('shows an admin nothing when the live build is the tab’s own', async () => {
    liveBuild.answer = () => Promise.resolve(TOUR_BUILD_ID);
    const view = renderTab('admin');
    await focusWindow();
    expect(liveBuild.asks).toBe(1);
    expect(view.queryByText(BANNER)).toBeNull();
  });

  it('does not ask a viewer, and shows no banner', async () => {
    liveBuild.answer = () => Promise.resolve('another-build');
    const view = renderTab('viewer');
    await focusWindow();
    expect(liveBuild.asks).toBe(0);
    expect(view.queryByText(BANNER)).toBeNull();
  });

  it('ignores a failed ask', async () => {
    liveBuild.answer = () => Promise.reject(new Error('offline'));
    const view = renderTab('admin');
    await focusWindow();
    expect(liveBuild.asks).toBe(1);
    expect(view.queryByText(BANNER)).toBeNull();
  });
});
