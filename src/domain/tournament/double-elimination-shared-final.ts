import { findNextPosition, toRoundIndex, type RaceDoubleEliminationConfig } from './double-elimination';
import { newRound } from './new-round';
import { distributeRoomsWithBye, isSeatable, splitAdvancement } from './room-distribution';
import { computeCleanTargets, computeEliminationRoundCount, computeTargets } from './single-elimination';
import type { RoomSize, TournamentRound } from './types';

/**
 * Double elimination, the shared-Final variant: rooms of several units, the winners and the losers bracket feeding one
 * Final (`sharedFinalDoubleEliminationBracketPhase`), with the planning that keeps every round one the rooms can seat.
 */

export interface SharedFinalDoubleEliminationConfig extends RaceDoubleEliminationConfig {
  finalSize: number;
  lbQualifiers: number;
  /** Organiser-supplied ordered WB survivor-count targets, replacing the automatic geometric-decay curve entirely when set. Pre-validated by the caller (generation.ts). */
  explicitTargets?: number[];
  /** Organiser-supplied fixed reseed mode per WB round, index-aligned with explicitTargets -- only ever applied to a WB round's own continuation into the next WB round (double-elimination-advance.ts), never an LB-bound drop. */
  explicitSeedingOverrides?: Array<'diversity' | 'balance' | 'random' | undefined>;
}

/** A dropped unit must play its first losers-bracket round within this many winners-bracket rounds -- see forcedLosersSurvivorTarget. */
const MAX_WB_ROUNDS_BEFORE_LB = 2;

/**
 * The genuine cut a losers-bracket round is forced to make once
 * MAX_WB_ROUNDS_BEFORE_LB is reached and computeTargets' own room-size-aware
 * search (snapFriendly) found nothing to cut -- relaxing roomSize.min to 1
 * for just this one computeTargets call lets the same geometric-decay curve
 * propose a real intermediate value instead of either no cut at all (the
 * bug) or collapsing straight to lbQualifiers in one shot (what reusing
 * computeCleanTargets' own single-round fallback would do here -- too
 * aggressive for an early forced round).
 */
function forcedLosersSurvivorTarget(
  players: number,
  lbQualifiers: number,
  roundsLeft: number,
  roomSize: RoomSize,
): number {
  if (players <= lbQualifiers) return players;
  const relaxed = computeTargets(players, lbQualifiers, roundsLeft, { ...roomSize, min: 1 });
  return Math.min(Math.max(relaxed[0], lbQualifiers), players - 1);
}

interface SharedBracketProjection {
  rooms: number[];
  byeCount: number;
  players: number;
  advTotal: number;
  advPerRoom: number;
  luckyCount: number;
}

type SharedWinnersRound = SharedBracketProjection & { dropCount: number };
type SharedLosersRound = SharedBracketProjection & { afterWbIndex: number };

function buildSharedWinnersRound(
  players: number,
  target: number,
  config: SharedFinalDoubleEliminationConfig,
): SharedWinnersRound {
  const distribution = distributeRoomsWithBye(players, config.roomSize, config.oddCountStrategy);
  return {
    ...distribution,
    players,
    advTotal: target,
    ...splitAdvancement(target, distribution.byeCount, distribution.rooms.length),
    dropCount: players - target,
  };
}

/** The candidate nearest `original`; on a tie the higher one (the smaller cut, more units survive). */
function nearestCandidate(original: number, candidates: number[]): number | undefined {
  let best: number | undefined;
  for (const candidate of candidates) {
    if (best === undefined) {
      best = candidate;
      continue;
    }
    const distance = Math.abs(candidate - original);
    const bestDistance = Math.abs(best - original);
    if (distance < bestDistance || (distance === bestDistance && candidate > best)) best = candidate;
  }
  return best;
}

function integersBetween(low: number, high: number): number[] {
  return Array.from({ length: Math.max(0, high - low + 1) }, (_, offset) => low + offset);
}

/** Lever 1: a new survivor target for the previous losers round so that, with the pending drops, this round can be seated. */
function seatableEarlierLosersTarget(
  previous: SharedLosersRound,
  pendingDrop: number,
  config: SharedFinalDoubleEliminationConfig,
): number | undefined {
  const candidates = integersBetween(config.lbQualifiers, previous.players - 1).filter((target) =>
    isSeatable(target + pendingDrop, config.roomSize),
  );
  return nearestCandidate(previous.advTotal, candidates);
}

function retargetLosersRound(round: SharedLosersRound, target: number): void {
  round.advTotal = target;
  Object.assign(round, splitAdvancement(target, round.byeCount, round.rooms.length));
}

/**
 * Lever 3: a new survivor target for winners round `index` such that the
 * round after it is seatable, the curve stays strictly decreasing, and the
 * losers round it feeds (with `otherPlayers` already waiting) is seatable.
 */
function seatableWinnersTarget(
  winners: SharedWinnersRound[],
  index: number,
  otherPlayers: number,
  config: SharedFinalDoubleEliminationConfig,
): number | undefined {
  const current = winners[index];
  const candidates = integersBetween(winners[index + 1].advTotal + 1, current.players - 1).filter(
    (target) =>
      isSeatable(target, config.roomSize) &&
      isSeatable(otherPlayers + current.players - target, config.roomSize),
  );
  return nearestCandidate(current.advTotal, candidates);
}

type SharedSequenceEntry =
  { type: 'wb'; wbIndex: number } | { type: 'lb'; lbIndex: number } | { type: 'final' };

/** Builds a multi-unit bracket where the winners and losers brackets feed one shared final. */
export function sharedFinalDoubleEliminationBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: SharedFinalDoubleEliminationConfig,
): TournamentRound[] {
  const winnersQualifiers = config.finalSize - config.lbQualifiers;
  if (!(config.lbQualifiers >= 1) || !(winnersQualifiers >= 1)) {
    throw new Error(
      `doubleEliminationSharedFinalBracketPhase requires lbQualifiers >= 1 and finalSize - lbQualifiers >= 1 — got lbQualifiers=${config.lbQualifiers}, finalSize=${config.finalSize}.`,
    );
  }

  let winnersTargets: number[];
  if (config.explicitTargets) {
    winnersTargets = config.explicitTargets;
  } else {
    const requestedRounds = computeEliminationRoundCount(seedTotal, winnersQualifiers, config.roomSize);
    if (requestedRounds < 1) {
      throw new Error(
        `doubleEliminationSharedFinalBracketPhase requires at least 1 winners-bracket round — got seedTotal ${seedTotal}, wbQualifiers ${winnersQualifiers}.`,
      );
    }
    winnersTargets = computeCleanTargets(seedTotal, winnersQualifiers, requestedRounds, config.roomSize);
  }
  const winners: SharedWinnersRound[] = winnersTargets.map((target, index) =>
    buildSharedWinnersRound(index === 0 ? seedTotal : winnersTargets[index - 1], target, config),
  );

  const losers: SharedLosersRound[] = [];
  const losersDestinationByWinnersRound: Array<number | null> = Array.from(
    { length: winners.length },
    () => null,
  );
  let losersSurvivors = 0;
  let pendingDrop = 0;
  let pendingFrom: number[] = [];

  for (let winnersIndex = 0; winnersIndex < winners.length; winnersIndex += 1) {
    pendingDrop += winners[winnersIndex].dropCount;
    pendingFrom.push(winnersIndex);
    let players = losersSurvivors + pendingDrop;
    if (players === 0) {
      pendingFrom = [];
      continue;
    }
    if (!isSeatable(players, config.roomSize)) {
      const previous = losers[losers.length - 1];
      const earlierTarget = previous && seatableEarlierLosersTarget(previous, pendingDrop, config);
      const canDefer = pendingFrom.length < MAX_WB_ROUNDS_BEFORE_LB && winnersIndex < winners.length - 1;
      if (earlierTarget !== undefined) {
        retargetLosersRound(previous, earlierTarget);
        losersSurvivors = earlierTarget;
      } else if (canDefer) {
        continue;
      } else if (!config.explicitTargets && winnersIndex < winners.length - 1) {
        const target = seatableWinnersTarget(
          winners,
          winnersIndex,
          players - winners[winnersIndex].dropCount,
          config,
        );
        if (target !== undefined) {
          const round = winners[winnersIndex];
          winners[winnersIndex] = buildSharedWinnersRound(round.players, target, config);
          winners[winnersIndex + 1] = buildSharedWinnersRound(
            target,
            winners[winnersIndex + 1].advTotal,
            config,
          );
          pendingDrop += winners[winnersIndex].dropCount - round.dropCount;
        }
      }
      players = losersSurvivors + pendingDrop;
    }
    const roundsLeft = winners.length - winnersIndex;
    const rawTargets = computeTargets(players, config.lbQualifiers, roundsLeft, config.roomSize);
    let survivorTarget = Math.min(rawTargets[0], players);
    if (survivorTarget === players) {
      if (pendingFrom.length < MAX_WB_ROUNDS_BEFORE_LB) continue;
      const forcedTarget = forcedLosersSurvivorTarget(
        players,
        config.lbQualifiers,
        roundsLeft,
        config.roomSize,
      );
      if (forcedTarget === players) continue;
      survivorTarget = forcedTarget;
    }

    const distribution = distributeRoomsWithBye(players, config.roomSize, config.oddCountStrategy);
    losers.push({
      ...distribution,
      players,
      advTotal: survivorTarget,
      ...splitAdvancement(survivorTarget, distribution.byeCount, distribution.rooms.length),
      afterWbIndex: winnersIndex,
    });
    const losersIndex = losers.length - 1;
    for (const sourceIndex of pendingFrom) {
      losersDestinationByWinnersRound[sourceIndex] = losersIndex;
    }
    pendingFrom = [];
    losersSurvivors = survivorTarget;
    pendingDrop = 0;
  }

  if (pendingFrom.length > 0) {
    throw new Error(
      `doubleEliminationSharedFinalBracketPhase could not route every winners-bracket round's losers to a losers-bracket round — lbQualifiers (${config.lbQualifiers}) may be too large for how many units winners-bracket play actually eliminates from seedTotal ${seedTotal}.`,
    );
  }

  const sequence: SharedSequenceEntry[] = [];
  for (let winnersIndex = 0; winnersIndex < winners.length; winnersIndex += 1) {
    sequence.push({ type: 'wb', wbIndex: winnersIndex });
    for (const [losersIndex, round] of losers.entries()) {
      if (round.afterWbIndex === winnersIndex) {
        sequence.push({ type: 'lb', lbIndex: losersIndex });
      }
    }
  }
  sequence.push({ type: 'final' });

  const finalPosition = sequence.length - 1;
  const losersSequencePosition = (winnersIndex: number): number | null => {
    const destination = losersDestinationByWinnersRound[winnersIndex];
    if (destination === null) return null;
    const position = sequence.findIndex((entry) => entry.type === 'lb' && entry.lbIndex === destination);
    return position === -1 ? null : position;
  };
  return sequence.map((entry, position): TournamentRound => {
    if (entry.type === 'final') {
      return newRound({
        roundNum: startRoundNum + position,
        players: config.finalSize,
        rooms: [config.finalSize],
        isFinal: true,
        advPerRoom: 1,
        advTotal: 1,
        winnersTo: null,
        losersTo: null,
      });
    }

    const isWinners = entry.type === 'wb';
    const source = isWinners ? winners[entry.wbIndex] : losers[entry.lbIndex];
    const nextLosersOrFinal = isWinners
      ? null
      : findNextPosition(sequence, position, (candidate) => candidate.type !== 'wb');
    const winnersTo = isWinners
      ? entry.wbIndex === winners.length - 1
        ? finalPosition
        : findNextPosition(sequence, position, (candidate) => candidate.type === 'wb')
      : nextLosersOrFinal === -1
        ? finalPosition
        : nextLosersOrFinal;
    const losersTo = isWinners ? losersSequencePosition(entry.wbIndex) : null;
    return newRound({
      roundNum: startRoundNum + position,
      players: source.players,
      rooms: source.rooms,
      byeCount: source.byeCount,
      advPerRoom: source.advPerRoom,
      advTotal: source.advTotal,
      luckyCount: source.luckyCount,
      bracket: isWinners ? 'winners' : 'losers',
      winnersTo: toRoundIndex(startRoundNum, winnersTo),
      losersTo: toRoundIndex(startRoundNum, losersTo),
      ...(isWinners && config.explicitSeedingOverrides?.[entry.wbIndex]
        ? { seedingOverride: config.explicitSeedingOverrides[entry.wbIndex] }
        : {}),
    });
  });
}
