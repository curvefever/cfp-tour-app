import { afterEach, describe, expect, it, vi } from 'vitest';
import { getApiBaseURL, postJSON } from './api';

describe('getApiBaseURL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses VITE_API_ENDPOINT verbatim when it already has a scheme', () => {
    vi.stubEnv('VITE_API_ENDPOINT', 'https://custom.example.com');
    expect(getApiBaseURL()).toBe('https://custom.example.com');
  });

  it('wraps a schemeless VITE_API_ENDPOINT with http:// for a localhost-ish host', () => {
    vi.stubEnv('VITE_API_ENDPOINT', 'localhost:9000');
    expect(getApiBaseURL()).toBe('http://localhost:9000');
  });

  it('wraps a schemeless VITE_API_ENDPOINT with https:// otherwise', () => {
    vi.stubEnv('VITE_API_ENDPOINT', 'api.example.com');
    expect(getApiBaseURL()).toBe('https://api.example.com');
  });

  it('falls back to localhost:8000 for a localhost/127.0.0.1 hostname with no env var', () => {
    // The repo's own .env sets a real VITE_API_ENDPOINT for local dev -- stub it away
    // so these cases actually exercise the "no env var" fallback path.
    vi.stubEnv('VITE_API_ENDPOINT', '');
    expect(getApiBaseURL('localhost')).toBe('http://localhost:8000');
    expect(getApiBaseURL('127.0.0.1')).toBe('http://localhost:8000');
  });

  it('falls back to api-test.curvefever.pro for a *-test.curvefever.pro hostname', () => {
    vi.stubEnv('VITE_API_ENDPOINT', '');
    expect(getApiBaseURL('test.curvefever.pro')).toBe('https://api-test.curvefever.pro');
    expect(getApiBaseURL('tournaments-test.curvefever.pro')).toBe('https://api-test.curvefever.pro');
  });

  it('falls back to api.curvefever.pro for any other or missing hostname', () => {
    vi.stubEnv('VITE_API_ENDPOINT', '');
    expect(getApiBaseURL('tournaments.curvefever.pro')).toBe('https://api.curvefever.pro');
    expect(getApiBaseURL()).toBe('https://api.curvefever.pro');
  });
});

describe('postJSON', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts JSON to the resolved endpoint and returns the parsed body on success', async () => {
    // Stub away the repo's real .env VITE_API_ENDPOINT so this exercises the
    // hostname-derived fallback, not whatever happens to be configured locally.
    vi.stubEnv('VITE_API_ENDPOINT', '');
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await postJSON('/things', { a: 1 }, { hostname: 'tournaments.curvefever.pro' });
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('https://api.curvefever.pro/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it('throws the response body message for a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({ data: { message: 'Nope' } }) })),
    );
    await expect(postJSON('/things', {})).rejects.toThrow('Nope');
  });

  it('throws the generic fallback message when the error body cannot be parsed as JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.reject(new Error('bad body')) })),
    );
    await expect(postJSON('/things', {})).rejects.toThrow('Unable to complete the request.');
  });
});
