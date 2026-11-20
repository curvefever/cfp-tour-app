import { deriveRoomSize, getGameFormat } from './formats';
import { isRoundReached } from './round-columns';
import { isLayeredBracket, isUpperLowerBracket } from './rule-versions';
import type { RoomSize, ScheduleLogicKey, TournamentRound, TournamentState } from './types';

/**
 * What every bracket the app writes itself has in common (the built-in upper and lower bracket and the layered bracket): at runtime it is
 * a Custom bracket, a mark on `gamemodeConfig` (read in `rule-versions.ts`) says the app wrote it, its rounds carry the
 * match stage they play, and it can be worked out again until a bracket round is drawn. Nothing here depends on the
 * shape of a particular bracket.
 */

/** What reads the logic of a tournament: the schedule logic, or `'upper-lower'` or `'layered'` for a Custom bracket the app works out itself. */
export type BracketLogic = ScheduleLogicKey;

/**
 * The logic a tournament is set up and shown with. At runtime an upper and lower bracket or a layered bracket is a
 * Custom bracket (`state.scheduleLogic` is `'waterfall-bracket'`, never `'upper-lower'` or `'layered'`); the mark on
 * `gamemodeConfig` (`rule-versions.ts`) says which.
 */
export function bracketLogicOf(
  state: Pick<TournamentState, 'scheduleLogic' | 'gamemodeConfig'>,
): BracketLogic {
  if (isUpperLowerBracket(state)) return 'upper-lower';
  return isLayeredBracket(state) ? 'layered' : state.scheduleLogic;
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

/** Where a bracket the app wrote can still be worked out again: no bracket round is drawn. */
function notEnteredYet(state: TournamentState): { first: number; roomSize: RoomSize } | null {
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  const format = getGameFormat(state.gameFormat);
  if (first === -1 || !format || isRoundReached(state, first)) return null;
  return { first, roomSize: deriveRoomSize(format) };
}

/** Where the built-in upper and lower bracket can still be worked out again: its mark is set and no bracket round is drawn. */
export function replannable(state: TournamentState): { first: number; roomSize: RoomSize } | null {
  return isUpperLowerBracket(state) ? notEnteredYet(state) : null;
}

/** Where a layered bracket can still be planned again: its mark is set and no bracket round is drawn. */
export function layeredReplannable(state: TournamentState): { first: number } | null {
  const found = isLayeredBracket(state) ? notEnteredYet(state) : null;
  return found && { first: found.first };
}
