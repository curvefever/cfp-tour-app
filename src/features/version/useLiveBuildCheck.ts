import { useEffect, useState } from 'react';
import { TOUR_BUILD_ID } from './build-id';
import { whenTabActive } from './tab-checks';
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
    return whenTabActive(() => {
      getLiveBuild().then(
        (live) => {
          if (live !== TOUR_BUILD_ID) setOutdated(true);
        },
        () => {},
      );
    });
  }, [enabled, outdated]);
  return outdated;
}
