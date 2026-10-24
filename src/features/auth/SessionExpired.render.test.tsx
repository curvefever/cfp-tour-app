// @vitest-environment jsdom
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureTournaments } from '../../../e2e/screens/fixtures';
import { renderApp, type AppRole } from '../shell/test-app';
import { signalSessionExpired } from './session-expired-signal';

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));
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

const BANNER = 'Your CFP session has expired — sign in again to keep editing. Your changes are kept.';
const DIALOG = 'Sign in with CFP';

function renderTab(role: AppRole) {
  const view = renderApp(fixtureTournaments()[0], { role, tab: 'info' });
  expect(view.queryByText(BANNER)).toBeNull();
  expect(view.queryByText(DIALOG)).toBeNull();
  return view;
}

const expire = () => act(() => signalSessionExpired());

afterEach(cleanup);

describe('the expired-session banner and dialog', () => {
  it('shows an admin the banner and opens the sign-in dialog by itself, with the expiry line', () => {
    const view = renderTab('admin');
    expire();
    expect(view.queryByText(BANNER)).not.toBeNull();
    expect(view.queryByText(DIALOG)).not.toBeNull();
    expect(view.queryByText(/Your CFP session has expired\. Sign in again to keep editing/)).not.toBeNull();
  });

  it('leaves the banner when the dialog is cancelled, and does not reopen the dialog by itself', () => {
    const view = renderTab('admin');
    expire();
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByText(DIALOG)).toBeNull();
    expire();
    expect(view.queryByText(DIALOG)).toBeNull();
    expect(view.queryByText(BANNER)).not.toBeNull();
  });

  it('reopens the dialog from the banner’s Sign in button', () => {
    const view = renderTab('admin');
    expire();
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(view.getAllByRole('button', { name: 'Sign in' })[0]);
    expect(view.queryByText(DIALOG)).not.toBeNull();
  });

  it('shows a viewer neither', () => {
    const view = renderTab('viewer');
    expire();
    expect(view.queryByText(BANNER)).toBeNull();
    expect(view.queryByText(DIALOG)).toBeNull();
  });
});
