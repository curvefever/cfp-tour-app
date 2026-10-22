// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD_CHECK_INTERVAL_MS, BUILD_CHECK_MIN_GAP_MS, TOUR_BUILD_ID } from './build-id';
import { useLiveBuildCheck } from './useLiveBuildCheck';

// A plain function, not `vi.fn`, as in `NewVersionBanner.render.test.tsx`.
const liveBuild = vi.hoisted(() => ({ asks: 0 }));
vi.mock('./build-id.server-fns', () => ({
  getLiveBuild: () => {
    liveBuild.asks += 1;
    return Promise.resolve('the-live-build');
  },
}));

const START = new Date('2026-10-22T12:00:00Z');

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

const focusWindow = () => window.dispatchEvent(new Event('focus'));

beforeEach(() => {
  liveBuild.asks = 0;
  vi.useFakeTimers();
  vi.setSystemTime(START);
  setVisibility('visible');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useLiveBuildCheck', () => {
  it('differs from the tab’s own build in this test, so a check would flag it', () => {
    expect(TOUR_BUILD_ID).not.toBe('the-live-build');
  });

  it('asks on focus, but not again within the minimum gap', () => {
    renderHook(() => useLiveBuildCheck(true));
    focusWindow();
    expect(liveBuild.asks).toBe(1);
    vi.setSystemTime(START.getTime() + BUILD_CHECK_MIN_GAP_MS - 1_000);
    focusWindow();
    expect(liveBuild.asks).toBe(1);
    vi.setSystemTime(START.getTime() + BUILD_CHECK_MIN_GAP_MS);
    focusWindow();
    expect(liveBuild.asks).toBe(2);
  });

  it('asks when the tab becomes visible, not when it becomes hidden', () => {
    renderHook(() => useLiveBuildCheck(true));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(liveBuild.asks).toBe(0);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(liveBuild.asks).toBe(1);
  });

  it('asks every interval while the tab is visible', () => {
    renderHook(() => useLiveBuildCheck(true));
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(liveBuild.asks).toBe(1);
  });

  it('does not ask on the interval while the tab is hidden', () => {
    renderHook(() => useLiveBuildCheck(true));
    setVisibility('hidden');
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(liveBuild.asks).toBe(0);
  });
});
