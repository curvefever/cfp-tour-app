import { describe, expect, it } from 'vitest';
import {
  hasDependencyPlayVersion,
  hasAppWrittenMark,
  hasFairCutVersion,
  isLayeredBracket,
  isUpperLowerBracket,
  routesAbsenteesByLastPlace,
  tracksLikelyAbsentees,
  usesAbsences,
  usesGroupAverages,
  usesScaledPoints,
  withoutAppWrittenMark,
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
    expect([hasDependencyPlayVersion(none), isUpperLowerBracket(none), isLayeredBracket(none)]).toEqual([
      false,
      false,
      false,
    ]);
    expect(usesScaledPoints(withConfig({ pointsVersion: 2 }))).toBe(true);
    expect(hasFairCutVersion(withConfig({ cutVersion: 2 }))).toBe(true);
    expect(usesGroupAverages(withConfig({ groupAverageVersion: 2 }))).toBe(true);
    expect(hasDependencyPlayVersion(withConfig({ dependencyPlayVersion: 1 }))).toBe(true);
    expect(isUpperLowerBracket(withConfig({ upperLowerVersion: 1 }))).toBe(true);
    expect(isLayeredBracket(withConfig({ layeredVersion: 1 }))).toBe(true);
  });

  it('keeps the two app-written marks apart', () => {
    expect(isLayeredBracket(withConfig({ upperLowerVersion: 1 }))).toBe(false);
    expect(isUpperLowerBracket(withConfig({ layeredVersion: 1 }))).toBe(false);
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

  it('takes either app-written mark off a config and leaves the rest', () => {
    const upperLower = { upperLowerVersion: 1, cutVersion: 2 } as TournamentState['gamemodeConfig'];
    const layered = { layeredVersion: 1, cutVersion: 2 } as TournamentState['gamemodeConfig'];
    expect(withoutAppWrittenMark(upperLower)).toEqual({ cutVersion: 2 });
    expect(withoutAppWrittenMark(layered)).toEqual({ cutVersion: 2 });
    expect(upperLower.upperLowerVersion).toBe(1);
    expect(layered.layeredVersion).toBe(1);
  });

  it('leaves a config with no mark as it is', () => {
    const config = { cutVersion: 2 } as TournamentState['gamemodeConfig'];
    expect(withoutAppWrittenMark(config)).toEqual({ cutVersion: 2 });
  });

  it('says whether a config carries either mark', () => {
    const marks = [{}, { upperLowerVersion: 1 }, { layeredVersion: 1 }].map((config) =>
      hasAppWrittenMark(config as TournamentState['gamemodeConfig']),
    );
    expect(marks).toEqual([false, true, true]);
  });
});
