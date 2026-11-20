import { deriveRoomSize, getGameFormat } from './formats';
import { isRoundReached } from './round-columns';
import { isUpperLowerBracket } from './rule-versions';
import type { RoomSize, ScheduleLogicKey, TournamentRound, TournamentState } from './types';

/**
 * What every bracket the app writes itself has in common (today the built-in upper and lower bracket): at runtime it is
 * a Custom bracket, a mark on `gamemodeConfig` (read in `rule-versions.ts`) says the app wrote it, its rounds carry the
 * match stage they play, and it can be worked out again until a bracket round is drawn. Nothing here depends on the
 * shape of a particular bracket.
 */

/** What reads the logic of a tournament: the schedule logic, or `'upper-lower'` for a Custom bracket the app works out itself. */
export type BracketLogic = ScheduleLogicKey | 'upper-lower';

/**
 * The logic a tournament is set up and shown with. At runtime an upper and lower bracket is a Custom bracket
 * (`state.scheduleLogic` is `'waterfall-bracket'`, never `'upper-lower'`); `gamemodeConfig.upperLowerVersion` marks it.
 */
export function bracketLogicOf(
  state: Pick<TournamentState, 'scheduleLogic' | 'gamemodeConfig'>,
): BracketLogic {
  return isUpperLowerBracket(state) ? 'upper-lower' : state.scheduleLogic;
}

/** The match stage a round of an app-written bracket plays: the Final the Finals format, a Semi-Final the Semis format, every other round the bracket rounds format. */
export function appWrittenStageOf(name: string, isFinal: boolean): 'bracket' | 'semis' | 'finals' {
  if (isFinal) return 'finals';
  return name.startsWith('Semi-Final') ? 'semis' : 'bracket';
}

/**
 * Marks the rounds of a freshly built app-written bracket with the match stage they play: a Semi-Final round the
 * Semis format, the Final the Finals format, every other round the bracket rounds format. `applyMatchFormats` then
 * formats the marked rounds as it formats any stage, so each format can change live.
 */
export function markAppWrittenStages(rounds: TournamentRound[]): TournamentRound[] {
  return rounds.map((entry) => ({
    ...entry,
    graphMatchStage: appWrittenStageOf(entry.customLabel ?? '', entry.isFinal === true),
  }));
}

/** Where an app-written bracket can still be worked out again: its mark is set and no bracket round is drawn. */
export function replannable(state: TournamentState): { first: number; roomSize: RoomSize } | null {
  if (!isUpperLowerBracket(state)) return null;
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  const format = getGameFormat(state.gameFormat);
  if (first === -1 || !format || isRoundReached(state, first)) return null;
  return { first, roomSize: deriveRoomSize(format) };
}
