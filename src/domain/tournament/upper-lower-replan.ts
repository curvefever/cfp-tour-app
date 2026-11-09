import { parseAdvanceToBracket } from './bracket-entry';
import { deriveRoomSize, getGameFormat } from './formats';
import { isRoundReached } from './round-columns';
import { applyMatchFormats } from './round-match-formats';
import { rosterKeys } from './roster';
import type { TournamentState } from './types';
import { markUpperLowerStages, upperLowerEntry, upperLowerGraphText } from './upper-lower';
import { applyWaterfallGraphEdit } from './waterfall-live-edit';

const sameOf = (before: TournamentState, after: TournamentState): boolean =>
  JSON.stringify([before.rounds, before.cfg, before.gamemodeConfig]) ===
  JSON.stringify([after.rounds, after.cfg, after.gamemodeConfig]);

/**
 * The head count changed during pooling (a withdrawal, a late joiner): the built-in upper and lower bracket works its
 * rooms out again from the units still in the roster, the way it did at generation, so the Upper and Lower rooms
 * (and the shortfall check at the entry) follow the real count.
 *
 * Only while the bracket has not been entered: once a bracket round is drawn the rooms stand and a withdrawal ripples
 * as in any Custom bracket. Only while the version is set: a hand edit of the graph ends it. The new text goes through
 * the same save a hand edit does (`applyWaterfallGraphEdit`), which keeps the pooling rounds and their scores, drops
 * the tie picks the new cut lines make stale and checks a group stage's exit against the groups as they stand. The
 * number of the first bracket round stays what the state has (a Swiss's or a group stage's rounds are not counted
 * again once it has started). The new bracket rounds are given their stages again and the match formats, so
 * every format set live or by a per-round override (kept by round name) carries over.
 *
 * A text the count has no bracket for, or a save that is refused, leaves the state as it was: a removal is never
 * blocked by it (the shortfall message at the entry then applies).
 */
export function replanUpperLower(state: TournamentState): TournamentState {
  if (!state.gamemodeConfig.upperLowerVersion) return state;
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  const format = getGameFormat(state.gameFormat);
  if (first === -1 || !format || isRoundReached(state, first)) return state;
  const roomSize = deriveRoomSize(format);
  const typed = state.settings?.upperLowerAdvance.trim() ?? '';
  const entry = upperLowerEntry(
    rosterKeys(state.players).length,
    typed ? parseAdvanceToBracket(typed) : null,
    roomSize,
  );
  if (!entry.ok) return state;
  const source = state.cfg.poolingPhase === 'group-stage' ? 'groups' : 'qual';
  const edited = applyWaterfallGraphEdit(
    state,
    upperLowerGraphText(entry.entry, roomSize, state.rounds[first].roundNum, source),
  );
  if (!edited.ok) return state;
  const { gamemodeConfig, rounds } = edited.state;
  const staged = [...rounds.slice(0, first), ...markUpperLowerStages(rounds.slice(first))];
  const replanned = {
    ...edited.state,
    // The snapshot keeps what the form said; the graph is derived, not typed.
    settings: state.settings,
    rounds: applyMatchFormats(staged, gamemodeConfig, first),
  };
  return sameOf(state, replanned) ? state : replanned;
}
