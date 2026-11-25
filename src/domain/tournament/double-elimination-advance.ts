import { doubleEliminationComputeAdvancement } from './advancement';
import { doubleEliminationContributions } from './bracket-replay';
import { generatedConfig } from './generated-config';
import {
  cloneForTransition,
  MISSING_ROOM_SIZE_MESSAGE,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
  type RoundFitFailure,
} from './round-advance-tools';
import type { SeedCandidate } from './seeding';
import type { TournamentRound, TournamentState } from './types';

/**
 * Next Round in a double elimination (the head-to-head race and the shared Final): the finished round sends its
 * winners and losers into the pools of their next rounds, and the next round is drawn from its pool.
 */

function finalizeDoubleEliminationRound(
  state: TournamentState,
  roundIndex: number,
  chosenByes: SeedCandidate[],
): RoundFitFailure | null {
  const targetRound = state.rounds[roundIndex];
  // Seeding-weight override only applies to a WB round's own continuation
  // into the next WB round -- always single-source, unlike an LB-bound
  // target round, whose pool can also merge players already surviving in
  // LB (attributing one WB round's override to that merged pool would be
  // misapplying it to players who never came from the overridden round).
  const seedingOverride =
    targetRound.bracket === 'winners'
      ? state.rounds.find((round) => round.bracket === 'winners' && round.winnersTo === roundIndex)
          ?.seedingOverride
      : undefined;
  const failure = seedRoundFromPendingPool(state, roundIndex, { chosenByes, seedingOverride });
  if (failure) return failure;

  // Re-read the round: seeding may have replaced it with a fitted copy.
  const seededRound = state.rounds[roundIndex];
  if (seededRound.bracket === 'grand-final') {
    const sourceIndex = state.rounds.findIndex(
      (round) => round.bracket === 'winners' && round.winnersTo === roundIndex,
    );
    if (sourceIndex !== -1) {
      const finalist = doubleEliminationComputeAdvancement(state, sourceIndex).winners[0]?.name;
      if (finalist !== undefined) seededRound.wbFinalistName = finalist;
    }
  }
  return null;
}

/**
 * The race Grand Final always seats exactly 2. The shared Final may seat fewer
 * than planned (a removal that the losers bracket couldn't absorb) but never
 * fewer than 2, and never more than its seats.
 */
function isMalformedDoubleEliminationFinal(finalRound: TournamentRound, arriving: number): boolean {
  if (finalRound.bracket === 'grand-final') return arriving !== finalRound.players;
  return arriving > finalRound.players || arriving < 2;
}

function doubleEliminationFinalMessage(finalRound: TournamentRound, actual: number): string {
  const sharedFinalSeats = actual < 2 ? 'at least 2' : `at most ${finalRound.players}`;
  const required =
    finalRound.bracket === 'grand-final' ? `the required ${finalRound.players}` : sharedFinalSeats;
  return `Can't advance into the Final — ${actual} entrants would arrive instead of ${required}. A mid-tournament withdrawal has likely thrown off the losers bracket's balance too deeply for the usual single-bye recovery to fix automatically; check Manage Teams, or add a replacement, before advancing further.`;
}

export function advanceDoubleElimination(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  if (round.bracket === 'grand-final') {
    return { status: 'noop', reason: 'grand-final', state: input };
  }
  const config = generatedConfig(input);
  if (!config) {
    return {
      status: 'blocked',
      reason: 'missing-room-size',
      message: MISSING_ROOM_SIZE_MESSAGE,
      state: input,
    };
  }
  const { roomSize } = config;
  const state = cloneForTransition(input);
  const { additions, lucky } = doubleEliminationContributions(state, roundIndex);

  const nextIndex = roundIndex + 1;
  const winnersTarget = round.winnersTo;
  const losersTarget = round.losersTo;
  const pendingAt = (target: number | null | undefined) =>
    target != null ? [...(state.pendingBracketSeeds[target] ?? []), ...(additions.get(target) ?? [])] : null;
  const pendingWinners = pendingAt(winnersTarget);
  const pendingLosers = pendingAt(losersTarget);

  let poolAtNext = [...(state.pendingBracketSeeds[nextIndex] ?? [])];
  if (winnersTarget === nextIndex) poolAtNext = pendingWinners ?? [];
  if (losersTarget === nextIndex) poolAtNext = pendingLosers ?? [];
  const nextRound = state.rounds[nextIndex];
  if (nextRound.isFinal && isMalformedDoubleEliminationFinal(nextRound, poolAtNext.length)) {
    return {
      status: 'blocked',
      reason: 'malformed-final',
      message: doubleEliminationFinalMessage(nextRound, poolAtNext.length),
      state: input,
    };
  }

  let chosenByes: SeedCandidate[] = [];
  if (roomSize.min === roomSize.max) {
    const needed = poolAtNext.length % roomSize.ideal;
    // Whatever the odd-count strategy: a removal can leave an odd pool even
    // where the field started even, and a bye is the only way on. Single
    // elimination already does the equivalent through a lone-unit room.
    chosenByes = poolAtNext.slice(0, needed);
  }

  if (winnersTarget != null) {
    state.pendingBracketSeeds[winnersTarget] = pendingWinners ?? [];
  }
  if (losersTarget != null) {
    state.pendingBracketSeeds[losersTarget] = pendingLosers ?? [];
  }
  if (winnersTarget != null && lucky.has(winnersTarget)) {
    state.luckyLosers[winnersTarget] = [
      ...(state.luckyLosers[winnersTarget] ?? []),
      ...(lucky.get(winnersTarget) ?? []),
    ];
  }
  state.curRound = nextIndex;
  const fitFailure = finalizeDoubleEliminationRound(state, nextIndex, chosenByes);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}
