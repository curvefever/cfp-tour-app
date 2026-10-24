import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_TOKEN_KEY, Role, SESSION_EXPIRED_MESSAGE } from '../auth.shared';
import { resetAuthSessionCache } from './auth-session-cache.server';

const request = vi.hoisted(() => ({ cookie: '' }));

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://tournaments-test.curvefever.pro/_serverFn/x', {
      headers: { cookie: request.cookie },
    }),
}));
vi.mock('../../version/build-guard.server', () => ({ requireCurrentBuild: () => undefined }));

const { requireTourAdminPermission } = await import('./tour-permissions.server');

function stubCfp(response: { ok: boolean; status?: number; body: unknown } | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve({
          ok: response.ok,
          status: response.status ?? 200,
          json: () => Promise.resolve(response.body),
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const invalidToken = {
  ok: false,
  status: 401,
  body: { code: 700, message: 'INVALID_TOKEN | Invalid or expired token' },
};

describe('requireTourAdminPermission', () => {
  beforeEach(() => {
    request.cookie = `${ACCESS_TOKEN_KEY}=tok`;
    resetAuthSessionCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the snapshot of an admin account', async () => {
    stubCfp({ ok: true, body: { username: 'Host', roles: [Role.TOUR_HOST] } });
    await expect(requireTourAdminPermission()).resolves.toMatchObject({ username: 'Host' });
  });

  it('reports the fixed expiry message when there is no cookie', async () => {
    request.cookie = '';
    await expect(requireTourAdminPermission()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
  });

  it('reports the fixed expiry message when CFP answers code 700', async () => {
    stubCfp(invalidToken);
    await expect(requireTourAdminPermission()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
  });

  it('passes a network failure through unchanged', async () => {
    stubCfp(new TypeError('fetch failed'));
    await expect(requireTourAdminPermission()).rejects.toThrow(new TypeError('fetch failed'));
  });

  it('passes a CFP 5xx through unchanged', async () => {
    stubCfp({ ok: false, status: 500, body: { code: 500, message: 'Internal error' } });
    await expect(requireTourAdminPermission()).rejects.toThrow('Internal error');
  });

  it('keeps its own wording for an account without admin access', async () => {
    stubCfp({ ok: true, body: { username: 'Player', roles: [Role.TRANSLATOR] } });
    await expect(requireTourAdminPermission()).rejects.toThrow(
      'Your CFP account does not have Tournament Hub admin access.',
    );
  });

  it('does not keep a failure in the 60 s cache: signing in again works at once', async () => {
    stubCfp(invalidToken);
    await expect(requireTourAdminPermission()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    stubCfp({ ok: true, body: { username: 'Host', roles: [Role.TOUR_HOST] } });
    await expect(requireTourAdminPermission()).resolves.toMatchObject({ username: 'Host' });
  });
});
