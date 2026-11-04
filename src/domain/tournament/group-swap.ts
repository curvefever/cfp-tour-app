import { refreshRoundStandings } from './advancement';
import { recordRoomHistory, rewindRoomHistory } from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

/**
 * Two units of different groups trade places, from the schedule's generation until Round 2 is drawn. A group
 * stage stores its whole round robin by name at generation (`state.groups`, and on every group round the
 * `matches`, `groupByes` and the units seated in `state.assignments`), so a swap exchanges the two names in all
 * of them. A seat stays in its group, so the group sizes, the round count and every match's place are unchanged
 * and the round robin stays complete. Scores are keyed by room and position, not by name, so once the first
 * round is in play the rooms of the two units are cleared: their results were played against the old opponents.
 */

export type GroupSwapResult = { ok: true; state: TournamentState } | { ok: false; error: string };

/** A room of the round in play that a swap would clear, with the units seated in it. */
export interface ClearedRoom {
  room: number;
  units: string[];
}

const GROUPS_FIXED = 'Round 2 is drawn — groups are fixed from here.';
const REDRAW_NEEDED = 'Generate the schedule again to swap groups.';

/** Cutoff and band ties of the group stage are keyed by group and rank: they read the groups as they stood. */
const STANDINGS_TIE_PREFIX = 'group-';

/** Why no swap can be made now, or null when the window is open. The Standings tab and the mutation both ask. */
export function groupSwapWindow(state: TournamentState): string | null {
  if (state.cfg.poolingPhase !== 'group-stage') return 'This tournament has no group stage.';
  if (!state.groups.length) return 'The schedule has not been generated yet.';
  // Back to draft clears Round 1's line-up and the only way on is to generate again, which draws new groups.
  if (!state.started) return (state.assignments[0] ?? []).length ? null : REDRAW_NEEDED;
  const firstGroupRound = state.rounds.findIndex((round) => round.isGroupStage);
  const laterDrawn = state.assignments.some((entries, index) => index > state.curRound && entries.length > 0);
  return state.curRound === firstGroupRound && !laterDrawn ? null : GROUPS_FIXED;
}

const groupLabelOf = (state: TournamentState, name: string) =>
  state.groups.find((group) => group.members.includes(name))?.label;

function swapNames(first: string, second: string) {
  return (name: string) => (name === first ? second : name === second ? first : name);
}

function exchangeInRound(round: TournamentRound, exchange: (name: string) => string): TournamentRound {
  if (!round.isGroupStage) return round;
  return {
    ...round,
    matches: round.matches?.map((match) => ({
      ...match,
      pair: [exchange(match.pair[0]), exchange(match.pair[1])] as [string, string],
    })),
    groupByes: round.groupByes?.map(exchange),
  };
}

/** A list of seats or table rows, each under its unit's name. */
const exchangeEntries = <T extends { name: string }>(entries: T[], exchange: (name: string) => string): T[] =>
  entries.map((entry) => ({ ...entry, name: exchange(entry.name) }));

/** The rooms of the round in play that hold `first` or `second`, before the swap (a unit on a bye has none). */
function roomsOfUnits(state: TournamentState, first: string, second: string): ClearedRoom[] {
  if (!state.started) return [];
  const entries = state.assignments[state.curRound] ?? [];
  const rooms = new Set(
    entries
      .filter((entry) => entry.room !== null && (entry.name === first || entry.name === second))
      .map((entry) => entry.room as number),
  );
  return [...rooms]
    .sort((left, right) => left - right)
    .map((room) => ({
      room,
      units: entries.filter((entry) => entry.room === room).map((entry) => entry.name),
    }));
}

function hasResultsIn(state: TournamentState, room: ClearedRoom): boolean {
  const prefix = `r${state.curRound}-rm${room.room}-`;
  const keyed = (record: Record<string, unknown>, isSet: (value: unknown) => boolean) =>
    Object.entries(record).some(([key, value]) => key.startsWith(prefix) && isSet(value));
  return (
    keyed(state.scores, (value) => value !== null) ||
    keyed(state.absences, () => true) ||
    keyed(state.tieResolutions, () => true) ||
    room.units.some((unit) =>
      (state.defenderChanges[unit] ?? []).some((change) => change.round === state.curRound),
    )
  );
}

/**
 * The rooms of the round in play where swapping `first` and `second` would clear something: their scores, the
 * absences, the room tie resolutions or the Save your Buddy defender changes. Empty before the start, for a
 * unit on a bye, and for a room nothing has been entered in.
 */
export function groupSwapClears(state: TournamentState, first: string, second: string): ClearedRoom[] {
  return roomsOfUnits(state, first, second).filter((room) => hasResultsIn(state, room));
}

function withoutRoomsResults(state: TournamentState, rooms: ClearedRoom[]): Partial<TournamentState> {
  if (!rooms.length) return {};
  const prefixes = rooms.map((room) => `r${state.curRound}-rm${room.room}-`);
  const inRoom = (key: string) => prefixes.some((prefix) => key.startsWith(prefix));
  const without = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !inRoom(key)));
  const seated = new Set(rooms.flatMap((room) => room.units));
  return {
    scores: without(state.scores),
    absences: without(state.absences),
    tieResolutions: without(state.tieResolutions),
    defenderChanges: Object.fromEntries(
      Object.entries(state.defenderChanges).map(([unit, changes]) => [
        unit,
        seated.has(unit) ? changes.filter((change) => change.round !== state.curRound) : changes,
      ]),
    ),
  };
}

/** Group stage ties keyed by group and rank no longer describe the groups once a member changes. */
function withoutStandingsTies(ties: TournamentState['tieResolutions']): TournamentState['tieResolutions'] {
  return Object.fromEntries(Object.entries(ties).filter(([key]) => !key.startsWith(STANDINGS_TIE_PREFIX)));
}

/** The round in play's draw rewound and recorded again, so the pairs of the old line-up are not remembered. */
function roomHistoryAfter(state: TournamentState, assignments: RoundAssignment[][]) {
  const seated = assignments[state.curRound] ?? [];
  if (!seated.length) return state.roomHistory;
  return recordRoomHistory(
    rewindRoomHistory(state.roomHistory, assignments, state.curRound),
    seated,
    state.curRound,
  );
}

/**
 * `first` and `second` trade places: each takes the other's seat in the other's group, in every group round.
 * Refused with the window closed, in the same group, or for a name in no group (a reserve, a removed unit).
 */
export function swapBetweenGroups(state: TournamentState, first: string, second: string): GroupSwapResult {
  const refusal = groupSwapWindow(state);
  if (refusal) return { ok: false, error: refusal };
  for (const name of [first, second]) {
    if (groupLabelOf(state, name) === undefined) return { ok: false, error: `${name} isn't in a group.` };
  }
  if (groupLabelOf(state, first) === groupLabelOf(state, second)) {
    return { ok: false, error: `${first} and ${second} are in the same group.` };
  }

  const exchange = swapNames(first, second);
  const assignments = state.assignments.map((entries) => exchangeEntries(entries, exchange));
  const results = withoutRoomsResults(state, groupSwapClears(state, first, second));
  const swapped: TournamentState = {
    ...state,
    ...results,
    groups: state.groups.map((group) => ({ ...group, members: group.members.map(exchange) })),
    groupStandings: Object.fromEntries(
      Object.entries(state.groupStandings).map(([label, entries]) => [
        label,
        exchangeEntries(entries, exchange),
      ]),
    ),
    rounds: state.rounds.map((round) => exchangeInRound(round, exchange)),
    assignments,
    byes: state.byes.map((names) => names.map(exchange)),
    tieResolutions: withoutStandingsTies(results.tieResolutions ?? state.tieResolutions),
    roomHistory: roomHistoryAfter(state, assignments),
  };
  return { ok: true, state: refreshRoundStandings(swapped, state.curRound) };
}
