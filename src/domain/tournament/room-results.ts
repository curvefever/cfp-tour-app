import { absentInRoom, playersInPlay } from './absences';
import { matchResultSettings, matchResultsOfRoom, matchResultsWalkover } from './match-results';
import { unitRankScore } from './match-format';
import { usesScaledPoints } from './rule-versions';
import { isCurrentRound, isRoundDone } from './round-columns';
import {
  comparableRoomTotal,
  comparableScore,
  orderRoomByScore,
  orderRoomWithPlaces,
  type RankScore,
  scaledRoomPoints,
  standardPoints,
  standardPointsTable,
} from './scoring';
import type { StandingRoundResult, TournamentRound, TournamentState } from './types';

/** One room's results: who was scored and in what order, the points and room share each unit earns, the unit counts, and the wins taken without a match. */

export interface ScoredUnit {
  name: string;
  score: number;
  /** Ranks units of equal score: the total score of a Best-of round, where `score` is the wins. Absent on every other round. */
  tiebreak?: number;
  /** Players in play for the unit (sum of members, minus those absent or missing); absent means 1. */
  players?: number;
}

/**
 * The units of a room that were present, with their scores: an absentee is left out, so places, ties, points,
 * lucky-loser candidates and the fair cut all see the room as it was really played. Every unit carries its
 * players in play (1 outside a sum-of-members room). On a Best-of round the score is the wins and the tiebreak
 * the total score (`unitRankScore`).
 */
export function scoreRoom(
  state: TournamentState,
  roundIndex: number,
  room: number,
  fallback: number | null,
): ScoredUnit[] {
  const absent = new Set(absentInRoom(state, roundIndex, room));
  return (state.assignments[roundIndex] ?? [])
    .filter((assignment) => assignment.room === room)
    .flatMap((assignment, position) => {
      const rank = unitRankScore(state, roundIndex, room, position, fallback);
      if (rank === null || absent.has(assignment.name)) return [];
      return [{ name: assignment.name, ...rank, players: playersInPlay(state, roundIndex, room, position) }];
    });
}

/** The units the room was really played by, then the absentees: the one order every consumer that ranks or routes the whole room reads. */
export function roomFinishOrder(state: TournamentState, roundIndex: number, room: number): string[] {
  const present = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
  return [...present.map((entry) => entry.name), ...absentInRoom(state, roundIndex, room)];
}

/** One counted round of a unit's standing, plus its relative room share (null for a bye). */
export interface RoundOutcome extends StandingRoundResult {
  share: number | null;
}

/** The tournament's largest room (`roomSize.max`): what 1st place earns under Standard points. */
export function largestRoomSize(state: TournamentState): number {
  return state.gamemodeConfig.roomSize?.max ?? Math.max(0, ...state.rounds.flatMap((round) => round.rooms));
}

/**
 * The points of each place, 1st first, in a counted pooling room of `roomSize` units. With `pointsVersion` 2 it is the
 * Standard table (or the Custom table's first L entries) read at the room's size; without it, the earlier rule:
 * the same list in every room, Standard from the largest room size down to 1, a Custom table whole.
 */
export function roomPointsByPlace(state: TournamentState, roomSize: number): number[] {
  const { scoring, positionalPointsTable } = state.gamemodeConfig;
  const largestRoom = largestRoomSize(state);
  const custom = scoring === 'positional-points';
  if (!usesScaledPoints(state)) {
    return custom
      ? (positionalPointsTable ?? [])
      : Array.from({ length: largestRoom }, (_, index) => standardPoints(index + 1, largestRoom));
  }
  const table = custom ? (positionalPointsTable ?? []) : standardPointsTable(largestRoom);
  return scaledRoomPoints(table, largestRoom, roomSize);
}

/** The points a shared place earns: the average, unrounded, of the points of the `count` places it covers. */
function pointsForSharedPlace(roomPoints: readonly number[], place: number, count: number): number {
  let total = 0;
  for (let offset = 0; offset < count; offset += 1) total += roomPoints[place + offset - 1] ?? 0;
  return total / count;
}

/**
 * One round's share relative to its room's average: score ÷ room total × scored units (1 = average); an all-zero room
 * gives everyone 1. With `players` it is the score per player over the room's score per player, so a team playing
 * short is not measured against full teams; when every unit has the same number of players the two are the same.
 * The score is `comparableScore`: on a Best-of round the total of the counted games, not the wins, so units of
 * different rooms compare.
 */
export function relativeRoomShare(
  unit: RankScore & { players?: number },
  scoredRoom: ReadonlyArray<RankScore & { players?: number }>,
): number {
  const roomTotal = comparableRoomTotal(scoredRoom);
  if (roomTotal <= 0) return 1;
  const score = comparableScore(unit);
  const counts = scoredRoom.map((entry) => entry.players ?? 1);
  if (counts.every((count) => count === counts[0])) return (score / roomTotal) * scoredRoom.length;
  const roomPlayers = counts.reduce((total, count) => total + count, 0);
  return score / (unit.players ?? 1) / (roomTotal / roomPlayers);
}

/** The units placed in a room (its line-up), scored or not. */
export function roomUnitCount(state: TournamentState, roundIndex: number, room: number): number {
  return (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room).length;
}

/** The units of a room that were present: its line-up less the absentees. */
export function presentUnitCount(state: TournamentState, roundIndex: number, room: number): number {
  return roomUnitCount(state, roundIndex, room) - absentInRoom(state, roundIndex, room).length;
}

/**
 * A room with exactly one assigned unit is not a match (its opponent was
 * removed, or the seeder left an odd unit alone): the standings credit the
 * unit like a bye (a win), with no score and no room share. Counts assigned
 * units, not scored ones -- a two-unit room with a missing score is still a
 * normal match. Advancement is unaffected: a lone unit already advances.
 */
export function isUncontestedRoom(state: TournamentState, roundIndex: number, room: number): boolean {
  return roomUnitCount(state, roundIndex, room) === 1;
}

/**
 * A room with exactly one present unit: as an uncontested room, the unit takes a win with no score and no room
 * share, whether its opponents were never seated or were absent. A room with no present unit gives nobody a win.
 * The scoring callers read this; `isUncontestedRoom` keeps its line-up meaning for the displays.
 */
export function isWalkoverRoom(state: TournamentState, roundIndex: number, room: number): boolean {
  return presentUnitCount(state, roundIndex, room) === 1;
}

/** True once the round is being played or is over: a bye or a lone unit only earns its win then. */
export function roundHasBegun(state: TournamentState, roundIndex: number): boolean {
  return isRoundDone(state, roundIndex) || (isCurrentRound(state, roundIndex) && state.started);
}

/** Group Stage byes of groups that play a match this round (a group whose round robin ran out is idle, not on a bye). */
export function activeGroupByes(state: TournamentState, round: TournamentRound): string[] {
  const playing = new Set((round.matches ?? []).map((match) => match.group));
  const idle = new Set(
    state.groups.filter((group) => !playing.has(group.label)).flatMap((group) => group.members),
  );
  return (round.groupByes ?? []).filter((name) => !idle.has(name));
}

/** What a walkover win is: the places a won match is read from, and what the outcome is marked as. */
export interface WalkoverKind {
  /** The size of the room whose winner's points the win gets (Standard points / Custom table). */
  roomSize: number;
  bye: boolean;
  walkover: boolean;
  /** Under match results, the win is a Tie Win for each game instead of a Win (a Swiss or qualification bye). */
  tieWin?: boolean;
}

/**
 * A win taken without a match, worth what a played clean win gives: the winner's points of a room of `roomSize`
 * (Standard points / Custom table), or a Win (a Tie Win for a Swiss or qualification bye) for each game of the round
 * under match results (a Best of N as one match). No score and no room share.
 */
export function walkoverOutcome(
  state: TournamentState,
  roundIndex: number,
  { roomSize, bye, walkover, tieWin }: WalkoverKind,
): RoundOutcome {
  const settings = matchResultSettings(state);
  const win = settings ? matchResultsWalkover(state, roundIndex, settings, tieWin ? 'TW' : 'W') : null;
  return {
    roundIndex,
    score: null,
    rank: null,
    points: win ? win.points : (roomPointsByPlace(state, roomSize)[0] ?? 0),
    bye,
    share: null,
    ...(walkover ? { walkover: true } : {}),
    ...(win ? { results: win.results } : {}),
  };
}

/** Whether the unit's bye in the round was taken while likely absent (`absenceVersion` 4): it earns nothing. */
export function isAbsentBye(state: TournamentState, roundIndex: number, name: string): boolean {
  return (state.assignments[roundIndex] ?? []).some(
    (entry) => entry.name === name && entry.room === null && entry.absentBye === true,
  );
}

/** Every scored unit of a room with its result, best place first. */
export function roomOutcomes(
  state: TournamentState,
  roundIndex: number,
  room: number,
): Array<RoundOutcome & { name: string }> {
  const scored = scoreRoom(state, roundIndex, room, null);
  const roomPoints = roomPointsByPlace(state, presentUnitCount(state, roundIndex, room));
  return orderRoomWithPlaces(scored, roundIndex, room, state).map(({ entry, place, sharedBy }) => ({
    name: entry.name,
    roundIndex,
    score: entry.score,
    rank: place,
    points: pointsForSharedPlace(roomPoints, place, sharedBy),
    bye: false,
    share: relativeRoomShare(entry, scored),
    ...(sharedBy > 1 ? { shared: true } : {}),
  }));
}

/** A played room's results: the places and room share as usual, the points by place or, under match results, by the result of the match (none until the room is fully scored). */
export function playedOutcomes(
  state: TournamentState,
  roundIndex: number,
  room: number,
): Array<RoundOutcome & { name: string }> {
  const outcomes = roomOutcomes(state, roundIndex, room);
  const settings = matchResultSettings(state);
  if (!settings) return outcomes;
  const sides = matchResultsOfRoom(state, roundIndex, room, settings);
  if (!sides) return [];
  const seatedNames = (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .map((entry) => entry.name);
  return outcomes.map((outcome) => ({ ...outcome, ...sides[seatedNames.indexOf(outcome.name)] }));
}
