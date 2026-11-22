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

/** `absenceVersion` 4: a head-to-head pooling draw after the first round pairs the likely absentees together, and a leftover one takes a bye worth no points. Earlier (versions 1 to 3): the draws give each likely absentee a real opponent in a room of two. */
export function pairsLikelyAbsentees(state: WithConfig): boolean {
  return (state.gamemodeConfig.absenceVersion ?? 0) >= 4;
}

/** `absenceVersion` 3: the draws and the confirmation marks know who was absent last round. Earlier (versions 1 and 2): the draws and marks ignore who was absent last round. */
export function tracksLikelyAbsentees(state: WithConfig): boolean {
  return (state.gamemodeConfig.absenceVersion ?? 0) >= 3;
}

/** `vacantSlotVersion` 1: a team slot vacated after it played keeps its stored scores in every round, and a vacant slot is never "missing". Earlier: a vacant slot reads 0 in every round, past rounds included. */
export function keepsVacatedSlotScores(state: WithConfig): boolean {
  return state.gamemodeConfig.vacantSlotVersion === 1;
}

/** `upperLowerVersion`: the Custom bracket is the built-in upper and lower bracket. It marks a format, not an earlier rule: without it the Custom bracket is the organiser's own graph. */
export function isUpperLowerBracket(state: WithConfig): boolean {
  return Boolean(state.gamemodeConfig.upperLowerVersion);
}

/** `layeredVersion`: the Custom bracket is the layered bracket the app writes (`layered-graph.ts`). Like the upper and lower mark it marks a format, not an earlier rule. */
export function isLayeredBracket(state: WithConfig): boolean {
  return Boolean(state.gamemodeConfig.layeredVersion);
}

/** The number who play that a layered bracket's plan was made for, or undefined for a tournament that is not one (`layeredPlay`). */
export function layeredPlayOf(state: WithConfig): number | undefined {
  return isLayeredBracket(state) ? state.gamemodeConfig.layeredPlay : undefined;
}

/** The number who play at which the organiser kept the plan in use, or undefined for none (`layeredKeptPlay`). */
export function layeredKeptPlayOf(state: WithConfig): number | undefined {
  return isLayeredBracket(state) ? state.gamemodeConfig.layeredKeptPlay : undefined;
}

/** The config of a layered bracket planned for `play` who play: any kept number is cleared, the plan in use is the new one. */
export function withLayeredPlay(gamemodeConfig: GamemodeConfig, play: number): GamemodeConfig {
  const { layeredKeptPlay: _kept, ...rest } = gamemodeConfig;
  return { ...rest, layeredPlay: play };
}

/** The config of a layered bracket whose plan in use was kept at `play` who play. */
export function withLayeredKept(gamemodeConfig: GamemodeConfig, play: number): GamemodeConfig {
  return { ...gamemodeConfig, layeredKeptPlay: play };
}

/** Whether a config carries the mark of a bracket the app wrote itself, either kind (a config as the builders hold it, not a whole state). */
export function hasAppWrittenMark(
  gamemodeConfig: Pick<GamemodeConfig, 'upperLowerVersion' | 'layeredVersion'>,
): boolean {
  return Boolean(gamemodeConfig.upperLowerVersion || gamemodeConfig.layeredVersion);
}

/** The config of a Custom bracket the organiser has taken over by hand: no longer marked as a bracket the app wrote (the upper and lower bracket or the layered bracket). */
export function withoutAppWrittenMark(gamemodeConfig: GamemodeConfig): GamemodeConfig {
  const {
    upperLowerVersion: _upperLower,
    layeredVersion: _layered,
    layeredPlay: _play,
    layeredKeptPlay: _kept,
    ...unmarked
  } = gamemodeConfig;
  return unmarked;
}
