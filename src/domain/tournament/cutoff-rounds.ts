import type { TournamentRound, TournamentState } from './types';

/** Which rounds are cut by cumulative standings instead of per room, read from the shape of the rounds alone. */

export function isLastStandingsRound(state: TournamentState, roundIndex: number): boolean {
  const round = state.rounds[roundIndex];
  const nextRound = state.rounds[roundIndex + 1];
  return Boolean(
    state.cfg.poolingPhase !== 'none' &&
    (round?.isQual || round?.isSwiss) &&
    !(nextRound?.isQual || nextRound?.isSwiss),
  );
}

/** The last Group Stage round: a group round that no group round follows. */
export function isLastGroupStageRound(rounds: readonly TournamentRound[], roundIndex: number): boolean {
  return Boolean(rounds[roundIndex]?.isGroupStage && !rounds[roundIndex + 1]?.isGroupStage);
}

/**
 * True for a round whose advancement is decided by cumulative standings, not
 * per room: the last Qualification Table/Swiss round or the last Group Stage
 * round. Shared by the display (computeStandingsCutoffAdvancing) and the
 * transition, so the two can never disagree about which round is a cut-off.
 */
export function isStandingsCutoffRound(state: TournamentState, roundIndex: number): boolean {
  return isLastStandingsRound(state, roundIndex) || isLastGroupStageRound(state.rounds, roundIndex);
}
