import { useEffect, useState } from 'react';
import { BUILD_CHECK_INTERVAL_MS, isBuildCheckDue, TOUR_BUILD_ID } from './build-id';
import { getLiveBuild } from './build-id.server-fns';

/**
 * True once the server runs another build than this tab was loaded with (and until the reload). While
 * `enabled` it asks when the tab gains focus or becomes visible, and every few minutes while it is visible;
 * a failed ask is ignored and retried at the next trigger. A freshly loaded tab is current, so nothing is
 * asked on mount.
 */
export function useLiveBuildCheck(enabled: boolean): boolean {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    if (!enabled || outdated) return;
    let lastCheckedAt: number | null = null;
    const check = () => {
      if (!isBuildCheckDue(lastCheckedAt, Date.now())) return;
      lastCheckedAt = Date.now();
      getLiveBuild().then(
        (live) => {
          if (live !== TOUR_BUILD_ID) setOutdated(true);
        },
        () => {},
      );
    };
    const checkIfVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', checkIfVisible);
    const timer = setInterval(checkIfVisible, BUILD_CHECK_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', checkIfVisible);
      clearInterval(timer);
    };
  }, [enabled, outdated]);
  return outdated;
}
