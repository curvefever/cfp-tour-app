import { distributeRooms, distributeRoomsWithBye, splitAdvancement } from './room-distribution';
import type { OddCountStrategyKey, RoomSize, TournamentRound } from './types';

const TARGET_ROUND_SURVIVAL_RATIO = 0.8;
const MAX_ELIMINATION_ROUNDS = 8;

export interface SingleEliminationConfig {
  roomSize: RoomSize;
  oddCountStrategy?: OddCountStrategyKey;
  semisSize: number;
  finalSize: number;
  semisGames: number;
  finalsGames: number;
  /** Organiser-supplied ordered survivor-count targets, replacing the automatic geometric-decay curve entirely when set. Pre-validated by the caller (generation.ts). */
  explicitTargets?: number[];
  /** Organiser-supplied fixed reseed mode per elimination round, index-aligned with explicitTargets. Stamped onto each round's own seedingOverride field (types.ts) -- see transitions.ts/seeding.ts for how it's consumed. */
  explicitSeedingOverrides?: Array<'diversity' | 'balance' | 'random' | undefined>;
}

function snapFriendly(count: number, roomSize: RoomSize): number {
  for (let distance = 0; distance <= roomSize.min; distance += 1) {
    for (const direction of [1, -1]) {
      const candidate = count + direction * distance;
      if (candidate < roomSize.min) continue;
      const rooms = Math.ceil(candidate / roomSize.ideal);
      if (rooms >= 1 && Math.floor(candidate / rooms) >= roomSize.min) {
        return candidate;
      }
    }
  }
  return count;
}

export function computeTargets(start: number, end: number, numRounds: number, roomSize: RoomSize): number[] {
  if (numRounds <= 0) return [];
  if (numRounds === 1) return [end];
  if (start <= end) return Array.from({ length: numRounds }, () => end);

  const ratio = Math.pow(end / start, 1 / numRounds);
  const targets: number[] = [];
  let previous = start;
  for (let index = 1; index <= numRounds; index += 1) {
    let target: number;
    if (index === numRounds) {
      target = end;
    } else {
      target = snapFriendly(Math.round(start * Math.pow(ratio, index)), roomSize);
      target = Math.min(target, previous);
      target = Math.max(target, end);
    }
    targets.push(target);
    previous = target;
  }
  return targets;
}

export function computeEliminationRoundCount(total: number, floor: number, roomSize: RoomSize): number {
  if (total <= floor) return 0;
  const ideal = Math.log(floor / total) / Math.log(TARGET_ROUND_SURVIVAL_RATIO);
  let rounds = Math.min(Math.ceil(ideal), MAX_ELIMINATION_ROUNDS);
  if (roomSize.ideal === 2) {
    const halvingRounds = Math.ceil(Math.log(total / floor) / Math.log(2));
    rounds = Math.min(rounds, halvingRounds);
  }
  return rounds;
}

export function computeCleanTargets(
  total: number,
  floor: number,
  requestedRounds: number,
  roomSize: RoomSize,
): number[] {
  let rounds = Math.max(1, requestedRounds);
  while (rounds > 1) {
    const candidate = computeTargets(total, floor, rounds, roomSize);
    let previous = total;
    if (
      candidate.every((target) => {
        const decreasing = target < previous;
        previous = target;
        return decreasing;
      })
    ) {
      return candidate;
    }
    rounds -= 1;
  }
  return computeTargets(total, floor, 1, roomSize);
}

export function singleEliminationBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: SingleEliminationConfig,
): TournamentRound[] {
  const targets =
    config.explicitTargets ??
    computeCleanTargets(
      seedTotal,
      config.semisSize,
      computeEliminationRoundCount(seedTotal, config.semisSize, config.roomSize),
      config.roomSize,
    );
  const rounds: TournamentRound[] = [];

  for (const [index, target] of targets.entries()) {
    const players = index === 0 ? seedTotal : targets[index - 1];
    const distribution = distributeRoomsWithBye(players, config.roomSize, config.oddCountStrategy);
    const split = splitAdvancement(target, distribution.byeCount, distribution.rooms.length);
    rounds.push({
      roundNum: startRoundNum + index,
      players,
      rooms: distribution.rooms,
      byeCount: distribution.byeCount,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: false,
      advPerRoom: split.advPerRoom,
      advTotal: target,
      luckyCount: split.luckyCount,
      ...(config.explicitSeedingOverrides?.[index]
        ? { seedingOverride: config.explicitSeedingOverrides[index] }
        : {}),
    });
  }

  const semisRoundNum = startRoundNum + targets.length;
  const semisRooms = distributeRooms(config.semisSize, config.roomSize);
  rounds.push({
    roundNum: semisRoundNum,
    players: config.semisSize,
    rooms: semisRooms,
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: true,
    isFinal: false,
    advPerRoom: Math.floor(config.finalSize / semisRooms.length),
    advTotal: config.finalSize,
    luckyCount: config.finalSize % semisRooms.length,
    numGames: config.semisGames,
  });
  rounds.push({
    roundNum: semisRoundNum + 1,
    players: config.finalSize,
    rooms: [config.finalSize],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: true,
    advPerRoom: 1,
    advTotal: 1,
    luckyCount: 0,
    numGames: config.finalsGames,
  });

  return rounds;
}
