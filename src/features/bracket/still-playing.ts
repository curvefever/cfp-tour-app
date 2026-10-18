import { isUncontestedRoom } from '../../domain/tournament/advancement';
import { roomLetter } from '../../domain/tournament/bracket';
import { getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/** How many of a round's contested rooms have every score in, out of how many there are. */
export interface RoomsScored {
  scored: number;
  total: number;
}

/** The rooms (1-based) of a round that have units, in order. */
function roundRooms(state: TournamentState, roundIndex: number): number[] {
  const assignments = state.assignments[roundIndex] ?? [];
  return [...new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])))].sort(
    (first, second) => first - second,
  );
}

/** Whether every unit of the room has a score (every game, in a round of several games). */
function isRoomScored(state: TournamentState, roundIndex: number, room: number): boolean {
  return (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .every((_, position) => getUnitScore(state, roundIndex, room, position, null) !== null);
}

/** The rooms (1-based) of a round that have units but not every score yet. */
export function roomsStillPlaying(state: TournamentState, roundIndex: number): number[] {
  return roundRooms(state, roundIndex).filter((room) => !isRoomScored(state, roundIndex, room));
}

/** The admin's "4/6" on a round's title bar: contested rooms only, as a bye or lone unit has nothing to score. */
export function roomsScored(state: TournamentState, roundIndex: number): RoomsScored {
  const contested = roundRooms(state, roundIndex).filter(
    (room) => !isUncontestedRoom(state, roundIndex, room),
  );
  return {
    scored: contested.filter((room) => isRoomScored(state, roundIndex, room)).length,
    total: contested.length,
  };
}

/** "Room C still playing.", "Rooms B and C still playing.", "Rooms A, B and C still playing."; empty when none. */
export function stillPlayingText(rooms: number[]): string {
  if (rooms.length === 0) return '';
  const letters = rooms.map((room) => roomLetter(room));
  if (letters.length === 1) return `Room ${letters[0]} still playing.`;
  const last = letters[letters.length - 1];
  return `Rooms ${letters.slice(0, -1).join(', ')} and ${last} still playing.`;
}
