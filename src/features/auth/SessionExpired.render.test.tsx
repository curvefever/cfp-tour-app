// @vitest-environment jsdom
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureTournaments } from '../../../e2e/screens/fixtures';
import { renderApp, type AppRole } from '../shell/test-app';
import { Role, type SessionCheck } from './auth.shared';
import { signalSessionExpired } from './session-expired-signal';

const api = vi.hoisted(() => ({ postJSON: vi.fn() }));
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  ...api,
}));
const sessionCheck = vi.hoisted((): { answer: SessionCheck } => ({ answer: 'valid' }));
vi.mock('./server/session-check.server-fns', () => ({
  checkSession: () => Promise.resolve(sessionCheck.answer),
}));
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

const expire = () => act(() => signalSessionExpired(Date.now()));

beforeEach(() => {
  api.postJSON.mockReset();
  sessionCheck.answer = 'valid';
});
afterEach(cleanup);

/** Types credentials into the open dialog and submits them; CFP accepts them as a Tour Host. */
async function signInThroughDialog(view: ReturnType<typeof renderTab>) {
  api.postJSON.mockResolvedValueOnce({ username: 'Host', roles: [Role.TOUR_HOST], accessToken: 'new' });
  fireEvent.change(view.getByLabelText('Email'), { target: { value: 'host@example.com' } });
  fireEvent.change(view.getByLabelText('Password'), { target: { value: 'secret' } });
  await act(() => {
    fireEvent.submit(view.getByLabelText('Email').closest('form')!);
    return Promise.resolve();
  });
}

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

  it('keeps an expired tab on the tab it was on when it signs in again', async () => {
    const unlockAdmin = vi.fn();
    const view = renderApp(fixtureTournaments()[0], {
      role: 'admin',
      tab: 'bracket',
      context: { unlockAdmin },
    });
    expire();
    await signInThroughDialog(view);
    expect(view.queryByText(DIALOG)).toBeNull();
    expect(view.queryByText(BANNER)).toBeNull();
    expect(unlockAdmin).not.toHaveBeenCalled();
  });

  it('sends a normal sign-in from a locked tab to the Admin tab', async () => {
    const unlockAdmin = vi.fn();
    const view = renderApp(fixtureTournaments()[0], {
      role: 'viewer',
      tab: 'tournaments',
      context: { unlockAdmin },
    });
    fireEvent.click(view.getByRole('button', { name: 'Log in as admin' }));
    await signInThroughDialog(view);
    expect(unlockAdmin).toHaveBeenCalledTimes(1);
  });

  it('raises the banner when the proactive check answers expired on focus', async () => {
    sessionCheck.answer = 'expired';
    const view = renderTab('admin');
    await act(() => {
      window.dispatchEvent(new Event('focus'));
      return Promise.resolve();
    });
    expect(view.queryByText(BANNER)).not.toBeNull();
  });

  it('ignores a proactive check that answers unknown', async () => {
    sessionCheck.answer = 'unknown';
    const view = renderTab('admin');
    await act(() => {
      window.dispatchEvent(new Event('focus'));
      return Promise.resolve();
    });
    expect(view.queryByText(BANNER)).toBeNull();
  });

  it('shows a viewer neither', () => {
    const view = renderTab('viewer');
    expire();
    expect(view.queryByText(BANNER)).toBeNull();
    expect(view.queryByText(DIALOG)).toBeNull();
  });
});
