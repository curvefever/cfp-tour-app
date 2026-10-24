import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_EXPIRED_MESSAGE } from './auth.shared';
import { sessionExpiredMiddleware } from './session-expired.middleware';
import { onSessionExpired } from './session-expired-signal';

type ClientOptions = Parameters<NonNullable<typeof sessionExpiredMiddleware.options.client>>[0];

/** Runs the middleware's client step with a `next` that settles as given. */
function run(next: () => Promise<unknown>) {
  return sessionExpiredMiddleware.options.client!({ next } as unknown as ClientOptions);
}

describe('sessionExpiredMiddleware', () => {
  const heard = vi.fn();
  const unsubscribe = onSessionExpired(heard);
  afterEach(() => heard.mockClear());

  it('passes a successful call through without a signal', async () => {
    await expect(run(() => Promise.resolve('result'))).resolves.toBe('result');
    expect(heard).not.toHaveBeenCalled();
  });

  it('signals once and rethrows when the server call fails with the expiry message', async () => {
    const error = new Error(SESSION_EXPIRED_MESSAGE);
    await expect(run(() => Promise.reject(error))).rejects.toBe(error);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('rethrows any other failure without a signal', async () => {
    await expect(run(() => Promise.reject(new Error('Invalid or expired token')))).rejects.toThrow(
      'Invalid or expired token',
    );
    await expect(run(() => Promise.reject(new TypeError('Failed to fetch')))).rejects.toThrow(
      'Failed to fetch',
    );
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops signalling once unsubscribed', async () => {
    unsubscribe();
    await expect(run(() => Promise.reject(new Error(SESSION_EXPIRED_MESSAGE)))).rejects.toThrow();
    expect(heard).not.toHaveBeenCalled();
  });
});
