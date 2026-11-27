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
import { resetTournamentState } from '../../domain/tournament/tournament-resets';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { createTournamentRuntime, type TournamentRuntime } from '../../domain/tournament/runtime';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { loadLiveEnvelope, saveBracketFollow, saveExited } from '../../lib/persistence/storage';
import { useAuth } from '../auth/AuthProvider';
import { displayAccess } from './display-access';
import { useFlushAfterSignInAgain } from '../auth/useFlushAfterSignInAgain';
import { getTourEnvironment } from '../sync/firebase-paths';
import { withoutServerOwned, type SyncStatus } from '../sync/live-sync';
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
import type { TournamentSummary } from '../tournaments/tournament-summary';
import { useTournamentIndex, type TournamentIndexState } from '../tournaments/useTournamentIndex';
import { landingTab, resolveVisit } from '../tournaments/visit';
import { loadedPhase } from '../shell/tabs';
import { useAddressBar } from './useAddressBar';
import { useBrowserSave } from './useBrowserSave';
import { useStoreUpdates } from './useStoreUpdates';
import { useTournamentSync } from './useTournamentSync';
import { useTournamentStore } from './useTournamentStore';
import { useVisitMemory } from './useVisitMemory';

export interface TournamentAppContext {
  state: TournamentState;
  setup: PersistedSetup;
  activeTab: ActiveTab;
  hydrated: boolean;
  /** What the screens read as an admin: false while an admin looks at the spectator view. */
  unlocked: boolean;
  /** What the screens read as a viewer: true while an admin looks at the spectator view. */
  isViewer: boolean;
  /** An admin is looking at the pages as a viewer sees them (display only: sync and saving stay the admin's). */
  spectating: boolean;
  setSpectating(on: boolean): void;
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

export const TournamentContext = createContext<TournamentAppContext | null>(null);

export function TournamentProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const runtime = useMemo(() => createTournamentRuntime(), []);
  const [visitResolved, setVisitResolved] = useState(false);
  const [visitNotice, setVisitNotice] = useState<string | null>(null);
  const tournaments = useTournamentIndex();
  const tournamentsRef = useRef(tournaments);
  tournamentsRef.current = tournaments;
  const { hydrated, initialUrlId, memory } = useVisitMemory();
  const { state, setState, setup, setSetup, activeTab, setActiveTabState, stateRef, setupRef, activeTabRef } =
    useTournamentStore();
  // The sign-in decides saving and sync; the display reads `access`, which the spectator view can turn into a viewer's.
  const signedInViewer = !auth.canAdmin;
  const [spectatorView, setSpectatorView] = useState(false);
  const access = displayAccess(auth.canAdmin, spectatorView);
  const { persist, isViewerRef } = useBrowserSave(signedInViewer);

  const { syncStatus, sync, setupSync, flushPending } = useTournamentSync({
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
  });
  useAddressBar(hydrated, visitResolved, state, activeTab);
  const { setActiveTab, updateState, updateSetup } = useStoreUpdates({
    setActiveTabState,
    setState,
    setSetup,
    persist,
    state,
    setup,
    activeTab,
    sync,
    setupSync,
  });

  // Signing in again after an expired session sends what the tab kept meanwhile, without another keystroke.
  useFlushAfterSignInAgain(auth.sessionExpired, auth.canAdmin, () => void flushPending());

  /** Makes `tournamentId` the loaded tournament; its state and Setup form follow from the database. */
  const adoptTournament = useCallback(
    (tournamentId: string) => {
      // Already loaded: its subscription is live, and a blank state would never be filled again.
      if (stateRef.current.tournamentId === tournamentId) return;
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
    const { tournamentId } = stateRef.current;
    const phase = loadedPhase({
      state: stateRef.current,
      summary: tournamentsRef.current.summaries.find((entry) => entry.id === tournamentId),
      stateReceived: true,
      nowMs: Date.now(),
    });
    await unloadTournament();
    if (tournamentId && phase) saveExited(window.localStorage, { tournamentId, phase });
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

  // Only a signed-in admin can look at the spectator view, and signing out ends it.
  const setSpectating = useCallback((on: boolean) => setSpectatorView(auth.canAdmin && on), [auth.canAdmin]);
  useEffect(() => {
    if (!auth.canAdmin) setSpectatorView(false);
  }, [auth.canAdmin]);

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
      unlocked: access.unlocked,
      isViewer: access.isViewer,
      spectating: access.spectating,
      setSpectating,
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
      access.isViewer,
      access.spectating,
      access.unlocked,
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
      setSpectating,
      updateSetup,
      updateState,
    ],
  );
  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}

export function useTournamentApp(): TournamentAppContext {
  const value = useContext(TournamentContext);
  if (!value) throw new Error('useTournamentApp requires TournamentProvider.');
  return value;
}
