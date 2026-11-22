/**
 * Best of N (`TournamentRound.bestOf`, waterfall rounds): a room plays games until one unit has won
 * (N + 1) / 2 of them. A game is won by the unit with the highest score in it; a top score shared by two or
 * more units is won by nobody. Games are read in order and counting stops at the deciding game, so a score
 * typed after it counts for nothing (and typing the earlier game over re-opens the match): nothing here is stored.
 *
 * A WINS round (`TournamentRound.winTargets`, a Custom bracket round of one room of two) is read the same way, but
 * each unit races to its own number of wins (`RoundAssignment.winsNeeded`): the match is decided as soon as a unit
 * reaches its own target, so the winner can have fewer game wins than the loser.
 *
 * A room is complete once decided, or once every game of the round is used (possible only with drawn games).
 * Units are ordered by wins, then by the total score of the counted games; on a WINS round by the wins still
 * needed (fewest first), then by the total.
 */
import { getFinalUnitScore, getUnitScore, getUnitScoreForGame } from './scoring';
import type { RankScore } from './scoring';
import type {
  RoundAssignment,
  TournamentRound,
  TournamentState,
  WaterfallRoundSpec,
  WinTarget,
} from './types';

/** The N a Best of N can have. */
export const BEST_OF_VALUES = [3, 5, 7, 9];

/** The most games a GAMES token can ask for. */
export const MAX_SUMMED_GAMES = 4;

/** Whether the round is played as a Best of N. */
export function isBestOfRound(
  round: TournamentRound | undefined,
): round is TournamentRound & { bestOf: number } {
  return round?.bestOf !== undefined;
}

/** The fewest and the most game wins a WINS target can be. */
export const MIN_WIN_TARGET = 1;
export const MAX_WIN_TARGET = 9;

/** Whether the round is a WINS round: its two units each race to their own number of game wins. */
export function isWinsRound(
  round: TournamentRound | undefined,
): round is TournamentRound & { winTargets: WinTarget[] } {
  return round?.winTargets !== undefined;
}

/** Whether the round is one match of several games read in order: a Best of N or a WINS round. */
export function isMatchRound(round: TournamentRound | undefined): boolean {
  return isBestOfRound(round) || isWinsRound(round);
}

/** The most games a WINS match can need without a drawn game: both units one win short, then the deciding game. */
export function winsGameCount(first: number, second: number): number {
  return first + second - 1;
}

/** The game wins that decide a Best of N. */
export function winsNeeded(bestOf: number): number {
  return (bestOf + 1) / 2;
}

/** The most games a room of `largestRoomUnits` units can need without a drawn game: everyone one win short, then the deciding game. */
export function bestOfGameCount(bestOf: number, largestRoomUnits: number): number {
  return largestRoomUnits * (winsNeeded(bestOf) - 1) + 1;
}

/** How a round is played, as a setting: `games` summed, or a Best of N when `bestOf` is set (`games` is then only remembered). */
export interface MatchFormat {
  games: number;
  bestOf?: number;
  /** Uneven wins: each of two units needs its own number of wins (the targets are on the graph's bands, not here). `games` is then only remembered. */
  wins?: true;
}

/** How a round is played, as a drawn round stores it: `numGames` is, for a Best of N, the most games its largest room can need. */
export type RoundMatchFields = Pick<TournamentRound, 'bestOf' | 'numGames'>;

/** Whether two settings play the same: the same N, or the same games summed (the games of a Best of N or of a WINS match are only remembered). */
export function sameMatchFormat(first: MatchFormat, second: MatchFormat): boolean {
  return (
    first.bestOf === second.bestOf &&
    first.wins === second.wins &&
    (first.bestOf !== undefined || first.wins === true || first.games === second.games)
  );
}

/** Whether two rounds play the same match format: the same N and game count (a round with no `numGames` plays one game). */
export function sameRoundFormat(first: RoundMatchFields, second: RoundMatchFields): boolean {
  return first.bestOf === second.bestOf && (first.numGames ?? 1) === (second.numGames ?? 1);
}

/** A match format in the words of a ROUNDS line: "BO3" for a Best of 3, "GAMES 2" for two summed games, "WINS" for uneven wins. */
export function matchFormatToken(match: MatchFormat): string {
  if (match.wins) return 'WINS';
  return match.bestOf === undefined ? `GAMES ${match.games}` : `BO${match.bestOf}`;
}

/**
 * The match format a ROUNDS-line token text spells ("BO3", "GAMES 2", "WINS": any of the words in any case), or null
 * when the text is anything else, including a count out of range and a second word.
 */
export function parseMatchFormatToken(text: string): MatchFormat | null {
  const words = text.trim().split(/\s+/);
  const keyword = words[0].toUpperCase();
  if (keyword === 'WINS') return words.length === 1 ? { games: 1, wins: true } : null;
  const bestOf = /^BO(\d*)$/.exec(keyword);
  if (bestOf) {
    const count = Number.parseInt(bestOf[1], 10);
    return words.length === 1 && BEST_OF_VALUES.includes(count) ? { games: 1, bestOf: count } : null;
  }
  if (keyword !== 'GAMES' || words.length !== 2 || !/^\d+$/.test(words[1])) return null;
  const games = Number.parseInt(words[1], 10);
  return games >= 1 && games <= MAX_SUMMED_GAMES ? { games } : null;
}

/** The `numGames` / `bestOf` of a Semis or Final: a Best of N when `bestOf` is set, otherwise `games` summed. */
export function stageMatchFields(
  games: number,
  bestOf: number | undefined,
  largestRoomUnits: number,
): RoundMatchFields {
  if (bestOf === undefined) return { numGames: games };
  return { bestOf, numGames: bestOfGameCount(bestOf, largestRoomUnits) };
}

/** The `numGames` / `bestOf` a round's match format gives it: nothing for the default of one game, the Finals format (a Best of N included) for a Final with no format of its own, the most games its two targets can need for a WINS round. */
export function matchFormatFields(
  roundSpec: WaterfallRoundSpec,
  finalsGames: number,
  finalsBestOf?: number,
): RoundMatchFields {
  if (roundSpec.winTargets) {
    const [first, second] = roundSpec.winTargets;
    return { numGames: winsGameCount(first.wins, second.wins) };
  }
  if (roundSpec.bestOf !== undefined) {
    const largestRoom = Math.max(...roundSpec.roomSizes);
    return { bestOf: roundSpec.bestOf, numGames: bestOfGameCount(roundSpec.bestOf, largestRoom) };
  }
  if (roundSpec.games !== undefined)
    return roundSpec.games > 1 || roundSpec.isFinal ? { numGames: roundSpec.games } : {};
  return roundSpec.isFinal
    ? stageMatchFields(finalsGames, finalsBestOf, Math.max(...roundSpec.roomSizes))
    : {};
}

/** One unit of a match room (a Best of N or a WINS round), in seat order. */
interface UnitMatch {
  name: string;
  /** Every game of the round as typed, counted or not. */
  perGame: Array<number | null>;
  wins: number;
  /** The game wins that decide the match for this unit: the same for every unit of a Best of N, its own on a WINS round. */
  needed: number;
  /** The score total of the counted games. */
  total: number;
  /** What ranks the unit in its room, set once the games are read (see `unitRankScore`). */
  rank: RankScore;
}

export interface RoomMatch {
  units: UnitMatch[];
  /** The games read, in order: all scored for every unit, up to the deciding game. */
  countedGames: number;
  /** The game that gave a unit its last needed win, or null while the room is undecided. */
  decidingGame: number | null;
  complete: boolean;
}

/** The wins a unit of the round needs: the round's N, or on a WINS round the unit's own target (the larger one when its seat has none). */
function neededWins(round: TournamentRound, assignment: RoundAssignment): number {
  if (isWinsRound(round)) {
    return assignment.winsNeeded ?? Math.max(...round.winTargets.map((target) => target.wins));
  }
  return winsNeeded(round.bestOf as number);
}

/** The units of the room (of the Final: all its finalists) with each game's score, in seat order. */
function matchUnits(state: TournamentState, roundIndex: number, room: number, numGames: number): UnitMatch[] {
  const round = state.rounds[roundIndex];
  const assignments = (state.assignments[roundIndex] ?? []).filter(
    (entry) => round?.isFinal || entry.room === room,
  );
  return assignments.map((assignment, position) => ({
    name: assignment.name,
    needed: neededWins(round, assignment),
    rank: { score: 0 },
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

/** The most games a match round can need: its `numGames`, or what its N or its two targets give. */
function matchGameCount(round: TournamentRound): number {
  if (round.numGames !== undefined) return round.numGames;
  if (isWinsRound(round)) return winsGameCount(round.winTargets[0].wins, round.winTargets[1].wins);
  return round.bestOf as number;
}

/**
 * What ranks a unit of a match room: on a Best of N its wins, on a WINS round minus the wins it still needs (the
 * unit nearer its own target ranks higher, whatever the targets are); the total score of the counted games breaks a tie.
 */
function matchRank(unit: UnitMatch, unevenWins: boolean): RankScore {
  return { score: unevenWins ? unit.wins - unit.needed : unit.wins, tiebreak: unit.total };
}

/**
 * Where a match room stands. Null outside a Best-of or WINS round. Absentees contend like any unit (their 0 is a
 * stored score and cannot beat a real one); the callers that rank leave them out.
 */
export function roomMatch(state: TournamentState, roundIndex: number, room: number): RoomMatch | null {
  const round = state.rounds[roundIndex];
  if (!isMatchRound(round)) return null;
  const numGames = matchGameCount(round);
  const units = matchUnits(state, roundIndex, room, numGames);
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
    if (units[winner].wins >= units[winner].needed) decidingGame = game;
  }
  const unevenWins = isWinsRound(round);
  for (const unit of units) unit.rank = matchRank(unit, unevenWins);
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
 * What ranks the unit seated at `position` of a room: on a Best-of round its wins, on a WINS round minus the wins it
 * still needs, with the total score as the tiebreak; on any other round its score (every game summed). Null while
 * the unit has no score, and, with no `fallback`, for every unit of a match room until the room is complete (a
 * half-played match is no result).
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
  return unit.rank;
}

/** The games of a room that count: every game, or on a match round those read so far (up to the deciding game). */
export function countedGames(state: TournamentState, roundIndex: number, room: number): number {
  const match = roomMatch(state, roundIndex, room);
  return match ? match.countedGames : (state.rounds[roundIndex]?.numGames ?? 1);
}

/** The games after the deciding game of a match room (or Final): never played, so their score boxes are off. Empty while undecided. */
export function unneededGames(state: TournamentState, roundIndex: number, room: number): number[] {
  const match = roomMatch(state, roundIndex, room);
  const numGames = state.rounds[roundIndex]?.numGames ?? 0;
  if (!match || match.decidingGame === null) return [];
  return Array.from({ length: numGames - match.decidingGame }, (_, index) => match.decidingGame! + 1 + index);
}
