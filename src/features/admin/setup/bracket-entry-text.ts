import { practiceBracketEntry } from '../../../domain/tournament/bracket-entry-default';
import { deriveRoomSize, getGameFormat } from '../../../domain/tournament/formats';
import type { PersistedSetup, RoomSize, ScheduleLogicKey } from '../../../domain/tournament/types';
import { upperLowerEntries } from '../../../domain/tournament/upper-lower';
import { plural } from './plural';

/** What Setup says about an empty "Advance to bracket": the number the app works out, and where it comes from. */

export const WAITING_FOR_ROSTER_TEXT = 'Worked out from the head count once a roster is loaded.';

/** The only counts a schedule can seat, when it can't seat every one: those of an upper and lower bracket. */
export function seatedEntriesOf(scheduleLogic: ScheduleLogicKey, roomSize: RoomSize): number[] | undefined {
  return scheduleLogic === 'upper-lower' ? upperLowerEntries(roomSize) : undefined;
}

/** The placeholder of the empty field and the line under it. */
export function automaticAdvanceText(
  setup: Pick<PersistedSetup, 'gameFormat' | 'scheduleLogic'>,
  registered: number | null,
): { placeholder: string; hint: string } {
  const format = getGameFormat(setup.gameFormat);
  if (!format || !registered) return { placeholder: 'automatic', hint: WAITING_FOR_ROSTER_TEXT };
  const roomSize = deriveRoomSize(format);
  const { scheduleLogic } = setup;
  const allowed = seatedEntriesOf(scheduleLogic, roomSize);
  const { count, play, rooms } = practiceBracketEntry({ registered, roomSize, scheduleLogic, allowed });
  const split = rooms ? `, in ${plural(rooms.count, 'room')} of ${rooms.size}` : '';
  return {
    placeholder: `automatic: ${count}`,
    hint: `Empty: ${count}, 75-85% of the ${play} expected to play (9 in 10 of ${registered} registered)${split}.`,
  };
}
