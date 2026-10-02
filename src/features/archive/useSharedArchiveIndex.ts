import { useEffect, useState } from 'react';
import { subscribeArchiveIndex } from '../sync/firebase-client';
import type { SharedArchiveSummary } from './shared-archive';

export type SharedArchiveIndexState = {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  entries: SharedArchiveSummary[];
};

/** Live, newest-first list of the shared archive index. */
export function useSharedArchiveIndex(): SharedArchiveIndexState {
  const [index, setIndex] = useState<SharedArchiveIndexState>({ status: 'loading', entries: [] });
  useEffect(() => {
    const unsubscribe = subscribeArchiveIndex(
      (entries) => setIndex({ status: 'ready', entries }),
      () => setIndex({ status: 'error', entries: [] }),
    );
    if (!unsubscribe) setIndex({ status: 'unavailable', entries: [] });
    return () => unsubscribe?.();
  }, []);
  return index;
}
