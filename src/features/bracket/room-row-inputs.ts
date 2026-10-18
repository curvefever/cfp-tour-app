import type { TournamentState } from '../../domain/tournament/types';

/** The units named lucky losers of the round that follows `roundIndex` (known once that round is advanced). */
export function luckyLoserNames(state: TournamentState, roundIndex: number): string[] {
  const round = state.rounds[roundIndex];
  return state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
}
