import { computeGroupStandings, orderedGroupExit, orderedQualificationTable } from './advancement';
import { routeStandings, routeWaterfallRound } from './bracket-replay';
import {
  cloneForTransition,
  fitWaterfallRoundAt,
  mergeAdditions,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
} from './round-advance-tools';
import { currentColumn, roundColumn } from './round-columns';
import type { PendingBracketSeed, TournamentRound, TournamentStanding, TournamentState } from './types';

/**
 * Next Round into a Custom bracket's next column: from a column played (a tournament played by columns) or from a
 * pooling exit through the standings routes; and the look ahead that draws one round early. Dependency play is in
 * `waterfall-steps.ts`.
 */

function standingsPhaseOf(round: TournamentRound): 'groups' | 'swiss' | 'qualification' {
  if (round.isGroupStage) return 'groups';
  return round.isSwiss ? 'swiss' : 'qualification';
}

function standingsShortfallMessage(
  ranked: number,
  highestRoutedRank: number,
  phase: 'groups' | 'swiss' | 'qualification',
): string {
  if (phase === 'groups') {
    return `Can't advance -- the group stage sends ${ranked} unit(s) on, but the custom bracket graph routes group exit ranks up to ${highestRoutedRank}. A withdrawal during the groups has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
  }
  if (phase === 'swiss') {
    return `Can't advance -- the Swiss standings rank ${ranked} unit(s), but the custom bracket graph routes Swiss ranks up to ${highestRoutedRank}. A withdrawal during the Swiss has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
  }
  return `Can't advance -- the qualification table ranks ${ranked} unit(s), but the custom bracket graph routes qualification ranks up to ${highestRoutedRank}. A withdrawal during qualification has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
}

/**
 * Folds the finished round's (or column's) per-destination additions into pendingBracketSeeds
 * (the destination-indexed accumulator advanceDoubleElimination already uses,
 * generalized from 2 named destinations to N), then draws the next column: every
 * round after `lastRoundIndex` that shares the first one's column (a round with no
 * stored column is a column of its own). Always finalizes that column specifically
 * -- NOT whatever a band's own destination is, which may be several columns ahead
 * and stay merely pending until curRound actually reaches it. This is safe because
 * the graph is a validated DAG played in column order: every source of a round in
 * column N is in an earlier column, so its pool is always complete by the time its
 * column is entered here. If any round of the column can't be drawn, the input state
 * is returned unchanged.
 */
function enterNextWaterfallColumn(
  input: TournamentState,
  state: TournamentState,
  lastRoundIndex: number,
  additionsByDestination: Map<number, PendingBracketSeed[]>,
): RoundAdvanceResult {
  for (const [destination, additions] of additionsByDestination) {
    state.pendingBracketSeeds[destination] = [
      ...(state.pendingBracketSeeds[destination] ?? []),
      ...additions,
    ];
  }

  const { start, end } = roundColumn(state.rounds, lastRoundIndex + 1);
  for (let index = start; index <= end; index += 1) {
    const shapeFailure = fitWaterfallRoundAt(state, index, (state.pendingBracketSeeds[index] ?? []).length);
    if (shapeFailure) return { status: 'blocked', ...shapeFailure, state: input };
  }

  state.curRound = start;
  for (let index = start; index <= end; index += 1) {
    const fitFailure = seedRoundFromPendingPool(state, index);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  }
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

/**
 * Waterfall's advance step: route every finished round of the current column
 * (routeWaterfallRound), then enter the next column.
 */
export function advanceWaterfallBracket(input: TournamentState): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { start, end } = currentColumn(input);
  const parts: Array<Map<number, PendingBracketSeed[]>> = [];
  for (let index = start; index <= end; index += 1) {
    parts.push(routeWaterfallRound(state, index, state.rounds[index]));
  }
  return enterNextWaterfallColumn(input, state, end, mergeAdditions(parts));
}

/**
 * A copy of the state with one undrawn Custom bracket round drawn, from the units already waiting for it plus
 * what `feeders` (finished rounds of the column in play) send it; null when that round can't be drawn. For a
 * look ahead only: the input isn't changed and `curRound` stays where it is.
 */
export function drawWaterfallRoundAhead(
  input: TournamentState,
  roundIndex: number,
  feeders: number[],
): TournamentState | null {
  const state = cloneForTransition(input);
  const additions = mergeAdditions(
    feeders.map((index) => routeWaterfallRound(state, index, state.rounds[index])),
  );
  const arriving = [...(state.pendingBracketSeeds[roundIndex] ?? []), ...(additions.get(roundIndex) ?? [])];
  state.pendingBracketSeeds[roundIndex] = arriving;
  if (fitWaterfallRoundAt(state, roundIndex, arriving.length)) return null;
  return seedRoundFromPendingPool(state, roundIndex) ? null : state;
}

/**
 * The units a pooling exit sends through the standings routing, best first: the group exit order (a group stage,
 * its band-tie picks applied) or the qualification table (every cut-off tie pick applied). Sets the table the exit
 * was read from on `state`.
 */
function standingsExitOf(state: TournamentState, round: TournamentRound): TournamentStanding[] {
  if (round.isGroupStage) {
    state.groupStandings = computeGroupStandings(state);
    return orderedGroupExit(state, state.groupStandings);
  }
  const { qualTable, ordered } = orderedQualificationTable(state);
  state.qualTable = qualTable;
  return ordered;
}

/**
 * The pooling exit of a waterfall graph with a Qual or Groups source: the
 * ordered qualification table (or group exit order) is routed through the last
 * pooling round's `standingsRoutes`. It does not go through
 * roomBasedComputeAdvancement's `advancing` list (that is the top `qualAdv`
 * names, which includes ranks the graph eliminates inside its range) and has
 * no bye or tieredSeed step: the waterfall has no byes, and every destination
 * is drawn from its pool.
 */
export function advanceFromStandings(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const ordered = standingsExitOf(state, round);
  const highestRoutedRank = round.standingsRoutes?.length ?? 0;
  if (ordered.length < highestRoutedRank) {
    return {
      status: 'blocked',
      reason: 'too-few-units',
      message: standingsShortfallMessage(ordered.length, highestRoutedRank, standingsPhaseOf(round)),
      state: input,
    };
  }
  state.rounds[roundIndex] = {
    ...round,
    standingsExitOrder: ordered.map((standing) => ({
      name: standing.name,
      roomShare: standing.roomShare ?? 0,
    })),
  };
  return enterNextWaterfallColumn(input, state, roundIndex, routeStandings(ordered, round, roundIndex));
}
