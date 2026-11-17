import { BUILD_CHECK_INTERVAL_MS, isBuildCheckDue } from './build-id';

/**
 * Runs `check` (with the time it started) when the tab gains focus or becomes visible, and every few minutes while it
 * is visible: never more than once a minute (`isBuildCheckDue`) and not on mount. Returns what stops it; call that when
 * the effect that started it ends.
 */
export function whenTabActive(check: (startedAt: number) => void): () => void {
  let lastCheckedAt: number | null = null;
  const run = () => {
    if (!isBuildCheckDue(lastCheckedAt, Date.now())) return;
    const startedAt = Date.now();
    lastCheckedAt = startedAt;
    check(startedAt);
  };
  const runIfVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', runIfVisible);
  const timer = setInterval(runIfVisible, BUILD_CHECK_INTERVAL_MS);
  return () => {
    window.removeEventListener('focus', run);
    document.removeEventListener('visibilitychange', runIfVisible);
    clearInterval(timer);
  };
}
