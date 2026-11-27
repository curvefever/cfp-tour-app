import { currentUnit, replayBracketPools, sameNames } from './bracket-replay';
import { currentColumn, isRoundDone, isRoundReached, usesDependencyPlay } from './round-columns';
import { discardRoundDraws } from './redraw';
import { rosterKeys } from './roster';
import { roundHasAnyScore } from './scoring';
import { seedRoundFromPendingPool } from './round-advance-tools';
import type { PendingBracketSeed, TournamentState } from './types';
import { fitWaterfallRound } from './waterfall-bracket';
import type { WaterfallParseResult } from './waterfall-parse-result';

/**
 * The replay of the advances a save of an edited waterfall graph repeats under the new routing: which line-ups it
 * changes, the pools it leaves for the rounds not drawn, and the re-draw of the rounds in play whose line-up changed.
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
function advancesReplayed(state: TournamentState): number | ReadonlySet<number> {
  if (!usesDependencyPlay(state)) return currentColumn(state).start;
  return new Set(state.rounds.flatMap((_, index) => (isRoundDone(state, index) ? [index] : [])));
}

/** The replayed pools, and the rounds in play to draw again from them; or why a changed line-up can't be saved. */
export function changedLineUps({
  state,
  working,
  firstWaterfallIndex,
  standingsSource,
  keptLength,
}: {
  state: TournamentState;
  working: TournamentState;
  firstWaterfallIndex: number;
  standingsSource: boolean;
  keptLength: number;
}): WaterfallParseResult<{ redrawn: number[]; replayPools: Map<number, PendingBracketSeed[]> }> {
  // Replay every advance of the rounds done (in column play: every round before the current column) under the new
  // routing, accumulating per-destination pools exactly as advanceTournamentRound would across a
  // sequence of real advances. Recorded line-ups still hold the units that withdrew or were swapped
  // out: a replayed pool keeps only the units now in the tournament (a swapped-out unit becomes its
  // replacement), so a withdrawal never moves anyone else up into the empty seat.
  const roster = new Set(rosterKeys(state.players));
  const { pools: replayPools } = replayBracketPools(working, advancesReplayed(state));

  // Compare every reached round against what the new routing would have
  // produced -- except, without a Qual source, the entry round (which has no
  // inbound routes, so its line-up can never change).
  const redrawn: number[] = [];
  for (let index = firstWaterfallIndex + (standingsSource ? 0 : 1); index < keptLength; index += 1) {
    const round = working.rounds[index];
    const lineUp = (working.assignments[index] ?? []).flatMap((entry) => {
      const name = currentUnit(state, roster, entry.name);
      return name === null ? [] : [name];
    });
    const replayed = (replayPools.get(index) ?? []).map((seed) => seed.name);
    // As a set: a name a list repeats counts once.
    if (sameNames([...new Set(lineUp)], [...new Set(replayed)])) continue;
    if (isRoundDone(state, index)) {
      return {
        ok: false,
        error: `Can't save: "${round.customLabel}" has already been played with a different line-up. Undo the routing change that feeds it, or only edit rounds that haven't been played yet.`,
      };
    }
    if (roundHasAnyScore(state, index, state.rounds[index])) {
      return {
        ok: false,
        error: `Can't save: a score has already been entered in "${round.customLabel}", so its rooms can't be re-drawn. Undo the routing change that feeds it, or wait until the round is complete.`,
      };
    }
    redrawn.push(index);
  }
  return { ok: true, value: { redrawn, replayPools } };
}

/** The tournament with the replayed pools as the ones waiting for every round not drawn. */
export function withReplayedPools(
  state: TournamentState,
  working: TournamentState,
  firstWaterfallIndex: number,
  replayPools: Map<number, PendingBracketSeed[]>,
): TournamentState {
  // Old pending pools keyed by an index that fell in the old waterfall
  // range but past the current column belong to rounds that no longer exist at that
  // index (the edit may have added, removed or reordered unreached rounds)
  // -- drop them and replace with the freshly replayed pools.
  const oldBracketLength = state.rounds.length - firstWaterfallIndex;
  const nextPending: Record<string, PendingBracketSeed[]> = {};
  for (const [key, seeds] of Object.entries(working.pendingBracketSeeds)) {
    const index = Number(key);
    const wasOldUnreachedWaterfallIndex =
      index >= firstWaterfallIndex &&
      index < firstWaterfallIndex + oldBracketLength &&
      !isRoundReached(state, index);
    if (wasOldUnreachedWaterfallIndex) continue;
    nextPending[key] = seeds;
  }
  for (const [destination, seeds] of replayPools) {
    if (!isRoundReached(state, destination)) nextPending[destination] = seeds;
  }
  return { ...working, pendingBracketSeeds: nextPending };
}
