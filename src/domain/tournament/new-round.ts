import type { TournamentRound } from './types';

/** What a round of any kind has to say; every other field of `TournamentRound` is optional. */
type RoundFields = Pick<TournamentRound, 'roundNum' | 'players' | 'rooms' | 'advTotal'> &
  Partial<TournamentRound>;

/**
 * A round as the builders write it: not a qualification, warm-up, Semis or Final round, with no byes, no lucky
 * losers and no advancement per room, unless the builder says otherwise. Each builder gives only what is special
 * about its round.
 */
export function newRound(fields: RoundFields): TournamentRound {
  return {
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: false,
    advPerRoom: null,
    luckyCount: 0,
    ...fields,
  };
}
