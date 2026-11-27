import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import type { SyncCoordinator } from '../sync/live-sync';
import type { SetupSync } from '../sync/setup-sync';
import type { useBrowserSave } from './useBrowserSave';

/**
 * The three changes the screens make: the active tab, the tournament's state and the Setup form. Each is saved in this
 * browser; a change of the state or the form also goes to the database.
 */
export function useStoreUpdates({
  setActiveTabState,
  setState,
  setSetup,
  persist,
  state,
  setup,
  activeTab,
  stateRef,
  setupRef,
  sync,
  setupSync,
}: {
  setActiveTabState: Dispatch<SetStateAction<ActiveTab>>;
  setState: Dispatch<SetStateAction<TournamentState>>;
  setSetup: Dispatch<SetStateAction<PersistedSetup>>;
  persist: ReturnType<typeof useBrowserSave>['persist'];
  state: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
  stateRef: RefObject<TournamentState>;
  setupRef: RefObject<PersistedSetup>;
  sync: RefObject<SyncCoordinator | null>;
  setupSync: RefObject<SetupSync | null>;
}) {
  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      setActiveTabState(tab);
      persist(state, setup, tab);
    },
    [persist, setup, state],
  );
  // The next value is worked out from the ref, which takes it at once so a second change in the same event builds on
  // it. Saving and sending stay outside React's state updater, which React may run twice.
  const updateState = useCallback(
    (updater: TournamentState | ((current: TournamentState) => TournamentState)) => {
      const current = stateRef.current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      stateRef.current = next;
      setState(next);
      persist(next, setup, activeTab);
      sync.current?.updateLocal(current, next);
    },
    [activeTab, persist, setup],
  );
  const updateSetup = useCallback(
    (updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)) => {
      const current = setupRef.current;
      const next = typeof updater === 'function' ? updater(current) : updater;
      setupRef.current = next;
      setSetup(next);
      persist(state, next, activeTab);
      setupSync.current?.updateLocal(current, next);
    },
    [activeTab, persist, state],
  );
  return { setActiveTab, updateState, updateSetup };
}
