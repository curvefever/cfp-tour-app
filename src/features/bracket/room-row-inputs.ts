import { getAllTies, isTieResolved } from '../../domain/tournament/advancement';
import type { TournamentState } from '../../domain/tournament/types';

/** The units named lucky losers of the round that follows `roundIndex` (known once that round is advanced). */
export function luckyLoserNames(state: TournamentState, roundIndex: number): string[] {
  const round = state.rounds[roundIndex];
  return state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
}

/** The units in a tie of the round (in a room or at the cut) that the organiser has not resolved yet. */
export function pendingTieNames(state: TournamentState, roundIndex: number): Set<string> {
  return new Set(
    Object.entries(getAllTies(state, roundIndex))
      .filter(([key, tie]) => !isTieResolved(key, tie, state))
      .flatMap(([, tie]) => tie.players.map((entry) => entry.name)),
  );
}
