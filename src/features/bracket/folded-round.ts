import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomWithPlaces } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { placeOrdinal } from '../../lib/ordinal';
import { isRoundDone } from '../../domain/tournament/round-columns';
import { isNotCountedRound } from './title-bar-marks';

export interface FoldedFollowed {
  /** The followed unit's name as shown (a team's name, a player's name). */
  label: string;
  /** The room it played in; null for a bye. */
  room: number | null;
  /** Its place in that room, once every unit of the room has a score. */
  place: number | null;
  /** "Room A · 3rd" ("Room A · =3rd" for a shared place), "Room A" while the room is being scored, or "Bye". */
  detail: string;
}

export interface FoldedRoundSummary {
  rooms: number;
  /** A round before the current one: nothing more will be played in it. */
  done: boolean;
  /** A pooling round played for seeding only (`isNotCountedRound`); for a column, every round of it. */
  notCounted: boolean;
  /** The followed unit, only when it played this round. */
  followed: FoldedFollowed | null;
}

/** A unit's place in its room, and whether another unit on the same score shares it. */
export interface RoomPlace {
  place: number;
  shared: boolean;
}

/** The place of the unit seated at `position` of `room`, ordered by score as the room card orders its rows. */
export function placeInRoom(
  state: TournamentState,
  roundIndex: number,
  room: number,
  name: string,
): RoomPlace | null {
  const units = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  const scored = units.map((entry, position) => ({
    name: entry.name,
    score: getUnitScore(state, roundIndex, room, position, null),
  }));
  if (scored.length === 0 || scored.some((entry) => entry.score === null)) return null;
  const ordered = orderRoomWithPlaces(
    scored as Array<{ name: string; score: number }>,
    roundIndex,
    room,
    state,
  );
  const found = ordered.find((item) => item.entry.name === name);
  return found ? { place: found.place, shared: found.sharedBy > 1 } : null;
}

/**
 * What a folded column shows: the rooms of all its rounds, done when the column is, and the followed unit
 * from whichever round it played; its line names the round ("Round 5 Lower · Room B · 2nd") when the
 * column holds more than one.
 */
export function foldedColumnSummary(
  state: TournamentState,
  roundIndices: number[],
  followKey: string | null,
): FoldedRoundSummary {
  const parts = roundIndices.map((index) => foldedRoundSummary(state, index, followKey));
  const played = parts.findIndex((part) => part.followed !== null);
  const followed = played === -1 ? null : parts[played].followed;
  const label = bracketRoundLabels(state)[roundIndices[played]]?.label;
  return {
    rooms: parts.reduce((total, part) => total + part.rooms, 0),
    done: parts.every((part) => part.done),
    notCounted: parts.every((part) => part.notCounted),
    followed:
      followed && roundIndices.length > 1 && label
        ? { ...followed, detail: `${label} · ${followed.detail}` }
        : followed,
  };
}

/** What a folded round shows: how many rooms it had, whether it is done or not counted, and where the followed unit stood. */
export function foldedRoundSummary(
  state: TournamentState,
  roundIndex: number,
  followKey: string | null,
): FoldedRoundSummary {
  const assignments = state.assignments[roundIndex] ?? [];
  const occupied = new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])));
  const rooms = assignments.length > 0 ? occupied.size : (state.rounds[roundIndex]?.rooms.length ?? 0);
  const marks = {
    rooms,
    done: isRoundDone(state, roundIndex),
    notCounted: isNotCountedRound(state, roundIndex),
  };
  if (!followKey) return { ...marks, followed: null };
  const label = unitDisplay(state, followKey).label;
  if (state.byes[roundIndex]?.includes(followKey)) {
    return { ...marks, followed: { label, room: null, place: null, detail: 'Bye' } };
  }
  const seat = assignments.find((entry) => entry.name === followKey);
  if (!seat) return { ...marks, followed: null };
  if (seat.room === null) return { ...marks, followed: { label, room: null, place: null, detail: 'Bye' } };
  const roomPlace = placeInRoom(state, roundIndex, seat.room, followKey);
  const place = roomPlace?.place ?? null;
  const room = `Room ${roomLetter(seat.room)}`;
  return {
    ...marks,
    followed: {
      label,
      room: seat.room,
      place,
      detail: roomPlace === null ? room : `${room} · ${placeOrdinal(roomPlace)}`,
    },
  };
}
