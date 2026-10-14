import { roomLetter } from '../../domain/tournament/bracket';
import { getUnitScore } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/** The rooms (1-based) of a round that have units but not every score yet. */
export function roomsStillPlaying(state: TournamentState, roundIndex: number): number[] {
  const assignments = state.assignments[roundIndex] ?? [];
  const rooms = [...new Set(assignments.flatMap((entry) => (entry.room === null ? [] : [entry.room])))].sort(
    (first, second) => first - second,
  );
  return rooms.filter((room) =>
    assignments
      .filter((entry) => entry.room === room)
      .some((_, position) => getUnitScore(state, roundIndex, room, position, null) === null),
  );
}

/** "Room C still playing.", "Rooms B and C still playing.", "Rooms A, B and C still playing."; empty when none. */
export function stillPlayingText(rooms: number[]): string {
  if (rooms.length === 0) return '';
  const letters = rooms.map((room) => roomLetter(room));
  if (letters.length === 1) return `Room ${letters[0]} still playing.`;
  const last = letters[letters.length - 1];
  return `Rooms ${letters.slice(0, -1).join(', ')} and ${last} still playing.`;
}
