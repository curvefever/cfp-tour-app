import { useEffect } from 'react';
import { whenTabActive } from '../version/tab-checks';
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
    return whenTabActive((startedAt) => {
      checkSession().then(
        (answer) => {
          if (answer === 'expired') signalSessionExpired(startedAt);
        },
        () => {},
      );
    });
  }, [enabled]);
}
