/**
 * The switches of the rules that changed after tournaments had been stored, read in one place. `generation.ts` writes
 * them on every new tournament (`gamemodeConfig`); a stored tournament without one keeps the earlier rule, so each
 * helper says what that earlier rule was. Nothing outside this file, `generation.ts` and `types.ts` reads or names the
 * stored fields.
 */
import type { TournamentState } from './types';

type GamemodeConfig = TournamentState['gamemodeConfig'];

/** A state as far as a switch needs it. */
type WithConfig = Pick<TournamentState, 'gamemodeConfig'>;

/** The same, for the callers (`round-columns.ts`, `bracket.ts`) that also take a state with no config at all. */
type WithOptionalConfig = Partial<WithConfig>;

/** `pointsVersion` 2: a smaller room reads the points table scaled to its size. Earlier: the same table in every room, Standard from the largest room size down to 1, a Custom table read place by place. */
export function usesScaledPoints(state: WithConfig): boolean {
  return state.gamemodeConfig.pointsVersion === 2;
}

/** `cutVersion` 2: an elimination round cuts by the fair cut (`fair-cut.ts`). Earlier: every room advances the same number and the rest are lucky losers across rooms. */
export function hasFairCutVersion(state: WithOptionalConfig): boolean {
  return state.gamemodeConfig?.cutVersion === 2;
}

/** `groupAverageVersion` 2: a group stage ranks by points per match played. Earlier: total points, a bye and a lone unit's walkover counted as wins. */
export function usesGroupAverages(state: WithConfig): boolean {
  return state.gamemodeConfig.groupAverageVersion === 2;
}

/** `dependencyPlayVersion` 1: a Custom bracket plays by dependency play. Earlier: a column at a time, Next Round sends on the whole column in play. */
export function hasDependencyPlayVersion(state: WithOptionalConfig): boolean {
  return state.gamemodeConfig?.dependencyPlayVersion === 1;
}

/** `absenceVersion` 1 or more: a typed 0 asks whether the unit was absent. Earlier: no questions, no marks, no per-player weighting. */
export function usesAbsences(state: WithConfig): boolean {
  return (state.gamemodeConfig.absenceVersion ?? 0) >= 1;
}

/** `absenceVersion` 2 or more: a Custom bracket room keeps an absentee out of any seat above its last place. Earlier (version 1): an absentee was routed by its rank. */
export function routesAbsenteesByLastPlace(state: WithConfig): boolean {
  return (state.gamemodeConfig.absenceVersion ?? 0) >= 2;
}

/** `absenceVersion` 3: the draws and the confirmation marks know who was absent last round. Earlier (versions 1 and 2): the draws and marks ignore who was absent last round. */
export function tracksLikelyAbsentees(state: WithConfig): boolean {
  return (state.gamemodeConfig.absenceVersion ?? 0) >= 3;
}

/** `upperLowerVersion`: the Custom bracket is the built-in upper and lower bracket. It marks a format, not an earlier rule: without it the Custom bracket is the organiser's own graph. */
export function isUpperLowerBracket(state: WithConfig): boolean {
  return Boolean(state.gamemodeConfig.upperLowerVersion);
}

/** The config of a Custom bracket the organiser has taken over by hand: no longer marked as the built-in upper and lower bracket. */
export function withoutUpperLowerMark(gamemodeConfig: GamemodeConfig): GamemodeConfig {
  const { upperLowerVersion: _mark, ...unmarked } = gamemodeConfig;
  return unmarked;
}
