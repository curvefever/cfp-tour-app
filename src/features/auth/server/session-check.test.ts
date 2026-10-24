import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_TOKEN_KEY, Role } from '../auth.shared';
import { resetAuthSessionCache } from './auth-session-cache.server';

const request = vi.hoisted(() => ({ cookie: '' }));

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () =>
    new Request('https://tournaments-test.curvefever.pro/_serverFn/x', {
      headers: { cookie: request.cookie },
    }),
}));

const { answerSessionCheck } = await import('./session-check.server');

function stubCfp(response: { ok: boolean; status?: number; body: unknown } | Error) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve({
            ok: response.ok,
            status: response.status ?? 200,
            json: () => Promise.resolve(response.body),
          }),
    ),
  );
}

describe('answerSessionCheck', () => {
  beforeEach(() => {
    request.cookie = `${ACCESS_TOKEN_KEY}=tok`;
    resetAuthSessionCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers valid when CFP accepts the token', async () => {
    stubCfp({ ok: true, body: { username: 'Host', roles: [Role.TOUR_HOST] } });
    await expect(answerSessionCheck()).resolves.toBe('valid');
  });

  it('answers expired when there is no cookie', async () => {
    request.cookie = '';
    await expect(answerSessionCheck()).resolves.toBe('expired');
  });

  it('answers expired when CFP answers code 700', async () => {
    stubCfp({
      ok: false,
      status: 401,
      body: { code: 700, message: 'INVALID_TOKEN | Invalid or expired token' },
    });
    await expect(answerSessionCheck()).resolves.toBe('expired');
  });

  it('answers unknown for a network failure and for a CFP 5xx', async () => {
    stubCfp(new TypeError('fetch failed'));
    await expect(answerSessionCheck()).resolves.toBe('unknown');
    stubCfp({ ok: false, status: 500, body: { code: 500, message: 'Internal error' } });
    await expect(answerSessionCheck()).resolves.toBe('unknown');
  });
});
