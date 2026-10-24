import { useEffect } from 'react';
import { BUILD_CHECK_INTERVAL_MS, isBuildCheckDue } from '../version/build-id';
import { checkSession } from './server/session-check.server-fns';
import { signalSessionExpired } from './session-expired-signal';

/**
 * While `enabled` (an unlocked admin tab whose session has not ended) asks whether CFP still accepts the
 * session: when the tab gains focus or becomes visible, and every few minutes while it is visible, never
 * more than once a minute and not on mount. Only an `expired` answer raises the signal; `unknown` and a
 * failed ask are ignored and retried at the next trigger.
 */
export function useSessionCheck(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let lastCheckedAt: number | null = null;
    const check = () => {
      if (!isBuildCheckDue(lastCheckedAt, Date.now())) return;
      const startedAt = Date.now();
      lastCheckedAt = startedAt;
      checkSession().then(
        (answer) => {
          if (answer === 'expired') signalSessionExpired(startedAt);
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
  }, [enabled]);
}
