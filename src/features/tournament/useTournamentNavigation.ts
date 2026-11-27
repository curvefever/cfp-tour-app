import { useCallback, useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { TournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { ActiveTab, PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { loadLiveEnvelope, saveExited } from '../../lib/persistence/storage';
import type { useAuth } from '../auth/AuthProvider';
import { loadedPhase } from '../shell/tabs';
import { getTourEnvironment } from '../sync/firebase-paths';
import type { SetupSync } from '../sync/setup-sync';
import { createTournament } from '../tournaments/tournament-lifecycle.server-fns';
import { tournamentPhase } from '../tournaments/tournament-lifecycle';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import type { TournamentIndexState } from '../tournaments/useTournamentIndex';
import { landingTab, resolveVisit } from '../tournaments/visit';
import { errorText } from './error-text';
import type { useBrowserSave } from './useBrowserSave';
import type { useVisitMemory } from './useVisitMemory';

/**
 * Which tournament is loaded: the first visit of the page, then loading, opening, leaving and creating one. Each way of
 * loading ends in `adoptTournament`.
 */
export function useTournamentNavigation({
  auth,
  runtime,
  hydrated,
  visitResolved,
  setVisitResolved,
  setVisitNotice,
  initialUrlId,
  memory,
  tournaments,
  tournamentsRef,
  flushPending,
  persist,
  stateRef,
  setupRef,
  activeTabRef,
  setState,
  setSetup,
  setActiveTabState,
  setupSync,
}: {
  auth: ReturnType<typeof useAuth>;
  runtime: TournamentRuntime;
  hydrated: boolean;
  visitResolved: boolean;
  setVisitResolved: Dispatch<SetStateAction<boolean>>;
  setVisitNotice: Dispatch<SetStateAction<string | null>>;
  initialUrlId: ReturnType<typeof useVisitMemory>['initialUrlId'];
  memory: ReturnType<typeof useVisitMemory>['memory'];
  tournaments: TournamentIndexState;
  tournamentsRef: RefObject<TournamentIndexState>;
  flushPending: () => Promise<void>;
  persist: ReturnType<typeof useBrowserSave>['persist'];
  stateRef: RefObject<TournamentState>;
  setupRef: RefObject<PersistedSetup>;
  activeTabRef: RefObject<ActiveTab>;
  setState: Dispatch<SetStateAction<TournamentState>>;
  setSetup: Dispatch<SetStateAction<PersistedSetup>>;
  setActiveTabState: Dispatch<SetStateAction<ActiveTab>>;
  setupSync: RefObject<SetupSync | null>;
}) {
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

  return { loadTournament, unloadTournament, openTournament, exitTournament, createTournamentRecord };
}
