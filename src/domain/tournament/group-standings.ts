import { absentInRoom } from './absences';
import { type RoundOutcome, roomOutcomes, roundHasBegun, samePoints, sameStanding } from './advancement';
import type { TournamentStanding, TournamentState } from './types';

type NamedOutcome = RoundOutcome & { name: string };

/** Who holds a seat now, and whether its unit was removed: the two questions a group's past matches ask of the names recorded in their rooms. */
export interface GroupSeats {
  holderOf: (name: string) => string;
  isRemoved: (name: string) => boolean;
}

/** The switch for the group stage's per-match standings: asked by `computeGroupStandings`, nowhere else. */
export function usesGroupAverages(state: Pick<TournamentState, 'gamemodeConfig'>): boolean {
  return state.gamemodeConfig.groupAverageVersion === 2;
}

/**
 * A room of a past round still names the unit that played it. A swap hands that seat's line to the replacement
 * (`WithdrawnUnit.replacedBy`, followed through further swaps); a removal during the group stage takes the unit, and
 * so its matches, out of the group. One made after the last group round (a qualifier leaving the bracket) leaves the
 * group's results as they were.
 */
export function groupSeats(state: Pick<TournamentState, 'withdrawnUnits' | 'rounds'>): GroupSeats {
  const lastGroupRound = state.rounds.reduce((last, round, index) => (round.isGroupStage ? index : last), -1);
  const successors = new Map<string, string>();
  const removed = new Set<string>();
  for (const unit of state.withdrawnUnits) {
    if (unit.reason === 'swapped' && unit.replacedBy !== undefined)
      successors.set(unit.name, unit.replacedBy);
    else if (unit.reason === 'removed' && (unit.round === undefined || unit.round <= lastGroupRound)) {
      removed.add(unit.name);
    }
  }
  const holderOf = (name: string) => {
    let holder = name;
    for (let step = 0; step <= successors.size && successors.has(holder); step += 1) {
      holder = successors.get(holder) ?? holder;
    }
    return holder;
  };
  return { holderOf, isRemoved: (name) => removed.has(holderOf(name)) };
}

/** A match played in a group: the points each of its two units took. Voided matches, no-shows and byes are not matches played. */
export interface GroupMatchPoints {
  group: string;
  points: Record<string, number>;
}

/** The match a group room's outcomes record, if it was played by two units that both have a place. */
export function playedMatchOf(group: string, outcomes: readonly NamedOutcome[]): GroupMatchPoints | null {
  if (outcomes.length !== 2 || outcomes.some((outcome) => outcome.rank === null)) return null;
  return { group, points: Object.fromEntries(outcomes.map((outcome) => [outcome.name, outcome.points])) };
}

/** Equal within a group: level on points per match and room share, and on the head-to-head points. */
export function sameGroupStanding(first: TournamentStanding, second: TournamentStanding): boolean {
  return sameStanding(first, second) && samePoints(first.headToHead ?? null, second.headToHead ?? null);
}

/** One run of units level on points per match and room share, each with the points it took from the others, best first (stable). */
function orderByHeadToHead(
  run: TournamentStanding[],
  matches: readonly GroupMatchPoints[],
): TournamentStanding[] {
  const names = new Set(run.map((entry) => entry.name));
  const between = matches.filter((match) => Object.keys(match.points).every((name) => names.has(name)));
  return run
    .map((entry) => ({
      ...entry,
      headToHead: between.reduce((total, match) => total + (match.points[entry.name] ?? 0), 0),
    }))
    .sort((first, second) =>
      samePoints(first.headToHead, second.headToHead) ? 0 : second.headToHead - first.headToHead,
    );
}

/**
 * A group's table (already ordered by points per match, then room share) with each run of level units ordered by the
 * head-to-head points of the matches they played against each other: two units by their own match, three or more by
 * a mini-table of only those matches (both legs of a double round robin). Units level after it stay level, for the
 * organiser. `matches` are the group's played matches.
 */
export function withHeadToHead(
  table: TournamentStanding[],
  matches: readonly GroupMatchPoints[],
): TournamentStanding[] {
  const output: TournamentStanding[] = [];
  let first = 0;
  while (first < table.length) {
    let last = first;
    while (last + 1 < table.length && sameStanding(table[last + 1], table[first])) last += 1;
    const run = table.slice(first, last + 1);
    output.push(...(run.length < 2 || table[first].totalFP === null ? run : orderByHeadToHead(run, matches)));
    first = last + 1;
  }
  return output;
}

/** A no-show's match: counted, worth nothing whatever the points table, with no score and no room share. */
function absenceOutcome(roundIndex: number, name: string): NamedOutcome {
  return { name, roundIndex, score: null, rank: null, points: 0, bye: false, share: null };
}

/**
 * What one group room gives each line, under the per-match rules. A room that lost a unit (a removal, in this round
 * or an earlier one) is void for the other unit, whatever was typed. A room with an absent unit is void for the unit
 * that turned up and a counted 0 for the one that did not (both, if both did not). Any other room is played as
 * usual. A bye is no room at all, so it gives nothing. Names are the seat's holder today.
 * `heldBack` is a live round's room not fully scored yet.
 */
export function groupRoomOutcomes(
  state: TournamentState,
  roundIndex: number,
  room: number,
  seats: GroupSeats,
  heldBack: boolean,
): NamedOutcome[] {
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  if (seated.length < 2 || seated.some((entry) => seats.isRemoved(entry.name))) return [];
  const absent = roundHasBegun(state, roundIndex) ? absentInRoom(state, roundIndex, room) : [];
  if (absent.length > 0) return absent.map((name) => absenceOutcome(roundIndex, seats.holderOf(name)));
  if (heldBack) return [];
  return roomOutcomes(state, roundIndex, room).map((outcome) => ({
    ...outcome,
    name: seats.holderOf(outcome.name),
  }));
}
