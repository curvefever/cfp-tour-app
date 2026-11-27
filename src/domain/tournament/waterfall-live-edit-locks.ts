import {
  isRoundDone,
  isRoundReached,
  reopenedRounds,
  roundColumn,
  currentColumn,
  usesDependencyPlay,
} from './round-columns';
import { matchFormatFields, sameRoundFormat } from './match-format';
import { plainRoundName } from './round-name';
import { routesTo } from './waterfall-steps';
import type { OrderedWaterfallGraph, TournamentRound, TournamentState } from './types';
import { declaredWaterfallRooms } from './waterfall-bracket';

/**
 * What a save of an edited waterfall graph may not change once the bracket has started: which rounds count as
 * started, the shape and match format of those rounds, the uneven wins of a drawn round, and a drawn round fed by a
 * round that is not done.
 */

/** A drawn round keeps the targets its units were stamped with: its sources are done, so a save can't ask for other ones. */
export function winsTargetsRefusal(round: TournamentRound): string {
  return `Can't save: "${round.customLabel}" has already been drawn, so its uneven wins can't change.`;
}

/** The rounds a save treats as already started. `drawn` are drawn (they keep their round and draw); `fixed` also holds the undrawn rounds of a column that has started, whose label and column stay. */
interface StartedRounds {
  drawn: number;
  fixed: number;
}

/**
 * Which rounds of the bracket have started. Column play: the column in play and every one before it, whole. Dependency
 * play: the drawn rounds are a prefix of the bracket's rounds in the common shape, and a column with any drawn round
 * counts whole. Other shapes, and a reopened press, are refused: the save can't tell which draws its replay would keep.
 */
export function startedRounds(
  state: TournamentState,
  firstWaterfallIndex: number,
): StartedRounds | { error: string } {
  if (!usesDependencyPlay(state)) {
    const count =
      state.curRound < firstWaterfallIndex ? 0 : currentColumn(state).end - firstWaterfallIndex + 1;
    return { drawn: count, fixed: count };
  }
  const label = (index: number) => plainRoundName(state.rounds[index]);
  const reopened = reopenedRounds(state);
  if (reopened.length > 0) {
    const names = reopened.map((index) => `"${label(index)}"`).join(', ');
    return {
      error: `Can't save while ${names} ${reopened.length > 1 ? 'are' : 'is'} reopened with Previous: press Next Round to send ${reopened.length > 1 ? 'them' : 'it'} on again first.`,
    };
  }
  const bracket = state.rounds.map((_, index) => index).filter((index) => index >= firstWaterfallIndex);
  const reached = bracket.filter((index) => isRoundReached(state, index));
  const gap = bracket.find((index, offset) => offset < reached.length && !isRoundReached(state, index));
  if (gap !== undefined) {
    const later = reached.find((index) => index > gap) as number;
    return {
      error: `Can't save yet: "${label(gap)}" has not been drawn, but "${label(later)}" has. Play on until "${label(gap)}" is drawn, then save the graph.`,
    };
  }
  const last = firstWaterfallIndex + reached.length - 1;
  return {
    drawn: reached.length,
    fixed: roundColumn(state.rounds, last).end - firstWaterfallIndex + 1,
  };
}

/** A drawn round can't take units from a round that is not done: its draw would be missing them. Null when it doesn't. */
export function lateFeederRefusal(
  state: TournamentState,
  rounds: TournamentRound[],
  firstWaterfallIndex: number,
  drawn: number,
): string | null {
  for (let index = firstWaterfallIndex; index < firstWaterfallIndex + drawn; index += 1) {
    const source = rounds.findIndex(
      (round, candidate) => routesTo(round, index) && !isRoundDone(state, candidate),
    );
    if (source !== -1) {
      return `Can't save: "${plainRoundName(rounds[source])}" is not done yet, so it can't feed "${plainRoundName(rounds[index])}", which is already drawn.`;
    }
  }
  return null;
}

/**
 * Locked shape: a reached round keeps its label, room count, room size and
 * Final flag -- the fixedPrefix readEditedGraph validates against already
 * forces graph.rounds[0..reached.length) to be these rounds in order, so
 * this only needs to compare shape, not identity.
 * Null when every reached round is kept as it must be.
 */
export function lockedShapeRefusal({
  state,
  reached,
  graph,
  firstWaterfallIndex,
  finalsGames,
  finalsBestOf,
}: {
  state: TournamentState;
  reached: TournamentRound[];
  graph: OrderedWaterfallGraph;
  firstWaterfallIndex: number;
  finalsGames: number;
  finalsBestOf: number | undefined;
}): string | null {
  for (const [index, oldRound] of reached.entries()) {
    const spec = graph.rounds[index];
    // A round drawn short (a withdrawal) is compared by the shape the graph declared for it.
    const declaredRooms = declaredWaterfallRooms(oldRound);
    const sameShape =
      spec &&
      spec.label === oldRound.customLabel &&
      spec.roomSizes.length === declaredRooms.length &&
      spec.roomSizes[0] === declaredRooms[0] &&
      spec.isFinal === oldRound.isFinal;
    if (!sameShape) {
      return `Can't save: "${oldRound.customLabel}" has already started, so its room count, room size and Final flag can't change. Only its routing can.`;
    }
    // The round in play may change its match format (its scores are read again under the new one); a finished one may not.
    if (
      isRoundDone(state, firstWaterfallIndex + index) &&
      !sameRoundFormat(oldRound, matchFormatFields(spec, finalsGames, finalsBestOf))
    ) {
      return `Can't save: "${oldRound.customLabel}" is finished, so its match format can't change.`;
    }
  }
  return null;
}
