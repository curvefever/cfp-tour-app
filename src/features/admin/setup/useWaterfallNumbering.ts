import { useCallback, useEffect, useRef, useState } from 'react';
import { infoWithRenamedRounds } from '../../../domain/tournament/round-notes';
import { rosterKeys } from '../../../domain/tournament/roster';
import { createDefaultInfo } from '../../../domain/tournament/state-defaults';
import {
  renumberWaterfallDefaults,
  waterfallFirstRoundNumber,
  withWaterfallNumbering,
} from '../../../domain/tournament/waterfall-numbering';
import { renameNotePictureRounds } from '../../tournaments/note-pictures.server-fns';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { errorText } from '../image-upload';

/** A round renamed in the graph editor by hand. */
export interface RoundRenamed {
  from: string;
  to: string;
}

export interface WaterfallNumbering {
  /** The number a new round's default name starts from: the one after the pooling rounds played before the bracket. */
  firstRoundNumber: number;
  /** Why the pictures of renamed rounds could not be moved, '' when nothing failed. */
  pictureError: string;
  /** Writes the graph text; a round renamed by hand takes its notes and pictures along, and a graph with default names is marked as numbered. */
  changeGraph: (text: string, renamed?: RoundRenamed) => void;
  /** Moves the settings pictures of renamed rounds on the server; the error text, '' when it went well or there was nothing to move. */
  movePictures: (renames: ReadonlyMap<string, string>) => Promise<string>;
}

/**
 * The Setup's numbering of a Custom bracket's default round names ("Round 4"): the rounds are named on from the
 * pooling rounds played before the bracket. When those change (the rounds override, the pooling phase, a group
 * stage's round count with the roster) the names that are still defaults are renumbered, once, with their notes and
 * pictures; a round renamed by hand carries them too. Only before the start: a running tournament never renumbers.
 */
export function useWaterfallNumbering(): WaterfallNumbering {
  const { state, setup, updateSetup, updateState } = useTournamentApp();
  const [pictureError, setPictureError] = useState('');
  const handled = useRef('');
  const tournamentId = state.tournamentId;
  // The units on the roster, the count generation seats (a team format counts teams, not players).
  const entrantCount = rosterKeys(state.players).length;
  const firstRoundNumber = waterfallFirstRoundNumber(setup, entrantCount);

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

  useEffect(() => {
    if (state.started) return;
    const result = renumberWaterfallDefaults(setup, entrantCount);
    if (!result) return;
    // One renumbering per graph and numbering: a second pass over the same one would shift the notes twice.
    const key = `${setup.waterfallNumberedFrom}>${result.numberedFrom}:${setup.waterfallGraph}`;
    if (handled.current === key) return;
    handled.current = key;
    updateSetup((current) => ({
      ...current,
      waterfallGraph: result.graph,
      waterfallNumberedFrom: result.numberedFrom,
    }));
    carry(result.renames);
  }, [state.started, setup, entrantCount, updateSetup, carry]);

  const changeGraph = useCallback(
    (text: string, renamed?: RoundRenamed) => {
      updateSetup((current) => withWaterfallNumbering({ ...current, waterfallGraph: text }, entrantCount));
      if (renamed && renamed.from !== renamed.to) carry(new Map([[renamed.from, renamed.to]]));
    },
    [carry, entrantCount, updateSetup],
  );

  return { firstRoundNumber, pictureError, changeGraph, movePictures };
}
