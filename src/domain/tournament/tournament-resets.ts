import { withFinalistAliasesForLineup } from './anonymous-finalists';
import { emptySchedule } from './empty-schedule';
import type { GameFormatKey, TournamentState } from './types';

/** The edits that start over: a loaded roster stored with its format, the roster cleared, the drawn schedule or all play removed. */

/** Stores a loaded roster together with the format it was parsed for, so the two never disagree. */
export function withLoadedRoster(
  state: TournamentState,
  gameFormat: GameFormatKey,
  loaded: Pick<TournamentState, 'players' | 'reserves' | 'reserveIndividuals'>,
): TournamentState {
  return {
    ...state,
    gameFormat,
    players: loaded.players,
    reserves: loaded.reserves,
    reserveIndividuals: loaded.reserveIndividuals,
    confirmedCount: loaded.players.length,
  };
}

/**
 * Clears just the registered roster (players/reserves/individual reserves)
 * plus anything derived from it that would otherwise go stale -- the
 * generated schedule preview, if "Generate Schedule" was already clicked
 * pre-start. Deliberately preserves title/gameFormat/scheduleLogic/cfg (the
 * Setup configuration itself) -- the complement of resetTournamentState()
 * below, which preserves the roster but clears live progress.
 */
export function resetRoster(state: TournamentState): TournamentState {
  const { settings: _settings, ...rest } = withoutDrawnSchedule(state);
  return {
    ...rest,
    players: [],
    reserves: [],
    reserveIndividuals: [],
    confirmations: {},
    confirmedCount: null,
    withdrawnUnits: [],
    reserveOpen: true,
  };
}

/**
 * Clears everything a generated schedule put in the state (`emptySchedule`: the rounds, who is seated where,
 * standings, scores, the room history), keeping the roster, the Setup (`cfg`, the settings snapshot), the
 * withdrawals and the confirmations. A state with nothing generated yet.
 */
export function withoutDrawnSchedule(state: TournamentState): TournamentState {
  return { ...state, ...emptySchedule() };
}

/**
 * Back to a draft: the schedule as generated, with no play in it. Keeps the generated rounds, the groups and the
 * `gamemodeConfig` (the schedule itself) and the room history, and the roster as `withoutDrawnSchedule` does; it also
 * clears the withdrawals and opens the reserve again. The draw of round 1 goes (`assignments` is empty).
 */
export function resetTournamentState(state: TournamentState): TournamentState {
  const {
    rounds: _rounds,
    groups: _groups,
    roomHistory: _roomHistory,
    gamemodeConfig: _gamemodeConfig,
    ...play
  } = emptySchedule();
  return withFinalistAliasesForLineup({ ...state, ...play, withdrawnUnits: [], reserveOpen: true });
}
