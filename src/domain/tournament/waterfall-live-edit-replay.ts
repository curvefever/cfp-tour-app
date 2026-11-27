import { currentColumn, isRoundDone, usesDependencyPlay } from './round-columns';
import { discardRoundDraws } from './redraw';
import { seedRoundFromPendingPool } from './round-advance-tools';
import type { PendingBracketSeed, TournamentState } from './types';
import { fitWaterfallRound } from './waterfall-bracket';

/**
 * The replay of the advances a save of an edited waterfall graph repeats under the new routing, and the re-draw of
 * the rounds in play whose line-up that changes.
 */

/**
 * Re-draws the rounds of the current column whose line-up the edit changed, from the replayed pools.
 * Each one is cleared first (`discardRoundDraws`: draw, byes, tie resolutions, absences, room history), then drawn
 * again in order. Every index has a line-up when it is given: a round is listed only when its recorded line-up
 * differs from the replayed pool, and a round drawn with nobody has nothing to undo.
 */
export function redrawRounds(
  state: TournamentState,
  indices: number[],
  replayPools: Map<number, PendingBracketSeed[]>,
): { state: TournamentState } | { error: string } {
  // The pool is this caller's step (`discardRoundDraws` leaves it): the replayed one. A Custom bracket round never
  // counts a pooling bye, so the pooling-bye counts `discardRoundDraws` can undo are not touched here.
  let working: TournamentState = {
    ...discardRoundDraws(state, indices),
    pendingBracketSeeds: {
      ...state.pendingBracketSeeds,
      ...Object.fromEntries(indices.map((index) => [index, replayPools.get(index) ?? []])),
    },
  };
  for (const index of indices) {
    // The pool may be short of the round's declared seats (a withdrawal): draw it short, as an advance would.
    const fitted = fitWaterfallRound(working.rounds[index], (replayPools.get(index) ?? []).length);
    if ('error' in fitted) return { error: fitted.error };
    working = {
      ...working,
      rounds: working.rounds.map((round, position) => (position === index ? fitted : round)),
    };
    const failure = seedRoundFromPendingPool(working, index);
    // The pool now fits the round exactly; this is a defensive fallback.
    if (failure) return { error: failure.message };
  }
  return { state: working };
}

/** The advances the replay of a save repeats: the rounds before the column in play, or in dependency play the set of rounds done. */
export function advancesReplayed(state: TournamentState): number | ReadonlySet<number> {
  if (!usesDependencyPlay(state)) return currentColumn(state).start;
  return new Set(state.rounds.flatMap((_, index) => (isRoundDone(state, index) ? [index] : [])));
}
