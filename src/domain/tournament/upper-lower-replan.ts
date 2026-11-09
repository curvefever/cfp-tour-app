import { parseAdvanceToBracket } from './bracket-entry';
import { deriveRoomSize, getGameFormat } from './formats';
import { isRoundReached } from './round-columns';
import { applyMatchFormats } from './round-match-formats';
import { rosterKeys } from './roster';
import type { RoomSize, TournamentState } from './types';
import { markUpperLowerStages, upperLowerEntry, upperLowerGraphText, upperLowerUpper } from './upper-lower';
import { applyWaterfallGraphEdit } from './waterfall-live-edit';

const sameOf = (before: TournamentState, after: TournamentState): boolean =>
  JSON.stringify([before.rounds, before.cfg, before.gamemodeConfig]) ===
  JSON.stringify([after.rounds, after.cfg, after.gamemodeConfig]);

export type UpperLowerReplan = { ok: true; state: TournamentState } | { ok: false; message: string };

/** Where an upper and lower bracket can still be worked out again: the version is set and no bracket round is drawn. */
function replannable(state: TournamentState): { first: number; roomSize: RoomSize } | null {
  if (!state.gamemodeConfig.upperLowerVersion) return null;
  const first = state.rounds.findIndex((round) => round.isWaterfall);
  const format = getGameFormat(state.gameFormat);
  if (first === -1 || !format || isRoundReached(state, first)) return null;
  return { first, roomSize: deriveRoomSize(format) };
}

/** The number entering for the units still in the roster and the settings' "Advance to bracket", or why not. */
function entryOf(state: TournamentState, roomSize: RoomSize) {
  const typed = state.settings?.upperLowerAdvance.trim() ?? '';
  const requested = typed ? parseAdvanceToBracket(typed) : null;
  if (typed && requested === null) {
    return {
      ok: false as const,
      message: `Advance to bracket must be a positive whole number — got "${typed}".`,
    };
  }
  return upperLowerEntry(rosterKeys(state.players).length, requested, roomSize);
}

/**
 * The note the running Admin shows when the typed "Upper rooms" no longer seats with the units entering now: the
 * rooms are then split evenly (the re-work falls back to it rather than block a removal). Null when nothing is typed, it
 * seats, or the bracket can't be worked out again.
 */
export function upperLowerUpperFallback(state: TournamentState): string | null {
  const planned = replannable(state);
  const typed = state.settings?.upperLowerUpper.trim() ?? '';
  if (!planned || !typed) return null;
  const entry = entryOf(state, planned.roomSize);
  if (!entry.ok) return null;
  const upper = upperLowerUpper(entry.entry, typed, planned.roomSize);
  return upper.ok ? null : `${upper.message} The rooms are split evenly instead.`;
}

/**
 * The upper and lower bracket worked out again from the units still in the roster, with the settings' "Advance to
 * bracket" and "Upper rooms". With `strict` a value that can't be used is refused with the words generation uses (the
 * running Admin's Save); otherwise it is left as it was (an entry no bracket exists for) or, for "Upper rooms", falls
 * back to evenly, so a removal is never blocked by it. A save the Custom bracket engine refuses (a group stage's
 * exit) is refused in both, and the state stays.
 */
export function tryReplanUpperLower(state: TournamentState, strict = false): UpperLowerReplan {
  const planned = replannable(state);
  if (!planned) return { ok: true, state };
  const { first, roomSize } = planned;
  const entry = entryOf(state, roomSize);
  if (!entry.ok) return strict ? entry : { ok: true, state };
  const upper = upperLowerUpper(entry.entry, state.settings?.upperLowerUpper ?? '', roomSize);
  if (!upper.ok && strict) return upper;
  const source = state.cfg.poolingPhase === 'group-stage' ? 'groups' : 'qual';
  const edited = applyWaterfallGraphEdit(
    state,
    upperLowerGraphText(
      entry.entry,
      roomSize,
      state.rounds[first].roundNum,
      source,
      upper.ok ? upper.upper : null,
    ),
  );
  if (!edited.ok) return strict ? { ok: false, message: edited.error } : { ok: true, state };
  const { gamemodeConfig, rounds } = edited.state;
  const staged = [...rounds.slice(0, first), ...markUpperLowerStages(rounds.slice(first))];
  const replanned = {
    ...edited.state,
    // The snapshot keeps what the form said; the graph is derived, not typed.
    settings: state.settings,
    rounds: applyMatchFormats(staged, gamemodeConfig, first),
  };
  return { ok: true, state: sameOf(state, replanned) ? state : replanned };
}

/**
 * The head count changed during pooling (a withdrawal, a late joiner): the built-in upper and lower bracket works its
 * rooms out again from the units still in the roster, the way it did at generation, so the Upper and Lower rooms
 * (and the shortfall check at the entry) follow the real count (`tryReplanUpperLower`, never strict).
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
  const replan = tryReplanUpperLower(state);
  return replan.ok ? replan.state : state;
}

/**
 * The running Admin's Save of "Advance to bracket" and "Upper rooms": both written to the settings and the bracket
 * worked out again with them, or why not. The version stays, so the app goes on working the rooms out.
 */
export function applyUpperLowerFields(
  state: TournamentState,
  fields: { advance: string; upper: string },
): UpperLowerReplan {
  if (!state.settings) return { ok: false, message: 'This tournament has no stored settings.' };
  if (!replannable(state)) {
    return { ok: false, message: 'The bracket has been entered: change its rounds with Edit graph.' };
  }
  const settings = { ...state.settings, upperLowerAdvance: fields.advance, upperLowerUpper: fields.upper };
  return tryReplanUpperLower({ ...state, settings }, true);
}
