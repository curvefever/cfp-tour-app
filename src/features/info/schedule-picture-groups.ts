import type { RoundExitRule } from '../../domain/tournament/room-exits';
import type { TournamentRound } from '../../domain/tournament/types';
import { placesBlock, roomBlocks, type BlockContext } from './schedule-picture-bands';
import { luckyDestinationOf, luckyRoomsAt } from './schedule-picture-routes';
import type { PictureBlock } from './schedule-picture-types';

/** Rooms of one round that exit alike: their 0-based indices, their sizes and the blocks they share. */
export interface RoomGroup {
  rooms: number[];
  sizes: number[];
  blocks: PictureBlock[];
}

/**
 * The rooms of a round, grouped by their blocks. Two rooms are alike when their blocks are equal with the last band
 * read as "to last", so rooms of 8 and 7 that exit alike are one group; the group writes "5th–last" only when its
 * rooms differ in size, else the places of its rooms.
 */
export function roomGroups(
  round: TournamentRound,
  roundIndex: number,
  rule: RoundExitRule,
  labels: BlockContext['labels'],
): RoomGroup[] {
  const perRoom = rule.kind === 'per-room' ? rule.rooms : null;
  const luckyRooms = perRoom ? luckyRoomsAt(perRoom) : () => 0;
  const blocksOf = (room: number, toLast: boolean): PictureBlock[] => {
    const size = round.rooms[room];
    if (!perRoom) return [placesBlock(size, toLast)];
    const bands = perRoom[room] ?? [];
    return roomBlocks(bands, {
      labels,
      roomSize: size,
      toLast,
      luckyRooms,
      luckyDestination: luckyDestinationOf(round, roundIndex, bands),
    });
  };
  const groups = new Map<string, RoomGroup>();
  round.rooms.forEach((size, room) => {
    const alike = blocksOf(room, true);
    const key = JSON.stringify(alike);
    const group = groups.get(key);
    if (group) {
      group.rooms.push(room);
      group.sizes.push(size);
    } else groups.set(key, { rooms: [room], sizes: [size], blocks: alike });
  });
  return [...groups.values()].map((group) =>
    new Set(group.sizes).size === 1 ? { ...group, blocks: blocksOf(group.rooms[0], false) } : group,
  );
}
