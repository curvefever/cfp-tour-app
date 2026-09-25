import type { GameFormatDefinition, RoomSize, TournamentRound } from './types';

const HARD_ROOM_PLAYER_CAP = 10;

export function distributeRooms(count: number, roomSize: RoomSize): number[] {
  if (count <= 0) return [];
  if (count <= roomSize.max) return [count];

  const minRooms = Math.ceil(count / roomSize.max);
  const maxRooms = Math.floor(count / roomSize.min);
  let roomCount = minRooms;
  if (maxRooms >= minRooms) {
    const idealRooms = Math.round(count / roomSize.ideal);
    roomCount = Math.min(maxRooms, Math.max(minRooms, idealRooms));
  }

  const base = Math.floor(count / roomCount);
  const extra = count % roomCount;
  return Array.from({ length: roomCount }, (_, index) => base + (index < extra ? 1 : 0));
}

export function distributeRoomsWithBye(
  count: number,
  roomSize: RoomSize,
  oddCountStrategy?: string,
): { rooms: number[]; byeCount: number } {
  const remainder = oddCountStrategy === 'bye' && roomSize.min === roomSize.max ? count % roomSize.ideal : 0;
  return {
    rooms: distributeRooms(count - remainder, roomSize),
    byeCount: remainder,
  };
}

/**
 * How an elimination round's advancement target splits across its rooms:
 * byes advance on their own, the rest is spread evenly, and the remainder
 * becomes lucky-loser slots.
 */
export function splitAdvancement(
  target: number,
  byeCount: number,
  roomCount: number,
): { advPerRoom: number; luckyCount: number } {
  const roomAdvanceTarget = target - byeCount;
  return {
    advPerRoom: Math.floor(roomAdvanceTarget / roomCount),
    luckyCount: roomAdvanceTarget % roomCount,
  };
}

function describeRound(round: TournamentRound): string {
  if (round.isFinal) return 'the Final';
  if (round.isSemis) return 'Semis';
  return `Round ${round.roundNum}`;
}

/**
 * Reshapes a round planned at generation (round.rooms, sized for the starting
 * headcount) to the units that actually reach it (`poolSize`, byes excluded),
 * so a mid-tournament removal can't leave the seeders with a different number
 * of units than seats. Returns the round itself when it already fits. Rooms
 * are re-derived the way generation shaped them (a Final is always one
 * room); an elimination round keeps its advTotal target and re-splits it, a
 * no-elimination round advances everyone. Returns an error when there would
 * be nothing left to eliminate.
 */
export function fitRoundToPool(
  round: TournamentRound,
  poolSize: number,
  roomSize: RoomSize,
): TournamentRound | { error: string } {
  if (round.rooms.reduce((total, size) => total + size, 0) === poolSize) return round;
  const isElimination = round.advPerRoom !== null;
  const roomAdvanceTarget = round.advTotal - round.byeCount;
  if (poolSize <= 0 || (isElimination && poolSize <= roomAdvanceTarget)) {
    return {
      error: `${poolSize} unit${poolSize === 1 ? '' : 's'} would reach ${describeRound(round)}, which is meant to cut the field down to ${round.advTotal}, so nobody would be eliminated. Add a replacement or reserve before advancing.`,
    };
  }
  const rooms = round.isFinal ? [poolSize] : distributeRooms(poolSize, roomSize);
  const players = poolSize + round.byeCount;
  if (!isElimination) return { ...round, rooms, players, advTotal: players };
  return { ...round, rooms, players, ...splitAdvancement(round.advTotal, round.byeCount, rooms.length) };
}

export function validateRoomCap(
  rounds: Array<Pick<TournamentRound, 'roundNum' | 'rooms'>>,
  format: Readonly<GameFormatDefinition>,
): string | null {
  const unitSize = format.teamSize ?? 1;
  for (const round of rounds) {
    for (const roomUnits of round.rooms) {
      const playerCount = roomUnits * unitSize;
      if (playerCount > HARD_ROOM_PLAYER_CAP) {
        return (
          `Round ${round.roundNum} would seat ${playerCount} players in one room (` +
          `${roomUnits} ${format.unitLabelPlural.toLowerCase()} × ${unitSize} players each) — ` +
          `over the game's hard cap of ${HARD_ROOM_PLAYER_CAP} players per room. If you set a Semis/Final ` +
          'size override, try a smaller value; otherwise this should not be possible with any registered ' +
          "format's current numbers — please report this before generating."
        );
      }
    }
  }
  return null;
}
