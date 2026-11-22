import { describe, expect, it } from 'vitest';
import { computeQualificationStandings } from '../advancement';
import { holdsAbsentBye, markBack, unmarkBack } from '../likely-absentees';
import { clickConfirmationAndSeat } from '../returning-unit';
import type { TournamentState } from '../types';
import { goBack } from '../waterfall-steps';
import { afterRoundOne, byeOf, pickAbsent } from './absentee-fixtures';
import { pressed, scoreRound } from './dependency-play-fixtures';
import { swiss } from './swiss-source-fixtures';

/**
 * A bye a likely absentee takes (`absentBye`, `absenceVersion` 4): it earns no points and no room share, becomes a normal
 * bye when the unit is marked back before the round is sent on, and stays as it was after that.
 */

const STANDARD = { gameFormat: 'individual-1v1' as const };
const MATCH_RESULTS = {
  gameFormat: 'individual-1v1' as const,
  scoring: 'match-results' as const,
  matchResultPoints: '3, 2, 1, 0',
  tieMargin: '15',
};

/** A Swiss of 13 with one unit absent in round 1: it takes round 2's bye, flagged. Round 2 is in play, nothing of it scored. */
function atByeRound(setup: typeof STANDARD | typeof MATCH_RESULTS) {
  const start = swiss(13, setup);
  const unit = pickAbsent(start, 1)[0];
  const state = pressed(afterRoundOne(start, [unit]));
  expect(byeOf(state.assignments[1])).toMatchObject({ name: unit, absentBye: true });
  return { state, unit };
}

/** The same tournament as version 3 stored it: no flag on any bye. */
const withoutFlags = (state: TournamentState): TournamentState => ({
  ...state,
  gamemodeConfig: { ...state.gamemodeConfig, absenceVersion: 3 },
  assignments: state.assignments.map((round) => round.map(({ absentBye: _flag, ...entry }) => entry)),
});

const resultOf = (state: TournamentState, unit: string, roundIndex: number) =>
  computeQualificationStandings(state)
    .find((entry) => entry.name === unit)
    ?.rounds?.find((result) => result.roundIndex === roundIndex);

describe.each([
  ['Standard points', STANDARD],
  ['match results', MATCH_RESULTS],
])('the flagged bye under %s', (_label, setup) => {
  it('earns no points and no room share, and says why', () => {
    const { state, unit } = atByeRound(setup);
    expect(resultOf(state, unit, 1)).toMatchObject({ bye: true, points: 0, absentBye: true });
    const standing = computeQualificationStandings(state).find((entry) => entry.name === unit);
    expect(standing?.played).toBe(0);
  });

  it('is a normal bye once the unit is marked back before the round is sent on', () => {
    const { state, unit } = atByeRound(setup);
    expect(holdsAbsentBye(state, unit)).toBe(true);
    const back = markBack(state, unit);
    expect(byeOf(back.assignments[1])?.absentBye).toBeUndefined();
    expect(holdsAbsentBye(back, unit)).toBe(false);
    const normal = resultOf(back, unit, 1);
    expect(normal).toMatchObject({ bye: true });
    expect(normal?.absentBye).toBeUndefined();
    // The points of a normal bye: what a version 3 tournament gives the same unit for the same bye.
    const earlier = withoutFlags(state);
    expect(normal?.points).toBeGreaterThan(0);
    expect(resultOf(earlier, unit, 1)?.points).toBe(normal?.points);
  });

  it('keeps its flag and its 0 when the unit is marked back after the round was sent on', () => {
    const { state, unit } = atByeRound(setup);
    const sentOn = pressed(scoreRound(state, 1));
    expect(sentOn.curRound).toBeGreaterThan(1);
    const back = markBack(sentOn, unit);
    expect(byeOf(back.assignments[1])).toMatchObject({ absentBye: true });
    expect(resultOf(back, unit, 1)?.points).toBe(0);
  });

  it('comes back from the next round with the flag as drawn, and a back mark then clears it', () => {
    const { state, unit } = atByeRound(setup);
    const sentOn = pressed(scoreRound(state, 1));
    const reopened = goBack(sentOn);
    expect(reopened.curRound).toBe(1);
    expect(byeOf(reopened.assignments[1])).toMatchObject({ absentBye: true });
    const back = markBack(reopened, unit);
    expect(byeOf(back.assignments[1])?.absentBye).toBeUndefined();
    expect(resultOf(back, unit, 1)?.points).toBeGreaterThan(0);
  });
});

describe('undoing a back mark before the round is sent on', () => {
  it('puts the flag back on the bye: no points again', () => {
    const { state, unit } = atByeRound(STANDARD);
    const back = markBack(state, unit);
    expect(resultOf(back, unit, 1)?.points).toBeGreaterThan(0);
    const undone = unmarkBack(back, unit);
    expect(byeOf(undone.assignments[1])).toMatchObject({ absentBye: true });
    expect(resultOf(undone, unit, 1)).toMatchObject({ points: 0, absentBye: true });
  });

  it('leaves a bye of a round that was sent on as it was', () => {
    const { state, unit } = atByeRound(STANDARD);
    const sentOn = pressed(scoreRound(state, 1));
    const undone = unmarkBack(markBack(sentOn, unit), unit);
    expect(byeOf(undone.assignments[1])).toMatchObject({ absentBye: true });
    expect(resultOf(undone, unit, 1)?.points).toBe(0);
  });
});

describe('the click that marks a unit back', () => {
  it('tells the organiser the bye now counts as a normal bye', () => {
    const { state, unit } = atByeRound(STANDARD);
    const { state: after, notice } = clickConfirmationAndSeat(state, unit);
    expect(notice).toBe(`${unit} is back: the bye now counts as a normal bye.`);
    expect(byeOf(after.assignments[1])?.absentBye).toBeUndefined();
  });

  it('says nothing for a bye that was never flagged', () => {
    const { state, unit } = atByeRound(STANDARD);
    expect(clickConfirmationAndSeat(withoutFlags(state), unit).notice).toBeNull();
  });
});
