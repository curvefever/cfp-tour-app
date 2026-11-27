import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { TournamentRuntime } from '../../domain/tournament/runtime';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import { saveLiveEnvelope } from '../../lib/persistence/storage';
import type { useAuth } from '../auth/AuthProvider';
import { getFirebaseSetupTransport, getFirebaseSyncTransport } from '../sync/firebase-client';
import { SyncCoordinator, type SyncStatus, type SyncTransport } from '../sync/live-sync';
import { SetupSync } from '../sync/setup-sync';
import { stateDescription } from '../tournaments/tournament-summary';

/**
 * The two links to the database: the coordinator of the tournament's state and the one of the Setup form, each created
 * once the visit memory is read, configured for the loaded tournament and fed what the database changes.
 */

declare global {
  interface Window {
    __CURVE_TOUR_SYNC_TRANSPORT__?: SyncTransport;
  }
}

export function useTournamentSync({
  auth,
  hydrated,
  runtime,
  state,
  setState,
  setSetup,
  stateRef,
  setupRef,
  activeTabRef,
  isViewerRef,
}: {
  auth: ReturnType<typeof useAuth>;
  hydrated: boolean;
  runtime: TournamentRuntime;
  state: TournamentState;
  setState: Dispatch<SetStateAction<TournamentState>>;
  setSetup: Dispatch<SetStateAction<PersistedSetup>>;
  stateRef: RefObject<TournamentState>;
  setupRef: RefObject<PersistedSetup>;
  activeTabRef: RefObject<ActiveTab>;
  isViewerRef: RefObject<boolean>;
}) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' });
  const sync = useRef<SyncCoordinator | null>(null);
  const setupSync = useRef<SetupSync | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const coordinator = new SyncCoordinator(stateRef.current, {
      transport: window.__CURVE_TOUR_SYNC_TRANSPORT__ ?? getFirebaseSyncTransport(),
      onStatus: setSyncStatus,
      describe: stateDescription,
      onRemote(remote) {
        const next = normalizeLiveTournamentState(remote, runtime.ids);
        stateRef.current = next;
        setState(next);
        saveLiveEnvelope(
          window.localStorage,
          { T: next, setup: setupRef.current, activeTab: activeTabRef.current },
          { isViewer: isViewerRef.current },
        );
      },
    });
    sync.current = coordinator;
    return () => {
      coordinator.dispose();
      if (sync.current === coordinator) sync.current = null;
    };
  }, [hydrated, runtime]);

  useEffect(() => {
    if (!hydrated) return;
    const setupCoordinator = new SetupSync(setupRef.current, {
      transport: getFirebaseSetupTransport(),
      onRemote(remote) {
        setupRef.current = remote;
        setSetup(remote);
        saveLiveEnvelope(
          window.localStorage,
          { T: stateRef.current, setup: remote, activeTab: activeTabRef.current },
          { isViewer: isViewerRef.current },
        );
      },
      onError: (message) => console.warn('Could not save the Setup form', message),
    });
    setupSync.current = setupCoordinator;
    return () => {
      setupCoordinator.dispose();
      if (setupSync.current === setupCoordinator) setupSync.current = null;
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated || !sync.current) return;
    sync.current.configure(auth.canAdmin ? 'writer' : 'viewer', state.tournamentId);
  }, [auth.canAdmin, hydrated, state.tournamentId]);

  useEffect(() => {
    if (!hydrated || !setupSync.current) return;
    setupSync.current.configure(auth.canAdmin ? state.tournamentId : null);
  }, [auth.canAdmin, hydrated, state.tournamentId]);

  useEffect(() => {
    sync.current?.setCurrent(state);
  }, [state]);

  const flushPending = useCallback(async () => {
    await Promise.all([sync.current?.flush(), setupSync.current?.flush()]);
  }, []);

  return { syncStatus, sync, setupSync, flushPending };
}
