import { roomLetter } from '../../domain/tournament/bracket';
import type { TournamentRound } from '../../domain/tournament/types';

type RoomTitleRound = Pick<
  TournamentRound,
  'isFinal' | 'bracket' | 'isSemis' | 'isGroupStage' | 'roomGroups'
>;

/**
 * The title of a room's card, from the round's own flags (never its label, which can be anything an organiser
 * typed): the Final reads "Final", a Semis room "Semi A", a group-stage room "Group A · Room B" and every other
 * room "Room A", waterfall rounds included. `roomIndex` is 0-based.
 */
export function roomTitle(round: RoomTitleRound, roomIndex: number): string {
  const letter = roomLetter(roomIndex + 1);
  if (round.isFinal || round.bracket === 'grand-final') return 'Final';
  if (round.isSemis) return `Semi ${letter}`;
  if (round.isGroupStage) return `Group ${round.roomGroups?.[roomIndex]} · Room ${letter}`;
  return `Room ${letter}`;
}
