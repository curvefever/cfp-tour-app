// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILD_CHECK_INTERVAL_MS, BUILD_CHECK_MIN_GAP_MS } from './build-id';
import { whenTabActive } from './tab-checks';

const START = new Date('2026-11-17T12:00:00Z');

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
}

const focusWindow = () => window.dispatchEvent(new Event('focus'));
const showTab = () => document.dispatchEvent(new Event('visibilitychange'));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  setVisibility('visible');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('whenTabActive', () => {
  it('does not run on mount', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    expect(check).not.toHaveBeenCalled();
    stop();
  });

  it('runs when the tab gains focus, with the time it started', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    focusWindow();
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(START.getTime());
    stop();
  });

  it('runs when the tab becomes visible, but not when it becomes hidden', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    setVisibility('hidden');
    showTab();
    expect(check).not.toHaveBeenCalled();
    setVisibility('visible');
    showTab();
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  it('runs on the interval while the tab is visible, and not while it is hidden', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    setVisibility('hidden');
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(check).not.toHaveBeenCalled();
    setVisibility('visible');
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not run twice inside the minimum gap, and runs again after it', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    focusWindow();
    vi.advanceTimersByTime(BUILD_CHECK_MIN_GAP_MS - 1);
    focusWindow();
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    focusWindow();
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops all three triggers when the returned function is called', () => {
    const check = vi.fn();
    const stop = whenTabActive(check);
    stop();
    focusWindow();
    showTab();
    vi.advanceTimersByTime(BUILD_CHECK_INTERVAL_MS * 3);
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
