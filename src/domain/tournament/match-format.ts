/**
 * Best of N (`TournamentRound.bestOf`, waterfall rounds): a room plays games until one unit has won
 * (N + 1) / 2 of them. A game is won by the unit with the highest score in it; a top score shared by two or
 * more units is won by nobody. Games are read in order and counting stops at the deciding game, so a score
 * typed after it counts for nothing (and typing the earlier game over re-opens the match): nothing here is stored.
 *
 * A room is complete once decided, or once every game of the round is used (possible only with drawn games).
 * Units are ordered by wins, then by the total score of the counted games.
 */
import { getFinalUnitScore, getUnitScore, getUnitScoreForGame } from './scoring';
import type { RankScore } from './scoring';
import type { TournamentRound, TournamentState } from './types';

/** Whether the round is played as a Best of N. */
export function isBestOfRound(
  round: TournamentRound | undefined,
): round is TournamentRound & { bestOf: number } {
  return round?.bestOf !== undefined;
}

/** The game wins that decide a Best of N. */
export function winsNeeded(bestOf: number): number {
  return (bestOf + 1) / 2;
}

/** The most games a room of `largestRoomUnits` units can need without a drawn game: everyone one win short, then the deciding game. */
export function bestOfGameCount(bestOf: number, largestRoomUnits: number): number {
  return largestRoomUnits * (winsNeeded(bestOf) - 1) + 1;
}

/** One unit of a Best-of room, in seat order. */
export interface UnitMatch {
  name: string;
  /** Every game of the round as typed, counted or not. */
  perGame: Array<number | null>;
  wins: number;
  /** The score total of the counted games. */
  total: number;
}

export interface RoomMatch {
  units: UnitMatch[];
  /** The games read, in order: all scored for every unit, up to the deciding game. */
  countedGames: number;
  /** The game that gave a unit its last needed win, or null while the room is undecided. */
  decidingGame: number | null;
  complete: boolean;
}

/** The units of the room (of the Final: all its finalists) with each game's score, in seat order. */
function matchUnits(state: TournamentState, roundIndex: number, room: number, numGames: number): UnitMatch[] {
  const round = state.rounds[roundIndex];
  const assignments = (state.assignments[roundIndex] ?? []).filter(
    (entry) => round?.isFinal || entry.room === room,
  );
  return assignments.map((assignment, position) => ({
    name: assignment.name,
    perGame: Array.from({ length: numGames }, (_, index) =>
      round?.isFinal
        ? getFinalUnitScore(state, assignment.name, index + 1, null)
        : getUnitScoreForGame(state, roundIndex, room, position, index + 1, null),
    ),
    wins: 0,
    total: 0,
  }));
}

/** The unit with the one highest score of the game, or null when that top score is shared. */
function gameWinner(scores: number[]): number | null {
  const top = Math.max(...scores);
  const leaders = scores.flatMap((score, index) => (score === top ? [index] : []));
  return leaders.length === 1 ? leaders[0] : null;
}

/**
 * Where a Best-of room stands. Null outside a Best-of round. Absentees contend like any unit (their 0 is a
 * stored score and cannot beat a real one); the callers that rank leave them out.
 */
export function roomMatch(state: TournamentState, roundIndex: number, room: number): RoomMatch | null {
  const round = state.rounds[roundIndex];
  if (!isBestOfRound(round)) return null;
  const numGames = round.numGames ?? round.bestOf;
  const units = matchUnits(state, roundIndex, room, numGames);
  const needed = winsNeeded(round.bestOf);
  let countedGames = 0;
  let decidingGame: number | null = null;
  for (let game = 1; game <= numGames && units.length > 0 && decidingGame === null; game += 1) {
    const scores = units.map((unit) => unit.perGame[game - 1]);
    if (scores.some((score) => score === null)) break;
    const known = scores as number[];
    countedGames = game;
    units.forEach((unit, index) => {
      unit.total += known[index];
    });
    const winner = gameWinner(known);
    if (winner === null) continue;
    units[winner].wins += 1;
    if (units[winner].wins >= needed) decidingGame = game;
  }
  return {
    units,
    countedGames,
    decidingGame,
    complete: units.length > 0 && (decidingGame !== null || countedGames === numGames),
  };
}

/** How many units have the score the match is waiting for: all once it is complete, else those with the game in progress. */
export function scoredUnitCount(match: RoomMatch): number {
  if (match.complete) return match.units.length;
  return match.units.filter((unit) => unit.perGame[match.countedGames] !== null).length;
}

/**
 * What ranks the unit seated at `position` of a room: on a Best-of round its wins, with the total score as the
 * tiebreak; on any other round its score (every game summed). Null while the unit has no score, and, with no
 * `fallback`, for every unit of a Best-of room until the room is complete (a half-played match is no result).
 */
export function unitRankScore(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  fallback: number | null,
): RankScore | null {
  const match = roomMatch(state, roundIndex, room);
  if (!match) {
    const score = getUnitScore(state, roundIndex, room, position, fallback);
    return score === null ? null : { score };
  }
  const unit = match.units[position];
  if (!unit || (fallback === null && !match.complete)) return null;
  return { score: unit.wins, tiebreak: unit.total };
}

/** The games of a room that count: every game, or on a Best-of round those read so far (up to the deciding game). */
export function countedGames(state: TournamentState, roundIndex: number, room: number): number {
  const match = roomMatch(state, roundIndex, room);
  return match ? match.countedGames : (state.rounds[roundIndex]?.numGames ?? 1);
}

/** The games after the deciding game of a Best-of room (or Final): never played, so their score boxes are off. Empty while undecided. */
export function unneededGames(state: TournamentState, roundIndex: number, room: number): number[] {
  const match = roomMatch(state, roundIndex, room);
  const numGames = state.rounds[roundIndex]?.numGames ?? 0;
  if (!match || match.decidingGame === null) return [];
  return Array.from({ length: numGames - match.decidingGame }, (_, index) => match.decidingGame! + 1 + index);
}
