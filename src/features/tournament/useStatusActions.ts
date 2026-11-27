import { useCallback, type RefObject } from 'react';
import { resetTournamentState } from '../../domain/tournament/tournament-resets';
import type { TournamentState } from '../../domain/tournament/types';
import { saveBracketFollow } from '../../lib/persistence/storage';
import { withoutServerOwned, type SyncCoordinator } from '../sync/live-sync';
import { buildTournamentPatch } from '../sync/tournament-patch';
import {
  deleteTournament,
  finishTournament,
  publishTournament,
  reopenTournament,
  returnTournamentToDraft,
  startTournament,
  unpublishTournament,
} from '../tournaments/tournament-lifecycle.server-fns';
import type { TournamentAction } from '../tournaments/tournament-lifecycle';
import { errorText } from './error-text';

/** The loaded tournament's lifecycle as the screens change it: start, send back to draft and the status actions. */

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

export function useStatusActions({
  stateRef,
  sync,
  updateState,
  flushPending,
  unloadTournament,
}: {
  stateRef: RefObject<TournamentState>;
  sync: RefObject<SyncCoordinator | null>;
  updateState: (updater: TournamentState | ((current: TournamentState) => TournamentState)) => void;
  flushPending: () => Promise<void>;
  unloadTournament: () => Promise<void>;
}) {
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

  return { startTournamentNow, backToDraft, changeStatus };
}
