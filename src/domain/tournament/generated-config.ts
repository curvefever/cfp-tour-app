import type { MaterializedGamemodeConfig, TournamentState } from './types';

/**
 * The settings of a tournament that has been generated, or null for one that has not. `gamemodeConfig` is typed
 * with every field optional because a tournament starts with it empty; Generate then writes all of it, so the room
 * size stands for "this tournament has been generated". Callers that need the settings answer the null with their
 * own refusal: each keeps its own wording.
 */
export function generatedConfig(
  state: Pick<TournamentState, 'gamemodeConfig'>,
): MaterializedGamemodeConfig | null {
  return state.gamemodeConfig.roomSize ? (state.gamemodeConfig as MaterializedGamemodeConfig) : null;
}
