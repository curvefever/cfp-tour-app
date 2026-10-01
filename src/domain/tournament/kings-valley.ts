import { distributeRooms, isSeatable } from './room-distribution';
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

export interface KingsValleyRoundMoves {
  bands: KingsValleyRoomBandCounts[];
  /** The next round's room sizes; length 1 means the Final. */
  nextRooms: number[];
}

/**
 * The plain per-room maths, computed from each room's own size only. Used as
 * the fallback when a room has fewer than 2 units (only after a removal) or
 * the room size is unknown: a room with no real match holds (promote 0,
 * cut 0), and the elimination cut comes from the *effective bottom* -- the
 * last room that still has a real match, not necessarily the literal last
 * room -- so a lone room can sit anywhere in the ladder (the organiser's
 * 2026-09-27 decision).
 */
function holdingRoundMoves(roomSizes: number[], roomSize: RoomSize | undefined): KingsValleyRoundMoves {
  let eliminateIndex = -1;
  for (let index = roomSizes.length - 1; index >= 0; index -= 1) {
    if (roomSizes[index] >= 2) {
      eliminateIndex = index;
      break;
    }
  }
  const bands = roomSizes.map((size, index) => {
    if (size < 2) return { promote: 0, cut: 0, eliminates: false };
    const eliminates = index === eliminateIndex;
    const promote = bandCount(size, KINGS_VALLEY_MOVE_FRACTION);
    const cutFraction = eliminates ? KINGS_VALLEY_ELIMINATION_FRACTION : KINGS_VALLEY_MOVE_FRACTION;
    const cut = Math.min(bandCount(size, cutFraction), size - promote);
    return { promote, cut, eliminates };
  });
  const total = roomSizes.reduce((sum, size) => sum + size, 0);
  const eliminated = bands.find((band) => band.eliminates)?.cut ?? 0;
  return { bands, nextRooms: roomSize ? distributeRooms(total - eliminated, roomSize) : [] };
}

/** The bottom room's cut: the seatable one nearest the default half, the smaller on a tie. */
function bottomCut(total: number, bottomSize: number, bottomPromote: number, roomSize: RoomSize): number {
  const maxCut = bottomSize - bottomPromote;
  const preferred = Math.min(bandCount(bottomSize, KINGS_VALLEY_ELIMINATION_FRACTION), maxCut);
  let best = preferred;
  let bestDistance = Infinity;
  for (let cut = 1; cut <= maxCut; cut += 1) {
    if (!isSeatable(total - cut, roomSize)) continue;
    const distance = Math.abs(cut - preferred);
    if (distance < bestDistance) {
      best = cut;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * One round of the ladder: every room's promote/cut counts AND the next
 * round's room sizes, solved together so the moves land exactly on those
 * sizes. Shared by generation (kingsValleyBracketPhase), the real advance
 * (kingsValleyComputeAdvancement, advancement.ts) and the exit chips
 * (room-exits.ts), so chips, placeholders and the real seating can't
 * disagree.
 *
 * Promotions stay at the default 25% of each room. The bottom room alone
 * eliminates, by the seatable cut nearest half of it (so the survivors can
 * always be split into legal rooms). Demotions are then sized top-down to
 * absorb whatever difference the new room layout needs; a promotion is only
 * lowered when a room couldn't otherwise supply its demotions. Without
 * `roomSize`, or when any room holds fewer than 2 units (a removal), the
 * plain per-room maths applies instead (holdingRoundMoves).
 */
export function kingsValleyRoundMoves(
  roomSizes: number[],
  roomSize: RoomSize | undefined,
): KingsValleyRoundMoves {
  if (!roomSize || roomSizes.some((size) => size < 2)) return holdingRoundMoves(roomSizes, roomSize);

  const bottom = roomSizes.length - 1;
  const total = roomSizes.reduce((sum, size) => sum + size, 0);
  const promote = roomSizes.map((size) => bandCount(size, KINGS_VALLEY_MOVE_FRACTION));
  const eliminated = bottomCut(total, roomSizes[bottom], promote[bottom], roomSize);
  const nextRooms = distributeRooms(total - eliminated, roomSize);

  const demote: number[] = [];
  let net = 0;
  for (let index = 0; index < bottom; index += 1) {
    net += roomSizes[index] - (nextRooms[index] ?? 0);
    let cut = net + promote[index + 1];
    if (cut < 0) {
      promote[index + 1] -= cut;
      cut = 0;
    }
    const over = (index > 0 ? promote[index] : 0) + cut - roomSizes[index];
    if (over > 0) {
      const relief = Math.min(over, promote[index + 1]);
      promote[index + 1] -= relief;
      cut -= relief;
    }
    demote.push(cut);
  }

  const bands = roomSizes.map((_, index) =>
    index < bottom
      ? { promote: promote[index], cut: demote[index], eliminates: false }
      : { promote: promote[index], cut: eliminated, eliminates: true },
  );
  return { bands, nextRooms };
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
 * holdingRoundMoves above. The bottom room cuts about half of itself,
 * nudged so the survivors can always be seated in legal rooms, and the next
 * round's room sizes come from kingsValleyRoundMoves too, so the demotions
 * land the units exactly on them. Once the population fits in one room,
 * that becomes the dedicated Final round and the simulation stops.
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
  let roomSizes = distributeRooms(total, config.roomSize);

  while (true) {
    if (roomSizes.length <= 1) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }

    const moves = kingsValleyRoundMoves(roomSizes, config.roomSize);
    const kvPromoteCounts = moves.bands.map((band) => band.promote);
    const kvDemoteCounts = moves.bands.map((band) => (band.eliminates ? 0 : band.cut));
    const kvEliminateCount = moves.bands.find((band) => band.eliminates)?.cut ?? 0;

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
    roomSizes = moves.nextRooms;
    roundNum += 1;
    if (roundNum - capStartRoundNum >= MAX_KINGS_VALLEY_ROUNDS) {
      rounds.push(finalRound(roundNum, total, config.finalsGames));
      break;
    }
  }
  return rounds;
}
