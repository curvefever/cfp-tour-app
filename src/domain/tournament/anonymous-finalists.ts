import type { AnonymousFinalist, TournamentState } from './types';

/** A Final with more finalists than this can't be anonymous: the aliases would outgrow the card. */
export const MAX_ANONYMOUS_FINALISTS = 10;

/** The aliases `Finalist-1…n` for a line-up, in seat order, none connected yet. */
export function finalistAliasesFor(names: readonly string[]): AnonymousFinalist[] {
  return names.map((realKey, index) => ({ alias: `Finalist-${index + 1}`, realKey, connected: false }));
}

function isLineup(finalists: readonly AnonymousFinalist[], names: readonly string[]): boolean {
  const real = new Set(finalists.map((finalist) => finalist.realKey));
  return finalists.length === names.length && names.every((name) => real.has(name));
}

/**
 * The list of anonymous finalists for the Final as it is drawn now. It belongs to one line-up: kept while its finalists
 * are exactly the Final's (same names, any seat order, so aliases and `connected` marks stay), rebuilt when the line-up
 * differs, empty when the Final is not drawn or has no marked game. The marks (`anonymousGames`) are never touched, except
 * on a Final too large to be anonymous, which loses them with the list.
 */
export function withFinalistAliasesForLineup(state: TournamentState): TournamentState {
  const roundIndex = state.rounds.findIndex((round) => round.isFinal);
  const round = state.rounds[roundIndex];
  const names = (state.assignments[roundIndex] ?? []).map((entry) => entry.name);
  const emptied = (): TournamentState =>
    state.anonymousFinalists.length === 0 ? state : { ...state, anonymousFinalists: [] };
  if (!round || names.length === 0 || !round.anonymousGames?.length) return emptied();
  if (names.length > MAX_ANONYMOUS_FINALISTS) {
    const { anonymousGames: _marks, ...unmarked } = round;
    const rounds = state.rounds.map((entry, index) => (index === roundIndex ? unmarked : entry));
    return { ...state, rounds, anonymousFinalists: [] };
  }
  if (isLineup(state.anonymousFinalists, names)) return state;
  return { ...state, anonymousFinalists: finalistAliasesFor(names) };
}
