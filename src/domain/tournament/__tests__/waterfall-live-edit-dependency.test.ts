import { describe, expect, it } from 'vitest';
import { roundsInPlay, undrawnRounds } from '../round-columns';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { goBack } from '../waterfall-steps';
import { atEntry, indexOf, indexes, onlyFinalInPlay, pressed, scoreRound } from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * Saving an edited graph while the bracket is played by dependency play: the rounds drawn so far are a prefix of the
 * bracket's rounds only in the common shape, so the edit refuses the others, and the draws it leaves are checked
 * against the rounds that are done, not against a column.
 */

const SPREADSHEET = WATERFALL_EXAMPLES.find((example) => example.id === 'spreadsheet-32')?.text ?? '';

const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
const at = (label: string) => indexOf(entry, label);
const graphOf = (state: TournamentState) => state.settings?.waterfallGraph ?? '';

/** R4U and R4L scored and sent: SemiA, R5R and R5L drawn, in play. The reached rounds are the first eight of the bracket's rounds. */
const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));

/** R4U sent alone: SemiA is drawn while R5R, which comes before it, waits for R4L. */
const sentOnlyR4U = pressed(scoreRound(entry, at('R4U')));

describe('the states the edits are tried on', () => {
  it('have drawn rounds that are a prefix, and ones that are not', () => {
    expect(undrawnRounds(afterRound4)).toEqual(indexes(afterRound4, 'R6R', 'R6L', 'SemiB', 'Final'));
    expect(roundsInPlay(sentOnlyR4U)).toEqual(indexes(sentOnlyR4U, 'R4L', 'SemiA'));
    expect(undrawnRounds(sentOnlyR4U)).toContain(at('R5R'));
    expect(at('R5R')).toBeLessThan(at('SemiA'));
  });
});

describe('an edit while the drawn rounds are a prefix', () => {
  it('saves unchanged text and keeps the draws, the pools and the presses', () => {
    const result = applyWaterfallGraphEdit(afterRound4, graphOf(afterRound4));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.assignments.slice(0, afterRound4.assignments.length)).toEqual(
      afterRound4.assignments,
    );
    expect(result.state.pendingBracketSeeds).toEqual(afterRound4.pendingBracketSeeds);
    expect(result.state.waterfallSteps).toEqual(afterRound4.waterfallSteps);
    expect(result.state.rounds.map((round) => round.waterfallColumn)).toEqual(
      afterRound4.rounds.map((round) => round.waterfallColumn),
    );
  });

  it('renames a round that is not drawn yet', () => {
    const result = applyWaterfallGraphEdit(afterRound4, graphOf(afterRound4).replaceAll('SemiB', 'Semi2'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rounds[at('SemiB')].customLabel).toBe('Semi2');
  });

  it('re-routes a round in play before anything it feeds is drawn, redrawing nothing', () => {
    const edited = graphOf(afterRound4)
      .replace('R5L.A: 1-4->R6L, 5-8->R6R', 'R5L.A: 1-4->R6R, 5-8->R6L')
      .replace('R5L.B: 1-4->R6L, 5-8->R6R', 'R5L.B: 1-4->R6R, 5-8->R6L');
    const result = applyWaterfallGraphEdit(afterRound4, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toBeNull();
    expect(result.state.assignments.slice(0, afterRound4.assignments.length)).toEqual(
      afterRound4.assignments,
    );
    expect(result.state.rounds[at('R5L')].waterfallRoutes).not.toEqual(
      afterRound4.rounds[at('R5L')].waterfallRoutes,
    );
  });

  it('redraws the rounds in play that the routing of a done round changes, from the done rounds alone', () => {
    // R4U's ranks 1-4 and 5-8 trade destinations: SemiA and R5L take the other half of R4U. Neither has a score.
    const edited = graphOf(afterRound4)
      .replace('R4U.A: 1-4->SemiA, 5-8->R5L', 'R4U.A: 1-4->R5L, 5-8->SemiA')
      .replace('R4U.B: 1-4->SemiA, 5-8->R5L', 'R4U.B: 1-4->R5L, 5-8->SemiA');
    const result = applyWaterfallGraphEdit(afterRound4, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redrawnRound).toContain('SemiA');
    expect(result.redrawnRound).toContain('R5L');
    const fresh = result.state;
    const r4uTop = new Set(afterRound4.assignments[at('SemiA')].map((seat) => seat.name));
    // SemiA now holds what used to go to R5L from R4U, and the three rounds still seat each unit of R4U and R4L once.
    const seated = ['SemiA', 'R5R', 'R5L'].flatMap((label) =>
      fresh.assignments[at(label)].map((seat) => seat.name),
    );
    expect(new Set(seated).size).toBe(seated.length);
    expect(seated.length).toBe(
      afterRound4.assignments[at('R4U')].length + afterRound4.assignments[at('R4L')].length,
    );
    expect(fresh.assignments[at('SemiA')].map((seat) => seat.name)).not.toEqual([...r4uTop]);
    expect(fresh.waterfallSteps).toEqual(afterRound4.waterfallSteps);
  });

  it('plays on to the Final after an edit', () => {
    const edited = graphOf(afterRound4).replaceAll('SemiB', 'Semi2');
    const result = applyWaterfallGraphEdit(afterRound4, edited);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let state = result.state;
    for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
      for (const index of roundsInPlay(state)) {
        if (!state.rounds[index].isFinal) state = scoreRound(state, index);
      }
      state = pressed(state);
    }
    expect(onlyFinalInPlay(state)).toBe(true);
    expect(state.assignments[indexOf(state, 'Final')].length).toBeGreaterThan(0);
  });
});

describe('an edit while the drawn rounds are not a prefix', () => {
  it('is refused, naming the round to play first', () => {
    const result = applyWaterfallGraphEdit(sentOnlyR4U, graphOf(sentOnlyR4U));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('R5R');
    expect(result.error).toContain('SemiA');
  });

  it('works again once the round is drawn', () => {
    const drawn = pressed(scoreRound(sentOnlyR4U, at('R4L')));
    expect(applyWaterfallGraphEdit(drawn, graphOf(drawn)).ok).toBe(true);
  });
});

describe('an edit while a step is reopened', () => {
  it('is refused, naming the reopened rounds, and works once Next Round sends them on again', () => {
    const reopened = goBack(scoreRound(afterRound4, at('SemiA')));
    expect(reopened.waterfallSteps.at(-1)?.reopened).toBe(true);
    const result = applyWaterfallGraphEdit(reopened, graphOf(reopened));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('R4U');
    expect(result.error).toContain('R4L');
    const sent = pressed(scoreRound(scoreRound(scoreRound(reopened, at('R5L')), at('R5R')), at('SemiA')));
    expect(applyWaterfallGraphEdit(sent, graphOf(sent)).ok).toBe(true);
  });
});

describe('an edit that feeds a drawn round from a round that is not done', () => {
  // R5 is sent, which draws SemiA, R6B and R6C. R6B and R6C are scored and sent, which draws R7A; SemiA is still in play.
  const start = withDependencyPlay(atEntry(32, SPREADSHEET, { qualAdv: '32' }));
  const idx = (label: string) => indexOf(start, label);
  const afterR5 = pressed(scoreRound(start, idx('R5')));
  const beside = pressed(scoreRound(scoreRound(afterR5, idx('R6B')), idx('R6C')));

  it('has R7A drawn beside SemiA in play', () => {
    expect(roundsInPlay(beside)).toEqual(indexes(beside, 'SemiA', 'R7A'));
  });

  it('refuses to route SemiA into R7A, which is drawn without it', () => {
    // Count-neutral: R7A takes SemiA's ranks 5-8 and no longer R6C's ranks 1-4, which go to SemiB.
    const edited = graphOf(beside)
      .replace('SemiA: 1-4->Final, 5-8->SemiB', 'SemiA: 1-4->Final, 5-8->R7A')
      .replace('R6C: 1-4->R7A, 5-8->eliminated', 'R6C: 1-4->SemiB, 5-8->eliminated');
    const result = applyWaterfallGraphEdit(beside, edited);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('SemiA');
    expect(result.error).toContain('R7A');
  });

  it('accepts a re-route of SemiA that feeds only rounds not drawn yet', () => {
    const edited = graphOf(beside).replace('SemiA: 1-4->Final, 5-8->SemiB', 'SemiA: 1-4->SemiB, 5-8->Final');
    expect(applyWaterfallGraphEdit(beside, edited).ok).toBe(true);
  });
});

describe('a column that has started', () => {
  it('counts whole once any of its rounds is drawn: no other round can join it, nor can its rounds move', () => {
    // R4L is sent alone: R5R is drawn, so column 2 has started although SemiA and R5L, its other rounds, are not drawn.
    const sentOnlyR4L = pressed(scoreRound(entry, at('R4L')));
    expect(roundsInPlay(sentOnlyR4L)).toEqual(indexes(sentOnlyR4L, 'R4U', 'R5R'));
    expect(applyWaterfallGraphEdit(sentOnlyR4L, graphOf(sentOnlyR4L)).ok).toBe(true);
    const joined = applyWaterfallGraphEdit(
      sentOnlyR4L,
      graphOf(sentOnlyR4L).replace('R6L = 8', 'R6L = 8 COLUMN 2'),
    );
    expect(joined.ok).toBe(false);
    if (joined.ok) return;
    expect(joined.error.toLowerCase()).toContain('column');
    // And a round of that column that is not drawn yet can't be moved to another column either.
    const moved = applyWaterfallGraphEdit(
      sentOnlyR4L,
      graphOf(sentOnlyR4L).replace('SemiA = 8', 'SemiA = 8 COLUMN 3'),
    );
    expect(moved.ok).toBe(false);
  });

  it('keeps the drawn rounds, and their draws, in an edit made while only part of a column is drawn', () => {
    const sentOnlyR4L = pressed(scoreRound(entry, at('R4L')));
    const result = applyWaterfallGraphEdit(sentOnlyR4L, graphOf(sentOnlyR4L).replaceAll('SemiB', 'Semi2'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.assignments[at('R5R')]).toEqual(sentOnlyR4L.assignments[at('R5R')]);
    expect(result.state.rounds[at('R5R')].customLabel).toBe('R5R');
  });
});
