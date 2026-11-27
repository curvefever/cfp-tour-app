import { useEffect } from 'react';
import type { ActiveTab, TournamentState } from '../../domain/tournament/types';
import { saveLastView } from '../../lib/persistence/storage';

/** Keeps the address and the remembered last view in step with the loaded tournament and the active tab. */
export function useAddressBar(
  hydrated: boolean,
  visitResolved: boolean,
  state: TournamentState,
  activeTab: ActiveTab,
): void {
  // The tournament in the address is the one that is loaded, for everyone, so a reload and a shared link keep it.
  useEffect(() => {
    if (!hydrated || !visitResolved) return;
    const url = state.tournamentId
      ? `${window.location.pathname}?t=${encodeURIComponent(state.tournamentId)}`
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [hydrated, state.tournamentId, visitResolved]);

  useEffect(() => {
    if (!hydrated || !visitResolved || !state.tournamentId) return;
    saveLastView(window.localStorage, { tournamentId: state.tournamentId, tab: activeTab });
  }, [activeTab, hydrated, state.tournamentId, visitResolved]);
}
