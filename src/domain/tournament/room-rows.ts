import { absentInRoom, absenteeLeavesCustomBracket } from './absences';
import { unitRankScore } from './match-format';
import { absenteeFate, type AbsenteeFate } from './room-row-result';
import { orderRoomWithPlaces } from './scoring';
import type { TournamentState } from './types';

/** One row of a room, as the Bracket draws it and Rankings counts it. */
export interface RoomRowUnit {
  name: string;
  /** Seat in the room (the score keys use it), 0-based. */
  position: number;
  /** The unit's score (on a Best-of round its wins), or null while it has none. */
  score: number | null;
  /** On a Best-of round, the total score that breaks a tie between equal wins. */
  tiebreak?: number;
  /** The place among the units that were present, 1-based; null for an absentee and while the room has no order. */
  place: number | null;
  /** Another unit on the same score shares the place. */
  shared: boolean;
  /** The unit was absent from the room: it has no place and comes after every unit that was present. */
  absent: boolean;
  /** The row's rank for the room's exit bands: its place, or after every present unit for an absentee; its seat order while the room has no order. */
  rank: number;
  /** What becomes of an absentee (`absenteeFate`); undefined for a unit that was present. */
  fate?: AbsenteeFate;
}

export interface RoomRows {
  /** The units that were present best first, then the absentees; in seat order while the room has no order. */
  rows: RoomRowUnit[];
  /** Every unit of the room has a score. */
  complete: boolean;
}

/**
 * The rows of a room, in the order the Bracket draws them, each with its place and what becomes of it: the units that
 * were present by score, then the absentees. The room keeps its seat order until every unit is scored (so rows do not
 * jump while a score is typed), and also when `ordered` is false (a round not reached yet).
 */
export function roomRows(
  state: TournamentState,
  roundIndex: number,
  room: number,
  { ordered }: { ordered: boolean } = { ordered: true },
): RoomRows {
  const round = state.rounds[roundIndex];
  const units = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  const scored = units.map((entry, position) => {
    const rank = unitRankScore(state, roundIndex, room, position, null);
    return { name: entry.name, position, score: rank?.score ?? null, tiebreak: rank?.tiebreak };
  });
  const complete = scored.length > 0 && scored.every((entry) => entry.score !== null);
  const absentNames = absentInRoom(state, roundIndex, room);
  const present = scored.filter((entry) => !absentNames.includes(entry.name));
  const rowOf = (
    entry: Pick<RoomRowUnit, 'name' | 'position' | 'score' | 'tiebreak'>,
    index: number,
    place: number | null,
    shared: boolean,
  ): RoomRowUnit => {
    const absentAt = absentNames.indexOf(entry.name);
    if (absentAt < 0) return { ...entry, place, shared, absent: false, rank: place ?? index + 1 };
    const absentRank = present.length + absentAt;
    const leaves = absenteeLeavesCustomBracket(state, round, room, units.length, absentRank);
    return {
      ...entry,
      place: null,
      shared: false,
      absent: true,
      rank: absentRank + 1,
      fate: absenteeFate(round, leaves),
    };
  };
  if (!ordered || !complete) {
    return { rows: scored.map((entry, index) => rowOf(entry, index, null, false)), complete };
  }
  const placed = orderRoomWithPlaces(
    present as Array<{ name: string; position: number; score: number; tiebreak?: number }>,
    roundIndex,
    room,
    state,
  ).map(({ entry, place, sharedBy }) => rowOf(entry, place - 1, place, sharedBy > 1));
  const absent = absentNames
    .flatMap((name) => scored.filter((entry) => entry.name === name))
    .map((entry, index) => rowOf(entry, placed.length + index, null, false));
  return { rows: [...placed, ...absent], complete };
}
