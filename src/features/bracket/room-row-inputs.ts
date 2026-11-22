import { bestPlaceChoice } from '../../domain/tournament/best-place';
import { isWinsRound, roomMatch, unneededGames } from '../../domain/tournament/match-format';
import { getUnitScore, getUnitScoreForGame } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/** The units named lucky losers of the round that follows `roundIndex` (known once that round is advanced); in a Custom bracket round with a best of a place, the units that place sends on. */
export function luckyLoserNames(state: TournamentState, roundIndex: number): string[] {
  const round = state.rounds[roundIndex];
  if (round.waterfallBest) return bestPlaceChoice(state, roundIndex)?.chosen ?? [];
  return state.luckyLosers[round.winnersTo ?? roundIndex + 1] ?? [];
}

/** What a unit's game boxes add up to: the summed total, or on a Best-of round the games it has won (on a WINS round "1/2": won over needed). */
export function unitScoreSummary(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): { label: 'Total' | 'Wins'; value: number | string | null } {
  const match = roomMatch(state, roundIndex, room);
  if (match) {
    const unit = match.units[position];
    const wins = unit?.wins ?? 0;
    return {
      label: 'Wins',
      value: isWinsRound(state.rounds[roundIndex]) && unit ? winsText(wins, unit.needed) : wins,
    };
  }
  return { label: 'Total', value: getUnitScore(state, roundIndex, room, position, 0) };
}

/** "1/2": the games a unit has won over the games it needs, in a WINS round. */
export function winsText(wins: number, needed: number): string {
  return `${wins}/${needed}`;
}

/** The wins box of a WINS round's unit: "1/2" and its title "1 of 2 wins needed". Null outside a WINS round. */
export function winsBox(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): { text: string; title: string } | null {
  if (!isWinsRound(state.rounds[roundIndex])) return null;
  const unit = roomMatch(state, roundIndex, room)?.units[position];
  if (!unit) return null;
  return { text: winsText(unit.wins, unit.needed), title: winsBoxTitle(unit.wins, unit.needed) };
}

/** "1 of 2 wins needed". */
export function winsBoxTitle(wins: number, needed: number): string {
  return `${wins} of ${needed} wins needed`;
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

/** One unit's score in each game of its room: null for a game not typed yet or not needed (a decided Best of). Empty for a single game. */
export function roomGameScores(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): Array<number | null> {
  const games = state.rounds[roundIndex]?.numGames ?? 1;
  if (games <= 1) return [];
  const notNeeded = unneededGames(state, roundIndex, room);
  return Array.from({ length: games }, (_, index) =>
    notNeeded.includes(index + 1)
      ? null
      : getUnitScoreForGame(state, roundIndex, room, position, index + 1, null),
  );
}
