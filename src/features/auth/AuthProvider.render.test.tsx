// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, type AuthSnapshot } from './auth.shared';
import { AuthProvider, useAuth } from './AuthProvider';
import { signalSessionExpired } from './session-expired-signal';

const api = vi.hoisted(() => ({ postJSON: vi.fn() }));
vi.mock('../../lib/api', () => api);

const HOST: AuthSnapshot = {
  roles: [Role.TOUR_HOST],
  status: 'authenticated',
  userId: 'h',
  username: 'Host',
};
const ANONYMOUS: AuthSnapshot = { roles: [], status: 'anonymous', userId: '', username: '' };

let auth!: ReturnType<typeof useAuth>;
function Probe() {
  auth = useAuth();
  return null;
}

function mount(initialAuth: AuthSnapshot) {
  render(
    <AuthProvider initialAuth={initialAuth}>
      <Probe />
    </AuthProvider>,
  );
}

const expire = () => act(() => signalSessionExpired());
const signIn = () => act(() => auth.login('host@example.com', 'secret'));

beforeEach(() => {
  api.postJSON.mockReset();
});
afterEach(cleanup);

describe('AuthProvider when the CFP session ends', () => {
  it('raises sessionExpired and keeps the tab an admin tab', () => {
    mount(HOST);
    expect(auth.sessionExpired).toBe(false);
    expire();
    expect(auth.sessionExpired).toBe(true);
    expect(auth.canAdmin).toBe(true);
    expect(auth.username).toBe('Host');
  });

  it('ignores the signal in a viewer tab', () => {
    mount(ANONYMOUS);
    expire();
    expect(auth.sessionExpired).toBe(false);
    expect(auth.canAdmin).toBe(false);
  });

  it('keeps canAdmin true while a sign-in attempt is under way and after a refused one', async () => {
    mount(HOST);
    expire();
    api.postJSON.mockRejectedValueOnce(new Error('Wrong password'));
    await signIn();
    expect(auth.canAdmin).toBe(true);
    expect(auth.sessionExpired).toBe(true);
    expect(auth.error).toBe('Wrong password');
  });

  it('keeps canAdmin true while the sign-in request is still pending', async () => {
    mount(HOST);
    expire();
    let answer!: (value: unknown) => void;
    api.postJSON.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    let attempt!: Promise<boolean>;
    act(() => {
      attempt = auth.login('host@example.com', 'secret');
    });
    expect(auth.status).toBe('submitting');
    expect(auth.canAdmin).toBe(true);
    await act(async () => {
      answer({ username: 'Host', roles: [Role.TOUR_HOST], accessToken: 'new' });
      await attempt;
    });
    expect(auth.canAdmin).toBe(true);
  });

  it('clears sessionExpired on a successful sign-in, and may be another account', async () => {
    mount(HOST);
    expire();
    api.postJSON.mockResolvedValueOnce({
      username: 'Other',
      roles: [Role.LEAD_TOUR_HOST],
      accessToken: 'new',
    });
    await signIn();
    expect(auth.sessionExpired).toBe(false);
    expect(auth.canAdmin).toBe(true);
    expect(auth.username).toBe('Other');
  });

  it('a sign-in without admin access leaves the tab expired, with the error', async () => {
    mount(HOST);
    expire();
    api.postJSON.mockResolvedValueOnce({ username: 'Player', roles: [Role.TRANSLATOR], accessToken: 'new' });
    await signIn();
    expect(auth.canAdmin).toBe(true);
    expect(auth.sessionExpired).toBe(true);
    expect(auth.error).toMatch(/does not have Tournament Hub admin access/);
  });

  it('clears sessionExpired on sign-out, and a late signal does not bring it back', () => {
    mount(HOST);
    expire();
    act(() => auth.logout());
    expect(auth.sessionExpired).toBe(false);
    expect(auth.canAdmin).toBe(false);
    expire();
    expect(auth.sessionExpired).toBe(false);
  });
});
