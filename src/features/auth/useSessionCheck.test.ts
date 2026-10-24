// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD_CHECK_INTERVAL_MS, BUILD_CHECK_MIN_GAP_MS } from '../version/build-id';
import type { SessionCheck } from './auth.shared';
import { onSessionExpired } from './session-expired-signal';
import { useSessionCheck } from './useSessionCheck';

// Plain functions, not `vi.fn`: result tracking leaves a rejected promise unhandled.
const check = vi.hoisted(() => ({ asks: 0, answer: (): Promise<SessionCheck> => Promise.resolve('valid') }));
vi.mock('./server/session-check.server-fns', () => ({
  checkSession: () => {
    check.asks += 1;
    return check.answer();
  },
}));

const START = new Date('2026-10-24T12:00:00Z');
const heard = vi.fn();
let unsubscribe: () => void;

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

/** Fires the window's focus event and lets the answer settle. */
const focusWindow = async () => {
  window.dispatchEvent(new Event('focus'));
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  check.asks = 0;
  check.answer = () => Promise.resolve('valid');
  heard.mockClear();
  unsubscribe = onSessionExpired(heard);
  vi.useFakeTimers();
  vi.setSystemTime(START);
  setVisibility('visible');
});

afterEach(() => {
  cleanup();
  unsubscribe();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useSessionCheck', () => {
  it('asks on focus, but not again within the minimum gap', async () => {
    renderHook(() => useSessionCheck(true));
    await focusWindow();
    expect(check.asks).toBe(1);
    vi.setSystemTime(START.getTime() + BUILD_CHECK_MIN_GAP_MS - 1_000);
    await focusWindow();
    expect(check.asks).toBe(1);
    vi.setSystemTime(START.getTime() + BUILD_CHECK_MIN_GAP_MS);
    await focusWindow();
    expect(check.asks).toBe(2);
  });

  it('does not ask on mount', async () => {
    renderHook(() => useSessionCheck(true));
    await vi.advanceTimersByTimeAsync(0);
    expect(check.asks).toBe(0);
  });

  it('asks when the tab becomes visible, not when it becomes hidden', () => {
    renderHook(() => useSessionCheck(true));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(check.asks).toBe(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(check.asks).toBe(1);
  });

  it('asks every interval while the tab is visible, and not while it is hidden', () => {
    renderHook(() => useSessionCheck(true));
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(check.asks).toBe(1);
    setVisibility('hidden');
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(check.asks).toBe(1);
  });

  it('does not ask while disabled', async () => {
    renderHook(() => useSessionCheck(false));
    await focusWindow();
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(check.asks).toBe(0);
  });

  it('raises the signal on an expired answer, with the moment the ask began', async () => {
    check.answer = () => Promise.resolve('expired');
    renderHook(() => useSessionCheck(true));
    await focusWindow();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(START.getTime());
  });

  it('never raises the signal on a valid or unknown answer, or on a failed ask', async () => {
    renderHook(() => useSessionCheck(true));
    for (const answer of [
      () => Promise.resolve<SessionCheck>('valid'),
      () => Promise.resolve<SessionCheck>('unknown'),
      () => Promise.reject<SessionCheck>(new Error('offline')),
    ]) {
      check.answer = answer;
      vi.setSystemTime(Date.now() + BUILD_CHECK_MIN_GAP_MS);
      await focusWindow();
    }
    expect(check.asks).toBe(3);
    expect(heard).not.toHaveBeenCalled();
  });
});
