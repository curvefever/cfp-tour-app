import { roomMatch } from '../../domain/tournament/match-format';
import { getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/** The units named lucky losers of the round that follows `roundIndex` (known once that round is advanced). */
export function luckyLoserNames(state: TournamentState, roundIndex: number): string[] {
  const round = state.rounds[roundIndex];
  return state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
}

/** What a unit's game boxes add up to: the summed total, or on a Best-of round the games it has won. */
export function unitScoreSummary(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): { label: 'Total' | 'Wins'; value: number | null } {
  const match = roomMatch(state, roundIndex, room);
  if (match) return { label: 'Wins', value: match.units[position]?.wins ?? 0 };
  return { label: 'Total', value: getUnitScore(state, roundIndex, room, position, 0) };
}

/** The games a Best-of unit has won so far; null outside a Best-of room and before any game counts. */
export function winsSoFar(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): number | null {
  const match = roomMatch(state, roundIndex, room);
  return match && match.countedGames > 0 ? (match.units[position]?.wins ?? null) : null;
}
