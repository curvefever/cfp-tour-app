import { distributeRooms } from './room-distribution';
import type { RoomSize, TournamentRound } from './types';

export const KINGS_VALLEY_MOVE_FRACTION = 0.25;
export const KINGS_VALLEY_ELIMINATION_FRACTION = 0.5;
export const MAX_KINGS_VALLEY_ROUNDS = 14;

export interface KingsValleyConfig {
  roomSize: RoomSize;
  finalsGames: number;
}

function bandCount(roomSize: number, fraction: number): number {
  return Math.max(1, Math.round(roomSize * fraction));
}

export interface KingsValleyRoomBandCounts {
  promote: number;
  /** This room's own demote band, or its eliminate band when `eliminates` is true -- never both. */
  cut: number;
  eliminates: boolean;
}

/**
 * One room's promote/cut counts, computed from its REAL size, for every room
 * in the ladder -- shared by generation (kingsValleyBracketPhase), the real
 * advance (kingsValleyComputeAdvancement, advancement.ts) and the exit chips
 * (kingsValleyRoomBands, room-exits.ts), so a lone room can never disagree
 * between the three. A room with fewer than 2 units has no real match to
 * play, so it holds (promote 0, cut 0) instead of being cut by the band
 * maths -- the organiser's 2026-09-27 decision. The elimination cut always
 * comes from the *effective bottom*: the last room (by ladder position) that
 * still has a real match, not necessarily the literal last room -- a lone
 * room can sit anywhere in the ladder, including below the effective bottom.
 */
export function kingsValleyRoomBandCounts(roomSizes: number[]): KingsValleyRoomBandCounts[] {
  let eliminateIndex = -1;
  for (let index = roomSizes.length - 1; index >= 0; index -= 1) {
    if (roomSizes[index] >= 2) {
      eliminateIndex = index;
      break;
    }
  }
  return roomSizes.map((size, index) => {
    if (size < 2) return { promote: 0, cut: 0, eliminates: false };
    const eliminates = index === eliminateIndex;
    const promote = bandCount(size, KINGS_VALLEY_MOVE_FRACTION);
    const cutFraction = eliminates ? KINGS_VALLEY_ELIMINATION_FRACTION : KINGS_VALLEY_MOVE_FRACTION;
    const cut = Math.min(bandCount(size, cutFraction), size - promote);
    return { promote, cut, eliminates };
  });
}

function finalRound(roundNum: number, players: number, finalsGames: number): TournamentRound {
  return {
    roundNum,
    players,
    rooms: [players],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: true,
    advPerRoom: 1,
    advTotal: 1,
    luckyCount: 0,
    numGames: finalsGames,
  };
}

/**
 * Rooms are ranked 1 (top) .. R (bottom). Each round, a room's top band
 * promotes to the room above (room 1's promote band has nowhere to go and
 * stays instead), a bottom band demotes to the room below, and the rest
 * stay. Only the *effective bottom* -- the last room (by ladder position)
 * that still has a real match, not necessarily the literal last room -- is
 * actually eliminated; any literal-last room left with fewer than 2 units
 * (an odd head-to-head field, or a removal) holds instead, per
 * kingsValleyRoomBandCounts above. Room sizes are recomputed from the
 * shrinking survivor count via distributeRooms() each round -- the same pure
 * room-sizing function every other bracket phase already uses -- so room
 * count naturally shrinks as the effective bottom's eliminations reduce the
 * population, with no explicit merge step needed. Once the population fits
 * in one room, that becomes the dedicated Final round and the simulation
 * stops.
 *
 * `capStartRoundNum` anchors the MAX_KINGS_VALLEY_ROUNDS cap -- defaults to
 * `startRoundNum`, but a mid-tournament re-fit (fitKingsValleyTail,
 * transitions.ts) passes the FIRST Kings Valley round's own roundNum instead,
 * so re-planning the tail from a later round doesn't hand a stuck field a
 * fresh 14-round budget it already partly spent.
 */
export function kingsValleyBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: KingsValleyConfig,
  capStartRoundNum: number = startRoundNum,
): TournamentRound[] {
  const rounds: TournamentRound[] = [];
  let total = seedTotal;
  let roundNum = startRoundNum;

  while (true) {
    const roomSizes = distributeRooms(total, config.roomSize);
    if (roomSizes.length <= 1) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }

    const bands = kingsValleyRoomBandCounts(roomSizes);
    const kvPromoteCounts = bands.map((band) => band.promote);
    const kvDemoteCounts = bands.map((band) => (band.eliminates ? 0 : band.cut));
    const kvEliminateCount = bands.find((band) => band.eliminates)?.cut ?? 0;

    rounds.push({
      roundNum,
      players: total,
      rooms: roomSizes,
      byeCount: 0,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: false,
      advPerRoom: null,
      advTotal: total - kvEliminateCount,
      luckyCount: 0,
      isKingsValley: true,
      kvPromoteCounts,
      kvDemoteCounts,
      kvEliminateCount,
    });

    total -= kvEliminateCount;
    roundNum += 1;
    if (roundNum - capStartRoundNum >= MAX_KINGS_VALLEY_ROUNDS) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }
  }
  return rounds;
}
