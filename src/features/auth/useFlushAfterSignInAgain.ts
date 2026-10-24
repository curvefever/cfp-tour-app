import { useEffect, useRef } from 'react';

/** Runs `flush` when an expired session ends because the admin signed in again (not because they signed out). */
export function useFlushAfterSignInAgain(
  sessionExpired: boolean,
  canAdmin: boolean,
  flush: () => void,
): void {
  const wasExpired = useRef(false);
  useEffect(() => {
    if (wasExpired.current && !sessionExpired && canAdmin) flush();
    wasExpired.current = sessionExpired;
  }, [canAdmin, flush, sessionExpired]);
}
