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

function tooFewUnitsError(round: TournamentRound, poolSize: number): { error: string } {
  const label = describeRound(round);
  const advice = 'Add a replacement or reserve before advancing.';
  if (round.isFinal) {
    const reaching = poolSize <= 0 ? 'Nobody' : `Only ${poolSize} unit`;
    return { error: `${reaching} would reach ${label}, which needs at least 2 to play. ${advice}` };
  }
  return {
    error: `Only ${poolSize} unit would reach ${label}, which is meant to cut the field down to ${round.advTotal}; a unit playing alone can't be eliminated. ${advice}`,
  };
}

/**
 * A round with nobody to play: no rooms, and only the units on a bye (possibly
 * none) advance. A no-elimination round keeps its null advPerRoom.
 */
function walkoverRound(round: TournamentRound): TournamentRound {
  return {
    ...round,
    rooms: [],
    players: round.byeCount,
    advTotal: round.byeCount,
    advPerRoom: round.advPerRoom === null ? null : 0,
    luckyCount: 0,
  };
}

/**
 * The advTotal an elimination round keeps or falls back to when `poolSize`
 * units reach it, or null when it can't be played. A pool above the round's
 * own advancement target keeps advTotal. A smaller one would leave nobody to
 * eliminate, so the round keeps its meaning instead: a round planned to
 * eliminate nobody (an explicit plateau) advances everyone, any other still
 * eliminates exactly one. A pool of one (or the Final's) can't be played.
 */
function fittedAdvTotal(round: TournamentRound, poolSize: number): number | null {
  if (poolSize > round.advTotal - round.byeCount) return round.advTotal;
  if (round.isFinal || poolSize < 2) return null;
  if (round.advTotal >= round.players) return poolSize + round.byeCount;
  return round.byeCount + poolSize - 1;
}

/**
 * Reshapes a round planned at generation (round.rooms, sized for the starting
 * headcount) to the units that actually reach it (`poolSize`, byes excluded),
 * so a mid-tournament removal can't leave the seeders with a different number
 * of units than seats. Returns the round itself when it already fits. Rooms
 * are re-derived the way generation shaped them (a Final is always one
 * room); a no-elimination round advances everyone, an elimination round
 * keeps its advTotal target and re-splits it (see fittedAdvTotal for a pool
 * too small to keep it). A round nobody reaches, or only units on a bye,
 * is a walkover with no rooms (never the Final). Returns an error when one
 * unit reaches a non-Final elimination round, or at most one reaches the Final.
 */
export function fitRoundToPool(
  round: TournamentRound,
  poolSize: number,
  roomSize: RoomSize,
): TournamentRound | { error: string } {
  if (round.rooms.reduce((total, size) => total + size, 0) === poolSize) return round;
  if (poolSize <= 0) return round.isFinal ? tooFewUnitsError(round, poolSize) : walkoverRound(round);
  const rooms = round.isFinal ? [poolSize] : distributeRooms(poolSize, roomSize);
  const players = poolSize + round.byeCount;
  if (round.advPerRoom === null) return { ...round, rooms, players, advTotal: players };
  const advTotal = fittedAdvTotal(round, poolSize);
  if (advTotal === null) return tooFewUnitsError(round, poolSize);
  return { ...round, rooms, players, advTotal, ...splitAdvancement(advTotal, round.byeCount, rooms.length) };
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
