import { describe, expect, it } from 'vitest';
import { replayBracketPools } from '../bracket-replay';
import { drawnAheadStatus } from '../redraw';
import { isRoundDone, previousColumnStart, roundsInPlay, usesDependencyPlay } from '../round-columns';
import { scoreKeysForPosition } from '../scoring';
import type { TournamentState } from '../types';
import { canGoBack, goBack, isRoundScored } from '../waterfall-steps';
import {
  CASES,
  STRATEGIES,
  atEntry,
  drawsOf,
  indexOf,
  indexes,
  onlyFinalInPlay,
  playColumns,
  pressed,
  scoreRound,
} from './dependency-play-fixtures';
import { buildQualWaterfall, playToQualificationExit, withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * Previous in dependency play: the last press is undone while nothing it drew has a score, else it is reopened.
 * A pool may list its units in another order after an undo (no draw reads that order), so states are compared
 * with each pool sorted by name.
 */

const comparable = (state: TournamentState): TournamentState => ({
  ...state,
  pendingBracketSeeds: Object.fromEntries(
    Object.entries(state.pendingBracketSeeds)
      .filter(([, seeds]) => seeds.length > 0)
      .map(([destination, seeds]) => [destination, [...seeds].sort((a, b) => a.name.localeCompare(b.name))]),
  ),
});

/** Every place a unit waits or plays in right now: the pools and the line-ups of the rounds in play. */
function placesOf(state: TournamentState): string[] {
  const pooled = Object.values(state.pendingBracketSeeds).flatMap((seeds) => seeds.map((seed) => seed.name));
  const playing = roundsInPlay(state).flatMap((index) =>
    (state.assignments[index] ?? []).map((entry) => entry.name),
  );
  return [...pooled, ...playing];
}

/** Swaps the best and the worst score of room 1 of a round: who advances from it changes. */
function swapExtremes(state: TournamentState, roundIndex: number): TournamentState {
  const seats = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === 1);
  const keys = seats.map((_, position) => scoreKeysForPosition({ roundIndex, room: 1, position })[0]);
  const ranked = [...keys].sort(
    (first, second) => (state.scores[second] as number) - (state.scores[first] as number),
  );
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return { ...state, scores: { ...state.scores, [best]: state.scores[worst], [worst]: state.scores[best] } };
}

describe.each(CASES)('Previous right after a press undoes it: $label', (testCase) => {
  const entry = atEntry(testCase.count, testCase.graph, testCase.setup);

  it.each(Object.entries(STRATEGIES))(
    '%s: at every press, Previous returns the state as it was before the press',
    (_name, strategy) => {
      let state = withDependencyPlay(entry);
      let presses = 0;
      for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
        const unscored = roundsInPlay(state).filter(
          (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
        );
        for (const index of strategy(state, unscored, guard)) state = scoreRound(state, index);
        const before = state;
        state = pressed(before);
        const snapshot = structuredClone(state);
        const back = goBack(state);
        expect(comparable(back)).toEqual(comparable(before));
        expect(state, 'goBack leaves its input alone').toEqual(snapshot);
        presses += 1;
      }
      expect(presses).toBeGreaterThan(2);
    },
  );

  it('from the entry, Previous returns to the pooling rounds and Next Round draws the entry again, the same', () => {
    const played = withDependencyPlay(entry);
    expect(canGoBack(played)).toBe(true);
    const pooling = goBack(played);
    expect(usesDependencyPlay(pooling)).toBe(false);
    expect(pooling.curRound).toBe(entry.rounds.findIndex((round) => round.isWaterfall) - 1);
    const forward = pressed(pooling);
    expect(comparable(forward)).toEqual(comparable(played));
  });

  it('one press, then back to the pooling rounds: the entry column with scores stays, and plays on to the same draws', () => {
    const scored = ['R4U', 'R4L'].length
      ? roundsInPlay(withDependencyPlay(entry)).reduce(
          (state, index) => scoreRound(state, index),
          withDependencyPlay(entry),
        )
      : entry;
    const first = pressed(scored);
    const pooling = goBack(goBack(first));
    expect(usesDependencyPlay(pooling)).toBe(false);
    const forward = pressed(pooling);
    expect(comparable(forward)).toEqual(comparable(scored));
    expect(drawsOf(playPastDependency(forward))).toEqual(drawsOf(playColumns(entry)));
  });
});

/** Dependency play to the Final, every round in play scored each step (the Final is drawn, not scored). */
function playPastDependency(start: TournamentState): TournamentState {
  let state = start;
  for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
    for (const index of roundsInPlay(state)) {
      if (!state.rounds[index].isFinal && !isRoundScored(state, index)) state = scoreRound(state, index);
    }
    state = pressed(state);
  }
  return state;
}

describe('a correction before the next press', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const scoredRound4 = scoreRound(scoreRound(entry, at('R4U')), at('R4L'));

  it('the next press draws what the corrected scores say, as if the earlier press never happened', () => {
    const first = pressed(scoredRound4);
    const corrected = swapExtremes(goBack(first), at('R4U'));
    const second = pressed(corrected);
    const fresh = pressed(swapExtremes(scoredRound4, at('R4U')));
    expect(comparable(second)).toEqual(comparable(fresh));
    expect(second.assignments[at('SemiA')]).not.toEqual(first.assignments[at('SemiA')]);
  });
});

describe('a draw with a score stays: the press is reopened, not undone', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
  const withScoredSemiA = scoreRound(afterRound4, at('SemiA'));

  it('keeps every draw and puts the sent rounds back in play', () => {
    const back = goBack(withScoredSemiA);
    expect(back.waterfallSteps).toEqual([{ ...afterRound4.waterfallSteps[0], reopened: true }]);
    expect(back.assignments).toEqual(withScoredSemiA.assignments);
    expect(back.pendingBracketSeeds).toEqual(withScoredSemiA.pendingBracketSeeds);
    expect(roundsInPlay(back)).toEqual(indexes(back, 'R4U', 'R4L', 'SemiA', 'R5L', 'R5R'));
    expect(back.curRound).toBe(Math.min(at('R4U'), at('R4L')));
    expect(withScoredSemiA.waterfallSteps[0].reopened).toBeUndefined();
  });

  it('a correction in the reopened round changes no draw, and the next press adds no unit twice', () => {
    const back = swapExtremes(goBack(withScoredSemiA), at('R4U'));
    const scored = scoreRound(scoreRound(back, at('R5L')), at('R5R'));
    const before = scored.assignments;
    const next = pressed(scored);
    for (const label of ['R4U', 'R4L', 'SemiA', 'R5L', 'R5R']) {
      expect(next.assignments[at(label)]).toEqual(before[at(label)]);
    }
    const places = placesOf(next);
    expect(new Set(places).size).toBe(places.length);
    expect(next.waterfallSteps.map((step) => step.reopened)).toEqual([undefined, undefined]);
    expect(next.waterfallSteps.at(-1)?.sent).not.toContain(at('R4U'));
  });

  it('pressed from the pooling rounds, steps forward to the bracket unchanged, flags cleared', () => {
    const scored = scoreRound(scoreRound(withScoredSemiA, at('R5L')), at('R5R'));
    let state = goBack(scored);
    expect(state.waterfallSteps[0].reopened).toBe(true);
    state = goBack(state);
    expect(usesDependencyPlay(state)).toBe(false);
    const forward = pressed(state);
    expect(forward.waterfallSteps).toEqual([{ ...afterRound4.waterfallSteps[0] }]);
    expect(comparable(forward)).toEqual(comparable(scored));
    expect(forward.assignments).toEqual(scored.assignments);
  });
});

describe('Previous with a later round scored: the example\'s "correct R5L" row', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
  const afterRound5 = pressed(scoreRound(scoreRound(afterRound4, at('R5L')), at('R5R')));
  const scoredR6L = scoreRound(afterRound5, at('R6L'));

  it('reopens the press that drew R6L, then the one before it, then returns to the pooling rounds', () => {
    const first = goBack(scoredR6L);
    expect(first.waterfallSteps.map((step) => step.reopened)).toEqual([undefined, true]);
    expect(first.assignments[at('R6L')]).toEqual(scoredR6L.assignments[at('R6L')]);
    expect(roundsInPlay(first)).toEqual(indexes(first, 'SemiA', 'R5L', 'R5R', 'R6L', 'R6R'));
    const second = goBack(first);
    expect(second.waterfallSteps.map((step) => step.reopened)).toEqual([true, true]);
    expect(roundsInPlay(second)).toEqual(indexes(second, 'R4U', 'R4L', 'SemiA', 'R5L', 'R5R', 'R6L', 'R6R'));
    const third = goBack(second);
    expect(usesDependencyPlay(third)).toBe(false);
    expect(canGoBack(second)).toBe(true);
    expect(third.curRound).toBe(entry.rounds.findIndex((round) => round.isWaterfall) - 1);
  });

  it('a correction in R5L changes no draw: R6L and R6R stay as drawn', () => {
    const reopened = goBack(scoredR6L);
    const corrected = swapExtremes(reopened, at('R5L'));
    const next = pressed(corrected);
    expect(next.assignments[at('R6L')]).toEqual(scoredR6L.assignments[at('R6L')]);
    expect(next.assignments[at('R6R')]).toEqual(scoredR6L.assignments[at('R6R')]);
    const places = placesOf(next);
    expect(new Set(places).size).toBe(places.length);
  });

  it('forward from the pooling rounds returns to where it was', () => {
    const pooling = goBack(goBack(goBack(scoredR6L)));
    const forward = pressed(pooling);
    expect(comparable(forward)).toEqual(comparable(scoredR6L));
  });
});

describe('a correction made while a step was reopened', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);
  const names = (state: TournamentState, label: string) =>
    (state.assignments[at(label)] ?? []).map((unit) => unit.name);

  /**
   * R4U finished, R4L not: a press sends R4U and draws SemiA. SemiA is scored and Previous reopens that press. R4U is
   * corrected so that its best and its worst unit trade places (no draw changes), then R4L is scored and a press sends
   * R4L and SemiA and draws R5L and R5R, which stay unscored.
   */
  function pressAfterCorrection(): TournamentState {
    const first = pressed(scoreRound(entry, at('R4U')));
    const reopened = goBack(scoreRound(first, at('SemiA')));
    expect(reopened.waterfallSteps[0].reopened).toBe(true);
    const corrected = swapExtremes(reopened, at('R4U'));
    return pressed(scoreRound(corrected, at('R4L')));
  }

  it('Previous does not undo the press when the corrected scores no longer explain the pools', () => {
    const state = pressAfterCorrection();
    expect(state.assignments[at('R5L')].length).toBeGreaterThan(0);
    const back = goBack(state);
    expect(back.waterfallSteps.at(-1)?.reopened).toBe(true);
    expect(back.assignments).toEqual(state.assignments);
  });

  it('plays on with every unit of R4U and R4L in exactly one of SemiA, R5L and R5R', () => {
    const back = goBack(pressAfterCorrection());
    const played = playPastDependency(back);
    const next = ['SemiA', 'R5L', 'R5R'].flatMap((label) => names(played, label));
    const before = [...names(played, 'R4U'), ...names(played, 'R4L')];
    expect(new Set(next).size).toBe(next.length);
    expect(new Set(next)).toEqual(new Set(before));
  });
});

describe('Previous under a reopened step', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);

  it('reopens an earlier press whose draw has no score, instead of undoing it beneath a reopened one', () => {
    // Press 1 sends R4U and draws SemiA, left unscored. Press 2 sends R4L and draws R5L and R5R; R5L is scored.
    const first = pressed(scoreRound(entry, at('R4U')));
    const second = pressed(scoreRound(first, at('R4L')));
    expect(second.waterfallSteps.map((step) => step.drew)).toEqual([
      [at('SemiA')],
      indexes(second, 'R5L', 'R5R'),
    ]);
    const scored = scoreRound(second, at('R5L'));
    const once = goBack(scored);
    expect(once.waterfallSteps.map((step) => step.reopened)).toEqual([undefined, true]);
    const twice = goBack(once);
    expect(twice.waterfallSteps.map((step) => step.reopened)).toEqual([true, true]);
    expect(twice.assignments).toEqual(scored.assignments);
    expect(twice.pendingBracketSeeds).toEqual(scored.pendingBracketSeeds);
  });
});

describe('a reopened bracket whose only score is cleared', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);

  it('is redrawn from the pooling rounds with no presses left, and plays on to the draws of column play', () => {
    // A confirmed press sends R4U and R4L unscored and draws SemiA, R5L and R5R; SemiA is scored, so Previous reopens.
    const pressedUnscored = pressed(entry);
    expect(pressedUnscored.waterfallSteps).toHaveLength(1);
    const scored = scoreRound(pressedUnscored, at('SemiA'));
    const pooling = goBack(goBack(scored));
    expect(usesDependencyPlay(pooling)).toBe(false);
    expect(pooling.waterfallSteps).toHaveLength(1);
    // The organiser clears SemiA's scores: nothing drawn has a score, so Next Round re-draws.
    const prefix = `r${at('SemiA')}-`;
    const cleared = {
      ...pooling,
      scores: Object.fromEntries(Object.entries(pooling.scores).filter(([key]) => !key.startsWith(prefix))),
    };
    expect(drawnAheadStatus(cleared, cleared.curRound)).toBe('redraw');
    const forward = pressed(cleared);
    expect(forward.waterfallSteps).toEqual([]);
    expect(usesDependencyPlay(forward)).toBe(true);
    expect(roundsInPlay(forward)).toEqual(indexes(forward, 'R4U', 'R4L'));
    expect(drawsOf(forward)).toEqual(drawsOf(entry));
    expect(drawsOf(playPastDependency(forward))).toEqual(drawsOf(playColumns(entry)));
  });
});

describe('what Previous does outside dependency play', () => {
  it('goes to the column before, as it always did', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37, UPPER_LOWER_GRAPH, {}, { columns: true }));
    const inBracket = pressed(exit);
    expect(usesDependencyPlay(inBracket)).toBe(false);
    expect(canGoBack(inBracket)).toBe(true);
    expect(goBack(inBracket).curRound).toBe(previousColumnStart(inBracket));
    expect(canGoBack({ ...inBracket, curRound: 0 })).toBe(false);
  });
});

describe('replaying the rounds of a set', () => {
  it('gives the pools the number form gives, for the rounds before a column', () => {
    const entry = atEntry(37, UPPER_LOWER_GRAPH);
    const state = pressed(scoreRound(scoreRound(entry, indexOf(entry, 'R4U')), indexOf(entry, 'R4L')));
    const before = indexOf(state, 'R5R');
    const byNumber = replayBracketPools(state, before);
    const bySet = replayBracketPools(state, new Set(Array.from({ length: before }, (_, index) => index)));
    expect([...bySet.pools]).toEqual([...byNumber.pools]);
    expect([...bySet.lucky]).toEqual([...byNumber.lucky]);
  });

  it('replays only the rounds it is given, not a prefix', () => {
    const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
    const at = (label: string) => indexOf(entry, label);
    const state = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
    const pooling = new Set(Array.from({ length: at('R4U') }, (_, index) => index));
    const onlyR4U = replayBracketPools(state, new Set([...pooling, at('R4U')]));
    const destinations = [...onlyR4U.pools.keys()];
    // R4U sends to SemiA and R5L; R4L's units (to R5L and R5R) are not replayed, so R5R has no pool.
    expect(destinations).toContain(at('SemiA'));
    expect(destinations).not.toContain(at('R5R'));
    expect(isRoundDone(state, at('R4L'))).toBe(true);
  });
});
