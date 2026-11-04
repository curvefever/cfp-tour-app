import { getGameFormat } from '../../domain/tournament/formats';
import { groupSwapClears } from '../../domain/tournament/group-swap';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';

const labelOf = (state: TournamentState, name: string) => unitDisplay(state, name).label;

/** "players" or "teams", from the game format. */
export function swapUnitsWord(state: TournamentState): string {
  return (getGameFormat(state.gameFormat)?.unitLabelPlural ?? 'Players').toLowerCase();
}

/** The line under the toggle: what a pick does, and what a swap does not survive. */
export function swapHint(state: TournamentState): string {
  return `Pick two ${swapUnitsWord(state)} of different groups. Generating the schedule again or a roster change draws new groups.`;
}

/** The status beside the toggle while it is on. */
export function swapStatus(state: TournamentState, picked: string | null): string {
  const unit = swapUnitsWord(state).replace(/s$/, '');
  return picked
    ? `${labelOf(state, picked)} picked — now pick a ${unit} of another group.`
    : `Pick the first ${unit}.`;
}

/**
 * What to ask before a swap, or null when it clears nothing: the matches of the round in play that lose their
 * results ("Swapping Finn and Gus clears the Round 1 results of Finn v Eve and Gus v Hal. Swap?").
 */
export function swapConfirmText(state: TournamentState, first: string, second: string): string | null {
  const cleared = groupSwapClears(state, first, second);
  if (!cleared.length) return null;
  const matches = cleared
    .map((room) => room.units.map((unit) => labelOf(state, unit)).join(' v '))
    .join(' and ');
  const roundNum = state.rounds[state.curRound]?.roundNum ?? state.curRound + 1;
  return `Swapping ${labelOf(state, first)} and ${labelOf(state, second)} clears the Round ${roundNum} results of ${matches}. Swap?`;
}
