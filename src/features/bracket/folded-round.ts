import { roomLetter } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import { getUnitScore, orderRoomWithPlaces } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
import { placeOrdinal } from '../../lib/ordinal';

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

/** What a folded round shows: how many rooms it had, whether it is done, and where the followed unit stood. */
export function foldedRoundSummary(
  state: TournamentState,
  roundIndex: number,
  followKey: string | null,
): FoldedRoundSummary {
  const assignments = state.assignments[roundIndex] ?? [];
  const occupied = new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])));
  const rooms = assignments.length > 0 ? occupied.size : (state.rounds[roundIndex]?.rooms.length ?? 0);
  const done = roundIndex < state.curRound;
  if (!followKey) return { rooms, done, followed: null };
  const label = unitDisplay(state, followKey).label;
  if (state.byes[roundIndex]?.includes(followKey)) {
    return { rooms, done, followed: { label, room: null, place: null, detail: 'Bye' } };
  }
  const seat = assignments.find((entry) => entry.name === followKey);
  if (!seat) return { rooms, done, followed: null };
  if (seat.room === null) return { rooms, done, followed: { label, room: null, place: null, detail: 'Bye' } };
  const roomPlace = placeInRoom(state, roundIndex, seat.room, followKey);
  const place = roomPlace?.place ?? null;
  const room = `Room ${roomLetter(seat.room)}`;
  return {
    rooms,
    done,
    followed: {
      label,
      room: seat.room,
      place,
      detail: roomPlace === null ? room : `${room} · ${placeOrdinal(roomPlace)}`,
    },
  };
}
