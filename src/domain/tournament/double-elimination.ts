import { newRound } from './new-round';
import { distributeRooms, distributeRoomsWithBye } from './room-distribution';
import type { OddCountStrategyKey, RoomSize, TournamentRound } from './types';

/**
 * Double elimination, the race variant: head to head, a winners and a losers bracket that meet in a Grand Final
 * (`raceDoubleEliminationBracketPhase`). The shared-Final variant is in `double-elimination-shared-final.ts`, which
 * takes this file's config type, `findNextPosition` and `toRoundIndex`.
 */

interface BracketPowerShape {
  bracketSize: number;
  numRounds: number;
}

export interface RaceDoubleEliminationConfig {
  roomSize: RoomSize;
  oddCountStrategy?: OddCountStrategyKey;
}

export function nextPowerOf2AndRounds(count: number): BracketPowerShape {
  let bracketSize = 1;
  let numRounds = 0;
  while (bracketSize < count) {
    bracketSize *= 2;
    numRounds += 1;
  }
  return { bracketSize, numRounds };
}

function concentratedByeFirstRound(
  total: number,
  shape: BracketPowerShape,
  roomSize: RoomSize,
): { rooms: number[]; byeCount: number } {
  const byeCount = shape.bracketSize - total;
  return {
    rooms: distributeRooms(total - byeCount, roomSize),
    byeCount,
  };
}

interface RaceBracketProjection {
  rooms: number[];
  byeCount: number;
  players: number;
  advTotal: number;
}

/** A losers round before it has its player and advance counts. */
type RaceLosersRound = { rooms: number[]; byeCount: number };

type RaceSequenceEntry = { type: 'wb'; wbIndex: number } | { type: 'lb'; lbIndex: number } | { type: 'gf' };

export function findNextPosition<T>(
  sequence: readonly T[],
  after: number,
  matches: (entry: T) => boolean,
): number {
  return sequence.findIndex((entry, position) => position > after && matches(entry));
}

export function toRoundIndex(startRoundNum: number, sequencePosition: number | null): number | null {
  return sequencePosition === null || sequencePosition === -1 ? null : startRoundNum - 1 + sequencePosition;
}

/** The winners bracket: every round's rooms and byes, from the whole field down to one. */
function raceWinnersRounds(
  seedTotal: number,
  shape: BracketPowerShape,
  config: RaceDoubleEliminationConfig,
): RaceBracketProjection[] {
  const winnersRoundCount = shape.numRounds;

  const winners: RaceBracketProjection[] = [];
  let total = seedTotal;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    const distribution =
      index === 0
        ? concentratedByeFirstRound(total, shape, config.roomSize)
        : distributeRoomsWithBye(total, config.roomSize, config.oddCountStrategy);
    const advTotal = distribution.rooms.length + distribution.byeCount;
    winners.push({ ...distribution, players: total, advTotal });
    total = advTotal;
  }
  return winners;
}

/** The losers bracket: a round for the first drop, two for each middle winners round, one for the last. */
function raceLosersRounds(
  winners: RaceBracketProjection[],
  config: RaceDoubleEliminationConfig,
): RaceLosersRound[] {
  const winnersRoundCount = winners.length;

  const losers: RaceLosersRound[] = [];
  let losersSurvivors = 0;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    const dropCount = winners[index].rooms.length;
    if (index === 0) {
      const drop = distributeRoomsWithBye(dropCount, config.roomSize, config.oddCountStrategy);
      losers.push(drop);
      losersSurvivors = drop.rooms.length + drop.byeCount;
    } else if (index < winnersRoundCount - 1) {
      const absorb = distributeRoomsWithBye(
        losersSurvivors + dropCount,
        config.roomSize,
        config.oddCountStrategy,
      );
      losers.push(absorb);
      const absorbSurvivors = absorb.rooms.length + absorb.byeCount;
      const survive = distributeRoomsWithBye(absorbSurvivors, config.roomSize, config.oddCountStrategy);
      losers.push(survive);
      losersSurvivors = survive.rooms.length + survive.byeCount;
    } else {
      losers.push(
        distributeRoomsWithBye(losersSurvivors + dropCount, config.roomSize, config.oddCountStrategy),
      );
    }
  }
  return losers;
}

/** The order the rounds are played in: each winners round, then the losers rounds it feeds; the Grand Final last. */
function raceOrderOfPlay(winnersRoundCount: number): RaceSequenceEntry[] {
  const sequence: RaceSequenceEntry[] = [];
  let losersIndex = 0;
  for (let index = 0; index < winnersRoundCount; index += 1) {
    sequence.push({ type: 'wb', wbIndex: index });
    const count = index === 0 || index === winnersRoundCount - 1 ? 1 : 2;
    for (let offset = 0; offset < count; offset += 1) {
      sequence.push({ type: 'lb', lbIndex: losersIndex });
      losersIndex += 1;
    }
  }
  sequence.push({ type: 'gf' });
  return sequence;
}

/** The order of play as the tournament's rounds, each pointing to where its winners and losers go. */
function raceRoundsFromOrder({
  sequence,
  winners,
  losers,
  startRoundNum,
  winnersRoundCount,
}: {
  sequence: RaceSequenceEntry[];
  winners: RaceBracketProjection[];
  losers: RaceLosersRound[];
  startRoundNum: number;
  winnersRoundCount: number;
}): TournamentRound[] {
  const grandFinalPosition = sequence.length - 1;

  return sequence.map((entry, position): TournamentRound => {
    if (entry.type === 'gf') {
      return newRound({
        roundNum: startRoundNum + position,
        players: 2,
        rooms: [2],
        isFinal: true,
        advPerRoom: 1,
        advTotal: 1,
        bracket: 'grand-final',
        winnersTo: null,
        losersTo: null,
        numGames: 1,
      });
    }

    const isWinners = entry.type === 'wb';
    const source: RaceBracketProjection = isWinners
      ? winners[entry.wbIndex]
      : {
          ...losers[entry.lbIndex],
          players:
            losers[entry.lbIndex].rooms.reduce((sum, room) => sum + room, 0) + losers[entry.lbIndex].byeCount,
          advTotal: losers[entry.lbIndex].rooms.length + losers[entry.lbIndex].byeCount,
        };
    const winnersToPosition = isWinners
      ? entry.wbIndex === winnersRoundCount - 1
        ? grandFinalPosition
        : findNextPosition(sequence, position, (candidate) => candidate.type === 'wb')
      : findNextPosition(sequence, position, (candidate) => candidate.type !== 'wb');
    const losersToPosition = isWinners ? position + 1 : null;
    return newRound({
      roundNum: startRoundNum + position,
      players: source.players,
      rooms: source.rooms,
      byeCount: source.byeCount,
      advPerRoom: 1,
      advTotal: source.rooms.length + source.byeCount,
      bracket: isWinners ? 'winners' : 'losers',
      winnersTo: toRoundIndex(startRoundNum, winnersToPosition),
      losersTo: toRoundIndex(startRoundNum, losersToPosition),
      ...(isWinners && entry.wbIndex === 0 ? { bracketPhaseFirstRound: true } : {}),
    });
  });
}

/** Builds a head-to-head double-elimination bracket with a grand final. */
export function raceDoubleEliminationBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: RaceDoubleEliminationConfig,
): TournamentRound[] {
  if (config.roomSize.ideal !== 2) {
    throw new Error(
      `doubleEliminationBracketPhase requires a head-to-head room shape (roomSize.ideal === 2) — got ${config.roomSize.ideal}.`,
    );
  }
  if (config.oddCountStrategy === 'flex') {
    throw new Error(
      'doubleEliminationBracketPhase does not support the "flex" odd-count strategy — a 3-unit room is not double elimination. Use "none" or "bye" instead.',
    );
  }

  const shape = nextPowerOf2AndRounds(seedTotal);
  const winnersRoundCount = shape.numRounds;
  if (winnersRoundCount < 2) {
    throw new Error(
      `doubleEliminationBracketPhase requires at least 2 winners-bracket rounds — got seedTotal ${seedTotal}.`,
    );
  }

  const winners = raceWinnersRounds(seedTotal, shape, config);
  const losers = raceLosersRounds(winners, config);
  const sequence = raceOrderOfPlay(winnersRoundCount);
  return raceRoundsFromOrder({ sequence, winners, losers, startRoundNum, winnersRoundCount });
}
