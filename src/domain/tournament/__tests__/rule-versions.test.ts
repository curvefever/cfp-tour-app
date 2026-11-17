import { describe, expect, it } from 'vitest';
import {
  hasDependencyPlayVersion,
  hasFairCutVersion,
  isUpperLowerBracket,
  routesAbsenteesByLastPlace,
  tracksLikelyAbsentees,
  usesAbsences,
  usesGroupAverages,
  usesScaledPoints,
  withoutUpperLowerMark,
} from '../rule-versions';
import type { TournamentState } from '../types';

function withConfig(config: Record<string, unknown>): Pick<TournamentState, 'gamemodeConfig'> {
  return { gamemodeConfig: config };
}

describe('rule versions: a tournament stored without a switch keeps the earlier rule', () => {
  it('reads each switch only at its own value', () => {
    const none = withConfig({});
    expect([usesScaledPoints(none), hasFairCutVersion(none), usesGroupAverages(none)]).toEqual([
      false,
      false,
      false,
    ]);
    expect([hasDependencyPlayVersion(none), isUpperLowerBracket(none)]).toEqual([false, false]);
    expect(usesScaledPoints(withConfig({ pointsVersion: 2 }))).toBe(true);
    expect(hasFairCutVersion(withConfig({ cutVersion: 2 }))).toBe(true);
    expect(usesGroupAverages(withConfig({ groupAverageVersion: 2 }))).toBe(true);
    expect(hasDependencyPlayVersion(withConfig({ dependencyPlayVersion: 1 }))).toBe(true);
    expect(isUpperLowerBracket(withConfig({ upperLowerVersion: 1 }))).toBe(true);
  });

  it('reads the three absence steps as 1, 2 and 3 or more', () => {
    const steps = [undefined, 1, 2, 3].map((absenceVersion) => {
      const state = withConfig({ absenceVersion });
      return [usesAbsences(state), routesAbsenteesByLastPlace(state), tracksLikelyAbsentees(state)];
    });
    expect(steps).toEqual([
      [false, false, false],
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ]);
  });

  it('answers false for a state with no config where a caller may pass one', () => {
    expect(hasFairCutVersion({})).toBe(false);
    expect(hasDependencyPlayVersion({})).toBe(false);
  });

  it('takes the upper and lower mark off a config and leaves the rest', () => {
    const config = { upperLowerVersion: 1, cutVersion: 2 } as TournamentState['gamemodeConfig'];
    expect(withoutUpperLowerMark(config)).toEqual({ cutVersion: 2 });
    expect(config.upperLowerVersion).toBe(1);
  });
});
