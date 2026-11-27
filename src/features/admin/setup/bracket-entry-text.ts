import { practiceBracketEntry } from '../../../domain/tournament/bracket-entry-default';
import { deriveRoomSize, getGameFormat } from '../../../domain/tournament/formats';
import type { PersistedSetup, RoomSize } from '../../../domain/tournament/types';
import { upperLowerEntries } from '../../../domain/tournament/upper-lower';
import { plural } from './plural';

/** What Setup says about an empty "Advance to bracket": the number the app works out, and where it comes from. */

export const WAITING_FOR_ROSTER_TEXT = 'Worked out from the head count once a roster is loaded.';

/**
 * What the app's own number is picked by, as generation reads it: the format's rooms and, for a schedule that can't
 * seat every count (upper and lower), the counts it can. Null for an unknown format.
 */
export function entrySeatingOf(
  setup: Pick<PersistedSetup, 'gameFormat' | 'scheduleLogic'>,
): { roomSize: RoomSize; allowed: number[] | undefined } | null {
  const format = getGameFormat(setup.gameFormat);
  if (!format) return null;
  const roomSize = deriveRoomSize(format);
  const allowed = setup.scheduleLogic === 'upper-lower' ? upperLowerEntries(roomSize) : undefined;
  return { roomSize, allowed };
}

/** The placeholder of the empty field and the line under it. */
export function automaticAdvanceText(
  setup: Pick<PersistedSetup, 'gameFormat' | 'scheduleLogic'>,
  registered: number | null,
): { placeholder: string; hint: string } {
  const seating = entrySeatingOf(setup);
  if (!seating || !registered) return { placeholder: 'automatic', hint: WAITING_FOR_ROSTER_TEXT };
  const input = { registered, scheduleLogic: setup.scheduleLogic, ...seating };
  const { count, play, inRange, rooms } = practiceBracketEntry(input);
  const share = inRange ? '75-85% of' : 'the nearest the bracket can seat to 80% of';
  const split = rooms ? `, in ${plural(rooms.count, 'room')} of ${rooms.size}` : '';
  return {
    placeholder: `automatic: ${count}`,
    hint: `Empty: ${count}, ${share} the ${play} expected to play (9 in 10 of ${registered} registered)${split}.`,
  };
}
