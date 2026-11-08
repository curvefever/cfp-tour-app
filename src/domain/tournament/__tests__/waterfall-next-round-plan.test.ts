import { describe, expect, it } from 'vitest';
import { roundsInPlay } from '../round-columns';
import { finalScoreKey } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { finishedRoundsInPlay, goBack, isRoundScored, nextRoundPlan } from '../waterfall-steps';
import {
  CASES,
  STRATEGIES,
  atEntry,
  indexOf,
  indexes,
  pressed,
  resolveEveryTie,
  scoreGames,
  scoreRound,
  scoreTied,
} from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * What the Bracket's Next Round panel says is what the press does: `nextRoundPlan` is the press's own decision, and
 * `advanceDependencyPlay` follows it. These tests walk the presses and compare the plan with the result.
 */

const sorted = (values: number[]) => [...values].sort((first, second) => first - second);

describe.each(CASES)('the plan is what the press does: $label', (testCase) => {
  const start = withDependencyPlay(atEntry(testCase.count, testCase.graph, testCase.setup));

  it.each(Object.entries(STRATEGIES))('%s: at every press', (_name, strategy) => {
    let state = start;
    let advanced = 0;
    for (let guard = 0; guard < 60; guard += 1) {
      const unscored = roundsInPlay(state).filter(
        (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
      );
      for (const index of strategy(state, unscored, guard)) state = scoreRound(state, index);
      const plan = nextRoundPlan(state);
      const result = advanceTournamentRound(state);
      if (plan.hidden) {
        expect(result.status).toBe('noop');
        break;
      }
      expect(result.status).toBe('advanced');
      if (result.status !== 'advanced') return;
      const step = result.state.waterfallSteps.at(-1);
      expect(plan.blocked).toBeNull();
      expect(plan.sends).toEqual(step?.sent ?? []);
      expect(plan.draws).toEqual(step?.drew ?? []);
      expect(sorted([...plan.staysInPlay, ...plan.draws])).toEqual(sorted(roundsInPlay(result.state)));
      expect(plan.confirm).toBe(finishedRoundsInPlay(state).length === 0);
      for (const { roundIndex } of plan.roomsToConfirm) expect(plan.sends).toContain(roundIndex);
      state = result.state;
      advanced += 1;
    }
    expect(advanced).toBeGreaterThanOrEqual(3);
  });
});

describe('the plan on the upper and lower graph with a Best of 3 SemiA', () => {
  const graph = UPPER_LOWER_GRAPH.replace('SemiA = 8', 'SemiA = 8 BO3');
  const entry = withDependencyPlay(atEntry(37, graph));
  const at = (label: string) => indexOf(entry, label);
  const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
  /** R5L and R5R sent with SemiA at game 1; R6L and R6R drawn beside it. */
  const besideSemiA = pressed(
    scoreRound(scoreRound(scoreGames(afterRound4, at('SemiA'), [1]), at('R5L')), at('R5R')),
  );

  it('sends the finished rounds with no question while SemiA is at game 1, and says what it draws', () => {
    const state = scoreRound(scoreRound(afterRound4, at('R5L')), at('R5R'));
    const plan = nextRoundPlan(scoreGames(state, at('SemiA'), [1]));
    expect(plan.sends).toEqual(indexes(state, 'R5L', 'R5R'));
    expect(plan.draws).toEqual(indexes(state, 'R6L', 'R6R'));
    expect(plan.staysInPlay).toEqual([at('SemiA')]);
    expect(plan.confirm).toBe(false);
    expect(plan.roomsToConfirm).toEqual([]);
    expect(plan.blocked).toBeNull();
  });

  it('with only SemiA in play at game 1 of 3, asks, and lists the partly scored room', () => {
    const state = pressed(scoreRound(scoreRound(besideSemiA, at('R6L')), at('R6R')));
    expect(roundsInPlay(state)).toEqual(
      [at('SemiA'), at('SemiB')].filter((index) => roundsInPlay(state).includes(index)),
    );
    const alone = scoreGames(state, at('SemiA'), [1]);
    const plan = nextRoundPlan(alone);
    expect(plan.confirm).toBe(true);
    expect(plan.sends).toContain(at('SemiA'));
    expect(plan.roomsToConfirm).toContainEqual({ roundIndex: at('SemiA'), room: 1 });
  });

  it('does not list a room of the Final, a decided Best of or a fully scored room', () => {
    const decided = scoreGames(besideSemiA, at('SemiA'), [1, 2]);
    expect(nextRoundPlan(decided).roomsToConfirm).toEqual([]);
    expect(nextRoundPlan(decided).sends).toEqual([at('SemiA')]);
  });

  it('a tie in R6L no longer stops a press while R6R is finished', () => {
    const state = scoreRound(scoreTied(besideSemiA, at('R6L')), at('R6R'));
    const plan = nextRoundPlan(state);
    expect(plan.blocked).toBeNull();
    expect(plan.sends).toEqual([at('R6R')]);
    expect(plan.staysInPlay).toEqual(indexes(state, 'SemiA', 'R6L'));
    expect(advanceTournamentRound(state).status).toBe('advanced');
  });

  it('with nothing finished, a tie or an unanswered 0 blocks it, and the press says the same', () => {
    const tied = scoreTied(besideSemiA, at('R6L'));
    const plan = nextRoundPlan(tied);
    expect(plan.confirm).toBe(true);
    expect(plan.blocked).toBe('pending-ties');
    expect(plan.draws).toEqual([]);
    const result = advanceTournamentRound(tied);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') expect(result.reason).toBe('pending-ties');
    const resolved = resolveEveryTie(tied, at('R6L'));
    expect(nextRoundPlan(resolved).blocked).toBeNull();
  });
});

describe('the plan while a step is reopened', () => {
  const entry = withDependencyPlay(atEntry(37, UPPER_LOWER_GRAPH));
  const at = (label: string) => indexOf(entry, label);

  /** Every round sent on and the Final drawn and given a score, so Previous reopens the press that drew it. */
  function finalScoredAndReopened(): TournamentState {
    let state = entry;
    for (
      let guard = 0;
      guard < 60 && !roundsInPlay(state).every((index) => state.rounds[index].isFinal);
      guard += 1
    ) {
      for (const index of roundsInPlay(state))
        if (!isRoundScored(state, index)) state = scoreRound(state, index);
      state = pressed(state);
    }
    const final = at('Final');
    const unit = state.assignments[final][0].name;
    state = { ...state, finalScores: { ...state.finalScores, [finalScoreKey(1, unit)]: 5 } };
    return goBack(state);
  }

  it('keeps the button when only the Final is in play and a step is reopened, and the press clears the flag', () => {
    const reopened = finalScoredAndReopened();
    expect(reopened.waterfallSteps.at(-1)?.reopened).toBe(true);
    const plan = nextRoundPlan(reopened);
    expect(plan.hidden).toBe(false);
    expect(plan.clears).toEqual([at('SemiB')]);
    expect(plan.draws).toEqual([]);
    const next = pressed(reopened);
    expect(next.waterfallSteps.every((step) => !step.reopened)).toBe(true);
    expect(nextRoundPlan(next).hidden).toBe(true);
  });

  it('leaves the rooms of a reopened round out of the confirmation', () => {
    const afterRound4 = pressed(scoreRound(scoreRound(entry, at('R4U')), at('R4L')));
    const reopened = goBack(scoreRound(afterRound4, at('SemiA')));
    const plan = nextRoundPlan(reopened);
    expect(plan.clears).toEqual(indexes(reopened, 'R4U', 'R4L'));
    for (const { roundIndex } of plan.roomsToConfirm) expect(plan.clears).not.toContain(roundIndex);
  });
});
