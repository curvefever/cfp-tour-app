import { useEffect, useState } from 'react';
import { subscribeTournamentIndex } from '../sync/firebase-client';
import type { TournamentSummary } from './tournament-summary';

export type TournamentIndexState = {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  summaries: TournamentSummary[];
};

/** Live list of every tournament of this site, as the database holds it (not yet filtered or sorted). */
export function useTournamentIndex(): TournamentIndexState {
  const [index, setIndex] = useState<TournamentIndexState>({ status: 'loading', summaries: [] });
  useEffect(() => {
    const unsubscribe = subscribeTournamentIndex(
      (summaries) => setIndex({ status: 'ready', summaries }),
      () => setIndex({ status: 'error', summaries: [] }),
    );
    if (!unsubscribe) setIndex({ status: 'unavailable', summaries: [] });
    return () => unsubscribe?.();
  }, []);
  return index;
}
