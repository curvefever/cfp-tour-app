import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { resetTournamentState } from '../../domain/tournament/mutations';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { createTournamentRuntime, type TournamentRuntime } from '../../domain/tournament/runtime';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { normalizeLiveTournamentState } from '../../lib/persistence/live-state';
import {
  loadLiveEnvelope,
  readExited,
  readLastView,
  saveBracketFollow,
  saveExited,
  saveLastView,
  saveLiveEnvelope,
  type LastView,
} from '../../lib/persistence/storage';
import { useAuth } from '../auth/AuthProvider';
import { getFirebaseSetupTransport, getFirebaseSyncTransport } from '../sync/firebase-client';
import { getTourEnvironment } from '../sync/firebase-paths';
import { SyncCoordinator, withoutServerOwned, type SyncStatus, type SyncTransport } from '../sync/live-sync';
import { SetupSync } from '../sync/setup-sync';
import { buildTournamentPatch } from '../sync/tournament-patch';
import {
  createTournament,
  deleteTournament,
  finishTournament,
  publishTournament,
  reopenTournament,
  returnTournamentToDraft,
  startTournament,
  unpublishTournament,
} from '../tournaments/tournament-lifecycle.server-fns';
import { tournamentPhase, type TournamentAction } from '../tournaments/tournament-lifecycle';
import { stateDescription, type TournamentSummary } from '../tournaments/tournament-summary';
import { useTournamentIndex, type TournamentIndexState } from '../tournaments/useTournamentIndex';
import { landingTab, resolveVisit } from '../tournaments/visit';

declare global {
  interface Window {
    __CURVE_TOUR_SYNC_TRANSPORT__?: SyncTransport;
  }
}

export interface TournamentAppContext {
  state: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
  hydrated: boolean;
  unlocked: boolean;
  isViewer: boolean;
  /** The tournaments of this site, as the index lists them. */
  tournaments: TournamentIndexState;
  /** False until the first visit has been resolved: until then nothing is loaded yet. */
  visitResolved: boolean;
  /** Why a link opened the Tournaments tab instead of a tournament, if it did. */
  visitNotice: string | null;
  dismissVisitNotice(): void;
  runtime: TournamentRuntime;
  syncStatus: SyncStatus;
  setActiveTab(tab: ActiveTab): void;
  updateState(updater: TournamentState | ((current: TournamentState) => TournamentState)): void;
  updateSetup(updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)): void;
  unlockAdmin(): void;
  lockAdmin(): void;
  /** Loads the tournament with this id (its state and Setup form follow from the database) and puts its id in the address. */
  loadTournament(tournamentId: string): Promise<void>;
  /** Unloads the tournament, after sending what is still waiting. */
  unloadTournament(): Promise<void>;
  /** Opens a tournament from the list, on the tab its phase calls for. */
  openTournament(summary: TournamentSummary): Promise<void>;
  /** Unloads the tournament and remembers it, so a visit without a link does not load it again. */
  exitTournament(): Promise<void>;
  /** Creates a draft tournament in the database and loads it; resolves with an error message, or null on success. */
  createTournamentRecord(testRun: boolean): Promise<string | null>;
  /** Starts the loaded tournament (generated rounds included); resolves with an error message, or null on success. */
  startTournamentNow(): Promise<string | null>;
  /** Sends the loaded tournament back to draft, clearing what was played; resolves with an error message, or null. */
  backToDraft(): Promise<string | null>;
  /** Changes the loaded tournament's status; resolves with the server's refusal or an error message, or null on success. */
  changeStatus(action: StatusAction): Promise<string | null>;
  /** True once the tournament is finished: everything but annotations is then read-only. */
  readOnly: boolean;
}

export type StatusAction = Extract<
  TournamentAction,
  'publish' | 'unpublish' | 'finish' | 'reopen' | 'delete'
>;

const STATUS_CALLS = {
  publish: publishTournament,
  unpublish: unpublishTournament,
  finish: finishTournament,
  reopen: reopenTournament,
  delete: deleteTournament,
} as const;

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}

const Context = createContext<TournamentAppContext | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const runtime = useMemo(() => createTournamentRuntime(), []);
  const [state, setState] = useState(createDefaultTournamentState);
  const [setup, setSetup] = useState(createDefaultSetup);
  const [activeTab, setActiveTabState] = useState<ActiveTab>('tournaments');
  const [hydrated, setHydrated] = useState(false);
  const [visitResolved, setVisitResolved] = useState(false);
  const [visitNotice, setVisitNotice] = useState<string | null>(null);
  const tournaments = useTournamentIndex();
  const isViewer = !auth.canAdmin;
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: 'idle' });
  const sync = useRef<SyncCoordinator | null>(null);
  const setupSync = useRef<SetupSync | null>(null);
  const stateRef = useRef(state);
  const setupRef = useRef(setup);
  const activeTabRef = useRef(activeTab);
  const isViewerRef = useRef(isViewer);
  const initialUrlId = useRef<string | null>(null);
  const memory = useRef<{ lastView: LastView | null; exitedId: string | null }>({
    lastView: null,
    exitedId: null,
  });
  stateRef.current = state;
  setupRef.current = setup;
  activeTabRef.current = activeTab;
  isViewerRef.current = isViewer;

  useEffect(() => {
    window.localStorage.removeItem('curveFFA_admin_unlocked');
    window.localStorage.removeItem('curveFFA_admin_proof_hash');
    initialUrlId.current = new URLSearchParams(window.location.search).get('t');
    memory.current = {
      lastView: readLastView(window.localStorage),
      exitedId: readExited(window.localStorage),
    };
    setHydrated(true);
  }, []);

  const persist = useCallback(
    (nextState: TournamentState, nextSetup: PersistedSetup, nextTab: ActiveTab, viewer = isViewer) => {
      if (typeof window === 'undefined') return;
      const result = saveLiveEnvelope(
        window.localStorage,
        { T: nextState, setup: nextSetup, activeTab: nextTab },
        { isViewer: viewer },
      );
      if (result.status === 'failed') {
        console.warn('Could not save tournament state', result.error);
      }
    },
    [isViewer],
  );

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

  const setActiveTab = useCallback(
    (tab: ActiveTab) => {
      setActiveTabState(tab);
      persist(state, setup, tab);
    },
    [persist, setup, state],
  );
  const updateState = useCallback(
    (updater: TournamentState | ((current: TournamentState) => TournamentState)) => {
      setState((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        persist(next, setup, activeTab);
        sync.current?.updateLocal(current, next);
        return next;
      });
    },
    [activeTab, persist, setup],
  );
  const updateSetup = useCallback(
    (updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)) => {
      setSetup((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        persist(state, next, activeTab);
        setupSync.current?.updateLocal(current, next);
        return next;
      });
    },
    [activeTab, persist, state],
  );
  const flushPending = useCallback(async () => {
    await Promise.all([sync.current?.flush(), setupSync.current?.flush()]);
  }, []);

  /** Makes `tournamentId` the loaded tournament; its state and Setup form follow from the database. */
  const adoptTournament = useCallback(
    (tournamentId: string) => {
      const cached = auth.canAdmin ? loadLiveEnvelope(window.localStorage, runtime.ids) : null;
      const useCache = cached?.status === 'loaded' && cached.envelope.T.tournamentId === tournamentId;
      const next = useCache ? cached.envelope.T : { ...createDefaultTournamentState(), tournamentId };
      const nextSetup = useCache ? cached.envelope.setup : createDefaultSetup();
      stateRef.current = next;
      setupRef.current = nextSetup;
      setupSync.current?.reset(nextSetup);
      setState(next);
      setSetup(nextSetup);
      persist(next, nextSetup, activeTabRef.current);
    },
    [auth.canAdmin, persist, runtime],
  );

  useEffect(() => {
    if (!hydrated || visitResolved) return;
    if (auth.status === 'checking' || tournaments.status === 'loading') return;
    const urlId = initialUrlId.current;
    const result =
      tournaments.status === 'ready'
        ? resolveVisit({
            urlId,
            summaries: tournaments.summaries,
            env: getTourEnvironment(window.location.hostname),
            nowMs: Date.now(),
            memory: memory.current,
            isAdmin: auth.canAdmin,
          })
        : // The list cannot be read: a link is opened as it is.
          { tournamentId: urlId, tab: urlId ? ('info' as const) : ('tournaments' as const) };
    if ('forgetExited' in result && result.forgetExited) saveExited(window.localStorage, null);
    if (result.tournamentId) adoptTournament(result.tournamentId);
    setActiveTabState(result.tab);
    setVisitNotice('notice' in result ? (result.notice ?? null) : null);
    setVisitResolved(true);
  }, [adoptTournament, auth.canAdmin, auth.status, hydrated, tournaments, visitResolved]);

  const loadTournament = useCallback(
    async (tournamentId: string) => {
      await flushPending();
      adoptTournament(tournamentId);
    },
    [adoptTournament, flushPending],
  );

  const unloadTournament = useCallback(async () => {
    await flushPending();
    const next = createDefaultTournamentState();
    const nextSetup = createDefaultSetup();
    stateRef.current = next;
    setupRef.current = nextSetup;
    setupSync.current?.reset(nextSetup);
    setState(next);
    setSetup(nextSetup);
    persist(next, nextSetup, activeTabRef.current);
  }, [flushPending, persist]);

  const openTournament = useCallback(
    async (summary: TournamentSummary) => {
      await loadTournament(summary.id);
      setActiveTabState(landingTab(tournamentPhase(summary, Date.now())));
    },
    [loadTournament],
  );

  const exitTournament = useCallback(async () => {
    const tournamentId = stateRef.current.tournamentId;
    await unloadTournament();
    if (tournamentId) saveExited(window.localStorage, tournamentId);
    setActiveTabState('tournaments');
  }, [unloadTournament]);

  const createTournamentRecord = useCallback(
    async (testRun: boolean) => {
      const tournamentId = runtime.ids.tournamentId();
      try {
        await createTournament({
          data: {
            tournamentId,
            state: { ...createDefaultTournamentState(), tournamentId },
            setup: createDefaultSetup(),
            testRun,
          },
        });
      } catch (error) {
        return errorText(error);
      }
      await loadTournament(tournamentId);
      return null;
    },
    [loadTournament, runtime],
  );

  /** What differs between what the database holds and `next`, as the patch a lifecycle call carries. */
  const patchTowards = useCallback((next: TournamentState) => {
    const stored = sync.current?.storedState();
    return buildTournamentPatch(stored ? withoutServerOwned(stored) : {}, withoutServerOwned(next));
  }, []);

  const startTournamentNow = useCallback(async () => {
    const tournamentId = stateRef.current.tournamentId;
    if (!tournamentId) return 'There is no tournament to start.';
    const started = { ...stateRef.current, curRound: 0 };
    try {
      await startTournament({
        data: { tournamentId, patch: patchTowards(started) ?? { curRound: 0 } },
      });
    } catch (error) {
      return errorText(error);
    }
    // Built from the state as it is now: the server has meanwhile written the date it filled in.
    updateState((current) => ({ ...current, curRound: 0, started: true }));
    return null;
  }, [patchTowards, updateState]);

  const backToDraft = useCallback(async () => {
    const tournamentId = stateRef.current.tournamentId;
    if (!tournamentId) return 'There is no tournament to reset.';
    const reset = resetTournamentState(stateRef.current);
    const patch = patchTowards(reset);
    try {
      await returnTournamentToDraft({ data: { tournamentId, ...(patch ? { patch } : {}) } });
    } catch (error) {
      return errorText(error);
    }
    saveBracketFollow(window.localStorage, null);
    updateState(resetTournamentState);
    return null;
  }, [patchTowards, updateState]);

  const changeStatus = useCallback(
    async (action: StatusAction) => {
      const tournamentId = stateRef.current.tournamentId;
      if (!tournamentId) return 'There is no tournament to change.';
      try {
        // What was just typed (a title, a date) must be in the database before the server checks it.
        await flushPending();
        await STATUS_CALLS[action]({ data: { tournamentId } });
      } catch (error) {
        return errorText(error);
      }
      if (action === 'delete') await unloadTournament();
      return null;
    },
    [flushPending, unloadTournament],
  );

  const unlockAdmin = useCallback(() => {
    setActiveTabState('admin');
  }, []);
  const lockAdmin = useCallback(() => {
    auth.logout();
    void unloadTournament();
    setActiveTabState('tournaments');
  }, [auth, unloadTournament]);

  const value = useMemo<TournamentAppContext>(
    () => ({
      state,
      setup,
      activeTab,
      hydrated,
      unlocked: auth.canAdmin,
      isViewer,
      tournaments,
      visitResolved,
      visitNotice,
      dismissVisitNotice: () => setVisitNotice(null),
      runtime,
      syncStatus,
      setActiveTab,
      updateState,
      updateSetup,
      unlockAdmin,
      lockAdmin,
      loadTournament,
      unloadTournament,
      openTournament,
      exitTournament,
      createTournamentRecord,
      startTournamentNow,
      backToDraft,
      changeStatus,
      readOnly: state.lifecycle?.status === 'finished',
    }),
    [
      activeTab,
      backToDraft,
      changeStatus,
      createTournamentRecord,
      exitTournament,
      hydrated,
      isViewer,
      loadTournament,
      lockAdmin,
      openTournament,
      runtime,
      tournaments,
      visitNotice,
      visitResolved,
      startTournamentNow,
      unloadTournament,
      syncStatus,
      setActiveTab,
      setup,
      state,
      unlockAdmin,
      auth.canAdmin,
      updateSetup,
      updateState,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTournamentApp(): TournamentAppContext {
  const value = useContext(Context);
  if (!value) throw new Error('useTournamentApp requires TournamentProvider.');
  return value;
}
