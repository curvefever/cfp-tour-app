import { kingsValleyComputeAdvancement } from './advancement';
import { generatedConfig } from './generated-config';
import { kingsValleyBracketPhase } from './kings-valley';
import {
  cloneForTransition,
  MISSING_ROOM_SIZE_MESSAGE,
  reserveWindowAtCurrentRound,
  type RoundAdvanceResult,
  type RoundFitFailure,
} from './round-advance-tools';
import { applyMatchFormats } from './round-match-formats';
import { sequentialSeed } from './seeding';
import type { TournamentState } from './types';

/**
 * Next Round in Kings Valley: the rest of the ladder is planned again when the units reaching it differ from the plan
 * (also at the hop into the first Kings Valley round, which `transitions.ts` makes), and each hop seats the survivors
 * in their order.
 */

function malformedKingsValleyFinalMessage(actual: number): string {
  const reaching = actual <= 0 ? 'Nobody' : `Only ${actual} unit`;
  return `Can't advance -- ${reaching} would reach the Final, which needs at least 2 to play. This usually means enough units were removed mid-tournament; check Manage Teams before advancing.`;
}

/**
 * Re-plans the rest of Kings Valley (from `nextIndex` on, including the
 * Final) whenever the real survivor count reaching it differs from what was
 * planned at generation time -- a removal shrinking a room, or a reserve
 * added in the first Kings Valley round's still-open window, can otherwise
 * leave `sequentialSeed` seating too few (a new lone room, or an empty room)
 * or silently dropping the extra as if eliminated. Also self-heals an
 * already-generated stuck head-to-head field (planned 0 cuts per round):
 * its real per-round cut differs from the stale plan,
 * so the next advance re-plans the tail through the fixed formula instead.
 * A no-op (returns null, leaves `state` untouched) when the pool already
 * matches the plan.
 */
export function fitKingsValleyTail(
  state: TournamentState,
  nextIndex: number,
  poolSize: number,
): RoundFitFailure | null {
  const nextRound = state.rounds[nextIndex];
  const plannedSeats = nextRound.rooms.reduce((total, size) => total + size, 0);
  if (plannedSeats === poolSize) return null;

  const config = generatedConfig(state);
  if (!config) {
    return { reason: 'missing-room-size', message: MISSING_ROOM_SIZE_MESSAGE };
  }
  const { roomSize } = config;
  // kingsValleyBracketPhase always converges to a Final at >= 2 once it
  // starts at >= 2 (the roomSizes.length <= 1 collapse only ever fires once
  // total has shrunk to at most roomSize.max, never below its own starting
  // point) -- so this is the one place a too-small pool needs to be caught,
  // matching the ordinary/double-elimination paths' own malformed-Final guards.
  if (poolSize < 2) {
    return { reason: 'malformed-final', message: malformedKingsValleyFinalMessage(poolSize) };
  }

  // Anchored to the FIRST Kings Valley round's own roundNum, not this
  // re-fit's nextRound, so a stuck field re-planned mid-ladder doesn't get a
  // fresh MAX_KINGS_VALLEY_ROUNDS budget it already partly spent. Always
  // found by construction at both call sites (advanceKingsValley and the
  // `seatFirstKingsValleyRound` only run once a Kings Valley round already exists at or
  // before nextIndex); the fallback is a last-resort defensive default.
  const firstKvIndex = state.rounds.findIndex((round) => round.isKingsValley);
  const capStartRoundNum = state.rounds[firstKvIndex]?.roundNum ?? nextRound.roundNum;
  const oldFinal = state.rounds[state.rounds.length - 1];

  const builtTail = kingsValleyBracketPhase(poolSize, nextRound.roundNum, { roomSize }, capStartRoundNum);
  // The re-planned rounds play their stage's format (the Final's, a live change included, is kept in the config).
  const rounds = applyMatchFormats(
    [...state.rounds.slice(0, nextIndex), ...builtTail],
    state.gamemodeConfig,
    nextIndex,
  );
  const newTail = rounds.slice(nextIndex);
  const newFinal = newTail[newTail.length - 1];
  if (newFinal?.isFinal && oldFinal?.isFinal) {
    newTail[newTail.length - 1] = { ...newFinal, anonymousGames: oldFinal.anonymousGames };
  }

  state.rounds = [...state.rounds.slice(0, nextIndex), ...newTail];
  state.byes = [...state.byes.slice(0, nextIndex), ...newTail.map(() => [])];
  state.luckyLosers = [...state.luckyLosers.slice(0, nextIndex), ...newTail.map(() => [])];
  return null;
}

/**
 * Kings Valley's advance step: merge each room's promote/stay/demote bands
 * into one flat best-to-worst survivor order (kingsValleyComputeAdvancement),
 * re-fit the rest of the ladder to that real count if it differs from the
 * plan (fitKingsValleyTail), then slice the order into the next round's
 * (possibly just-refitted) room sizes (sequentialSeed). Eliminated names need
 * no bookkeeping of their own -- they're simply absent from the next round's
 * assignments, which is already computeRankings()'s existing elimination
 * signal for any round that doesn't set round.bracket.
 */
export function advanceKingsValley(input: TournamentState, roundIndex: number): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { nextRoomOrder } = kingsValleyComputeAdvancement(state, roundIndex);
  const nextIndex = roundIndex + 1;
  const fitFailure = fitKingsValleyTail(state, nextIndex, nextRoomOrder.length);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  const nextRound = state.rounds[nextIndex];
  state.assignments[nextIndex] = sequentialSeed(nextRoomOrder, nextRound.rooms);
  state.curRound = nextIndex;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}
