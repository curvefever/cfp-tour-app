import { absentInRoom } from './absences';
import {
  type RoundOutcome,
  rankingPoints,
  roomOutcomes,
  roundHasBegun,
  sameRoomShare,
  samePoints,
} from './advancement';
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

/** Equal within a group: level on points per match, on the final head-to-head level, and on room share. */
export function sameGroupStanding(first: TournamentStanding, second: TournamentStanding): boolean {
  return (
    samePoints(rankingPoints(first), rankingPoints(second)) &&
    (first.headToHeadLevel ?? null) === (second.headToHeadLevel ?? null) &&
    sameRoomShare(first.roomShare ?? null, second.roomShare ?? null)
  );
}

/** The points each unit of a run took from the matches among the run's units only. */
function miniTable(
  run: readonly { name: string }[],
  matches: readonly GroupMatchPoints[],
): Map<string, number> {
  const names = new Set(run.map((entry) => entry.name));
  const between = matches.filter((match) => Object.keys(match.points).every((name) => names.has(name)));
  return new Map(
    run.map((entry) => [
      entry.name,
      between.reduce((total, match) => total + (match.points[entry.name] ?? 0), 0),
    ]),
  );
}

/**
 * A run of level units split into levels, best first: ordered by its mini-table, then each smaller group still level on
 * it ordered again by the matches among only its members, until a group is the whole run it was cut from (a cycle) and
 * stays level.
 */
function splitIntoLevels<T extends { name: string }>(run: T[], matches: readonly GroupMatchPoints[]): T[][] {
  const points = miniTable(run, matches);
  const pointsOf = (entry: T) => points.get(entry.name) ?? 0;
  const sorted = [...run].sort((first, second) =>
    samePoints(pointsOf(first), pointsOf(second)) ? 0 : pointsOf(second) - pointsOf(first),
  );
  const groups: T[][] = [];
  for (const entry of sorted) {
    const group = groups.at(-1);
    if (group && samePoints(pointsOf(group[0]), pointsOf(entry))) group.push(entry);
    else groups.push([entry]);
  }
  if (groups.length === 1) return groups;
  return groups.flatMap((group) => (group.length < 2 ? [group] : splitIntoLevels(group, matches)));
}

/**
 * One run of units level on points per match, best first: by head to head, and units still level on it by room share.
 * Each carries the points it took from the run's matches (`headToHead`, the first mini-table, for display) and the
 * position its final head-to-head level starts at (`headToHeadLevel`): units still level after every split share it.
 */
function orderByHeadToHead(
  run: TournamentStanding[],
  matches: readonly GroupMatchPoints[],
): TournamentStanding[] {
  const points = miniTable(run, matches);
  let position = 0;
  return splitIntoLevels(run, matches).flatMap((level) => {
    const start = position;
    position += level.length;
    return [...level]
      .sort((first, second) =>
        sameRoomShare(first.roomShare ?? null, second.roomShare ?? null)
          ? 0
          : (second.roomShare ?? 0) - (first.roomShare ?? 0),
      )
      .map((entry) => ({ ...entry, headToHead: points.get(entry.name) ?? 0, headToHeadLevel: start }));
  });
}

/**
 * A group's table (ordered by points per match) with each run of units level on it ordered by the head-to-head points
 * of the matches they played against each other: two units by their own match, three or more by a mini-table of only
 * those matches (both legs of a double round robin), and a smaller group still level on it by a mini-table of only its
 * own matches, and so on. Units still level on head to head are ordered by room share; units level on that too stay
 * level, for the organiser. `matches` are the group's played matches.
 */
export function withHeadToHead(
  table: TournamentStanding[],
  matches: readonly GroupMatchPoints[],
): TournamentStanding[] {
  const output: TournamentStanding[] = [];
  let first = 0;
  while (first < table.length) {
    let last = first;
    while (
      last + 1 < table.length &&
      samePoints(rankingPoints(table[last + 1]), rankingPoints(table[first]))
    ) {
      last += 1;
    }
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
