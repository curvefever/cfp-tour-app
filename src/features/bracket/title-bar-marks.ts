import { isCurrentRound } from '../../domain/tournament/round-columns';
import { roundSettingsByRound } from '../../domain/tournament/round-notes';
import type { TournamentState } from '../../domain/tournament/types';
import { type RoomsScored, roomsScored } from './still-playing';

/** NOW marks the rounds of the column in play, from Confirm & Start until the Final is complete (`isFinalComplete`). */
export function showsNowPill(state: TournamentState, roundIndex: number, finalComplete: boolean): boolean {
  return state.started && isCurrentRound(state, roundIndex) && !finalComplete;
}

/** A pooling round played for seeding only (`excludeFromStandings`): its title bar says NOT COUNTED. */
export function isNotCountedRound(state: TournamentState, roundIndex: number): boolean {
  return Boolean(state.rounds[roundIndex]?.excludeFromStandings);
}

/**
 * The admin's rooms-scored tracker for a round's title bar: only where the Bracket is editable, on a round of the
 * column in play, and never on the Final or the race Grand Final (one room over several games); null otherwise.
 */
export function roundProgress(
  state: TournamentState,
  roundIndex: number,
  editable: boolean,
): RoomsScored | null {
  const round = state.rounds[roundIndex];
  if (
    !editable ||
    !round ||
    !isCurrentRound(state, roundIndex) ||
    round.isFinal ||
    round.bracket === 'grand-final'
  )
    return null;
  return roomsScored(state, roundIndex);
}

/** Whether any round of the tournament has settings (a note, a game note or a picture): the Bracket then shows bands, or none at all. */
export function hasRoundNotes(state: TournamentState): boolean {
  return roundSettingsByRound(state).some((settings) => settings !== null);
}
