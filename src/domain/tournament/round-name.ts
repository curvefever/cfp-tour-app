import type { TournamentRound } from './types';

/**
 * A round's own name, for the messages that name a round the organiser wrote: its label from the Custom bracket
 * graph ("SemiA", "6B"), else "Round 4". `bracketRoundLabels` (`bracket.ts`) is the name the Bracket shows, with
 * "Final", "Semis", "WB Round 4" for the built-in rounds; this one never adds those. A missing round reads
 * "Round undefined", as the hand-written copies did.
 */
export function plainRoundName(round: Pick<TournamentRound, 'customLabel' | 'roundNum'> | undefined): string {
  return round?.customLabel ?? `Round ${round?.roundNum}`;
}
