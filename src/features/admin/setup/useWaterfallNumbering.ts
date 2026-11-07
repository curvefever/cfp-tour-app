import { createContext, useCallback, useContext, useState } from 'react';
import { infoWithRenamedRounds } from '../../../domain/tournament/round-notes';
import { rosterKeys } from '../../../domain/tournament/roster';
import { createDefaultInfo } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import {
  isWaterfallNumbered,
  numberingAfterEdit,
  renumberWaterfallDefaults,
  waterfallFirstRoundNumber,
} from '../../../domain/tournament/waterfall-numbering';
import { renameNotePictureRounds } from '../../tournaments/note-pictures.server-fns';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { errorText } from '../image-upload';

/** A round renamed in the graph editor by hand. */
export interface RoundRenamed {
  from: string;
  to: string;
}

type SetupUpdate = PersistedSetup | ((current: PersistedSetup) => PersistedSetup);

export interface WaterfallNumbering {
  /** The number a new round's default name starts from: the one the graph's default names are numbered from, else the one after the pooling rounds played before the bracket. */
  firstRoundNumber: number;
  /** Why the pictures of renamed rounds could not be moved, '' when nothing failed. */
  pictureError: string;
  /** `updateSetup` for an edit of the Setup form made in this tab: it renumbers the default names when the edit moves the first number, and marks a graph whose text it changed. */
  updateSetup: (update: SetupUpdate) => void;
  /** Writes the graph text; a round renamed by hand takes its notes and pictures along. */
  changeGraph: (text: string, renamed?: RoundRenamed) => void;
  /** The roster of `entrantCount` units was just loaded, reloaded or cleared in this tab: a group stage or a Swiss may now play other rounds before the bracket. */
  renumberForRoster: (entrantCount: number) => void;
  /** Moves the settings pictures of renamed rounds on the server; the error text, '' when it went well or there was nothing to move. */
  movePictures: (renames: ReadonlyMap<string, string>) => Promise<string>;
}

/**
 * The Setup's numbering of a Custom bracket's default round names ("Round 4"): the rounds are named on from the
 * pooling rounds played before the bracket. When those change the names that are still defaults are renumbered, once,
 * with their notes and pictures; a round renamed by hand carries them too. Only before the start.
 *
 * Renumbering follows a local action of this tab: an edit of the Setup form (`updateSetup`), a roster load
 * (`renumberForRoster`) or Copy settings. It is never an effect over the Setup the tab observes: another tab's edits
 * reach this one live, field by field, already renumbered, and renumbering them again would move the pictures twice.
 */
export function useWaterfallNumbering(): WaterfallNumbering {
  const { state, setup, updateSetup: applySetup, updateState } = useTournamentApp();
  const [pictureError, setPictureError] = useState('');
  const tournamentId = state.tournamentId;
  // The units on the roster, the count generation seats (a team format counts teams, not players).
  const entrantCount = rosterKeys(state.players).length;
  const computedFirst = waterfallFirstRoundNumber(setup, entrantCount);
  // The graph's own numbering wins: a round added before it catches up is numbered like the rest, then shifted with them.
  const firstRoundNumber = isWaterfallNumbered(setup)
    ? Number.parseInt(setup.waterfallNumberedFrom, 10)
    : computedFirst;

  const movePictures = useCallback(
    async (renames: ReadonlyMap<string, string>): Promise<string> => {
      if (renames.size === 0 || !tournamentId) return '';
      try {
        await renameNotePictureRounds({
          data: { tournamentId, renames: [...renames].map(([from, to]) => ({ from, to })) },
        });
        return '';
      } catch (failure) {
        return errorText(failure);
      }
    },
    [tournamentId],
  );

  /** The notes follow the renamed rounds now; the pictures follow once the server has moved them. */
  const carry = useCallback(
    (renames: ReadonlyMap<string, string>) => {
      if (renames.size === 0) return;
      updateState((current) => ({
        ...current,
        info: infoWithRenamedRounds(current.info ?? createDefaultInfo(), renames),
      }));
      void movePictures(renames).then(setPictureError);
    },
    [movePictures, updateState],
  );

  const updateSetup = useCallback(
    (update: SetupUpdate) => {
      applySetup(update);
      if (state.started) return;
      const next = typeof update === 'function' ? update(setup) : update;
      const edited = numberingAfterEdit(setup, next, entrantCount);
      if (Object.keys(edited.fields).length > 0) applySetup((current) => ({ ...current, ...edited.fields }));
      carry(edited.renames);
    },
    [applySetup, carry, entrantCount, setup, state.started],
  );

  const changeGraph = useCallback(
    (text: string, renamed?: RoundRenamed) => {
      updateSetup((current) => ({ ...current, waterfallGraph: text }));
      if (renamed && renamed.from !== renamed.to) carry(new Map([[renamed.from, renamed.to]]));
    },
    [carry, updateSetup],
  );

  const renumberForRoster = useCallback(
    (count: number) => {
      if (state.started) return;
      const result = renumberWaterfallDefaults(setup, count);
      if (!result) return;
      applySetup((current) => ({
        ...current,
        waterfallGraph: result.graph,
        waterfallNumberedFrom: result.numberedFrom,
      }));
      carry(result.renames);
    },
    [applySetup, carry, setup, state.started],
  );

  return { firstRoundNumber, pictureError, updateSetup, changeGraph, renumberForRoster, movePictures };
}

/** The numbering the Setup view provides to its panels, so every edit of the form goes through it. */
export const WaterfallNumberingContext = createContext<WaterfallNumbering | null>(null);

/** The Setup's numbering; `null` outside the Setup view. */
export function useSetupNumbering(): WaterfallNumbering | null {
  return useContext(WaterfallNumberingContext);
}
