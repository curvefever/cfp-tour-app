import { describe, expect, it } from 'vitest';
import { flagFinalGameAnonymous, renameIndividual, resetTournamentState } from '../mutations';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { roundsInPlay } from '../round-columns';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { AnonymousFinalist, TournamentState } from '../types';
import { withFinalistAliasesForLineup } from '../anonymous-finalists';
import { goBack } from '../waterfall-steps';
import { expectConsistent } from './consistency';
import { atEntry, STRATEGIES, pressed, playDependency } from './dependency-play-fixtures';
import { generated, buildAssignments, buildRound } from './test-fixtures';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * The list behind the "Finalist-1…n" aliases belongs to one Final line-up: it is rebuilt when the line-up it was
 * made for is thrown away or drawn again, while the marked games stay marked.
 */

const alias = (realKey: string, index: number): AnonymousFinalist => ({
  alias: `Finalist-${index + 1}`,
  realKey,
  connected: false,
});

function finalWith(names: string[], overrides: Partial<TournamentState> = {}): TournamentState {
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    rounds: [
      buildRound({ roundNum: 1, isFinal: true, rooms: [names.length], players: names.length, numGames: 3 }),
    ],
    assignments: [buildAssignments(names, [names.length])],
    started: true,
    ...overrides,
  });
}

describe('Back to draft and Generate', () => {
  it('empties the list and keeps the mark; the next Final draw lists its own finalists', () => {
    const flagged = flagFinalGameAnonymous(finalWith(['P1', 'P2']), 2);
    expect(flagged.anonymousFinalists.map((entry) => entry.realKey)).toEqual(['P1', 'P2']);

    const reset = resetTournamentState(flagged);
    expectConsistent(reset);
    expect(reset.anonymousFinalists).toEqual([]);
    expect(reset.rounds[0].anonymousGames).toEqual([2]);

    const redrawn = { ...reset, assignments: [buildAssignments(['Q1', 'Q2'], [2])] };
    expect(withFinalistAliasesForLineup(redrawn).anonymousFinalists).toEqual([
      alias('Q1', 0),
      alias('Q2', 1),
    ]);
  });

  it('Generate starts with no list, whatever list the state held', () => {
    const stale: TournamentState = {
      ...generated(13, { gameFormat: 'ffa-individual' }),
      anonymousFinalists: [alias('P1', 0), alias('P2', 1)],
    };
    const result = generateTournament(
      stale,
      createDefaultSetup({ gameFormat: 'ffa-individual', poolingPhase: 'qual-table', qualAdv: '16' }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(result.message);
    expect(result.state.anonymousFinalists).toEqual([]);
  });
});

describe('the list follows the line-up of the Final', () => {
  it('is kept as it is while its finalists are exactly the line-up, in any seat order', () => {
    const flagged = flagFinalGameAnonymous(finalWith(['P1', 'P2', 'P3']), 1);
    const connected = {
      ...flagged,
      anonymousFinalists: flagged.anonymousFinalists.map((entry) => ({ ...entry, connected: true })),
      assignments: [buildAssignments(['P3', 'P1', 'P2'], [3])],
    };
    expect(withFinalistAliasesForLineup(connected)).toBe(connected);
  });

  it('is rebuilt when one finalist differs, and is empty with no draw or no marked game', () => {
    const flagged = flagFinalGameAnonymous(finalWith(['P1', 'P2', 'P3']), 1);
    const changed = { ...flagged, assignments: [buildAssignments(['P1', 'P2', 'P9'], [3])] };
    expect(withFinalistAliasesForLineup(changed).anonymousFinalists).toEqual([
      alias('P1', 0),
      alias('P2', 1),
      alias('P9', 2),
    ]);
    expect(withFinalistAliasesForLineup({ ...flagged, assignments: [] }).anonymousFinalists).toEqual([]);
    const unmarked = { ...flagged, rounds: [{ ...flagged.rounds[0], anonymousGames: [] }] };
    expect(withFinalistAliasesForLineup(unmarked).anonymousFinalists).toEqual([]);
  });

  it('drops the list and the marks of a Final too large to be anonymous', () => {
    const names = Array.from({ length: 11 }, (_, index) => `P${index + 1}`);
    const state = finalWith(names, { anonymousFinalists: [alias('P1', 0)] });
    const marked = { ...state, rounds: [{ ...state.rounds[0], anonymousGames: [1] }] };
    const result = withFinalistAliasesForLineup(marked);
    expect(result.anonymousFinalists).toEqual([]);
    expect(result.rounds[0].anonymousGames).toBeUndefined();
  });

  it('follows a rename of a finalist (the list and the line-up both carry the new name)', () => {
    const flagged = flagFinalGameAnonymous(finalWith(['P1', 'P2']), 1);
    const renamed = renameIndividual(flagged, 'P1', 'P1b');
    expect(renamed.anonymousFinalists.map((entry) => entry.realKey)).toEqual(['P1b', 'P2']);
  });
});

describe('Previous and Next Round in the upper and lower bracket (FFA 37, qualification table)', () => {
  const atFinal = () => playDependency(atEntry(37, UPPER_LOWER_GRAPH), STRATEGIES['all at once']);
  const finalIndex = (state: TournamentState) => state.rounds.findIndex((round) => round.isFinal);
  const finalists = (state: TournamentState) =>
    state.assignments[finalIndex(state)].map((entry) => entry.name);

  /** Swaps the best and the worst score of room 1 of a round: who advances from it changes. */
  function swapExtremes(state: TournamentState, roundIndex: number): TournamentState {
    const seats = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === 1);
    const keys = seats.map((_, position) => scoreKeysForPosition({ roundIndex, room: 1, position })[0]);
    const ranked = [...keys].sort((a, b) => (state.scores[b] as number) - (state.scores[a] as number));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    return {
      ...state,
      scores: { ...state.scores, [best]: state.scores[worst], [worst]: state.scores[best] },
    };
  }

  it('names the new finalists after a corrected score changes who reaches the Final, and keeps the mark', () => {
    const final = atFinal();
    const flagged = flagFinalGameAnonymous(final, 1);
    expect(flagged.anonymousFinalists).toHaveLength(finalists(final).length);
    expectConsistent(flagged);

    let back = goBack(flagged);
    expect(back.anonymousFinalists).toEqual([]);
    expectConsistent(back);
    expect(back.rounds[finalIndex(back)].anonymousGames).toEqual([1]);
    expect(back.assignments[finalIndex(back)] ?? []).toHaveLength(0);
    for (const index of roundsInPlay(back)) back = swapExtremes(back, index);
    const next = pressed(back);
    expectConsistent(next);

    expect(finalists(next)).not.toEqual(finalists(final));
    expect(next.anonymousFinalists.map((entry) => entry.realKey)).toEqual(finalists(next));
    expect(next.anonymousFinalists.map((entry) => entry.alias)).toEqual(
      finalists(next).map((_, index) => `Finalist-${index + 1}`),
    );
    expect(next.rounds[finalIndex(next)].anonymousGames).toEqual([1]);
  });

  it('gives the same list, aliases included, after Previous and Next Round with the same finalists', () => {
    const flagged = flagFinalGameAnonymous(atFinal(), 1);
    const again = pressed(goBack(flagged));
    expectConsistent(again);
    expect(again.anonymousFinalists).toEqual(flagged.anonymousFinalists);
    expect(again.rounds[finalIndex(again)].anonymousGames).toEqual([1]);
  });
});
