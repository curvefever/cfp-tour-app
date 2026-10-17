import { bracketRoundLabels, roomLetter } from '../../domain/tournament/bracket';
import { currentColumn } from '../../domain/tournament/round-columns';
import type { UnscoredRoom } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';

/**
 * What the confirmation before Next Round says about rooms with no score: "No score yet in Room B. Go to the
 * next round anyway?". A column of several rounds names each room with its round ("Round 5 Lower · Room B"),
 * as the tie banners do.
 */
export function unscoredRoomsMessage(state: TournamentState, rooms: UnscoredRoom[]): string {
  const { start, end } = currentColumn(state);
  const labels = bracketRoundLabels(state);
  const names = rooms.map(({ roundIndex, room }) => {
    const roomName = `Room ${roomLetter(room)}`;
    return end > start ? `${labels[roundIndex]?.label ?? ''} · ${roomName}` : roomName;
  });
  return `No score yet in ${names.join(', ')}. Go to the next round anyway?`;
}
