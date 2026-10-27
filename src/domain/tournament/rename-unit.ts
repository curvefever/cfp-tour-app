import { roomPairKey } from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

type Rename = (name: string) => string;

function renameKeys<T>(record: Record<string, T>, rename: Rename): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [rename(key), value]));
}

/** Room history is keyed by pairs ("a|b", sorted), so a renamed name is re-paired and re-sorted. */
function renamePairKeys(history: Record<string, number>, rename: Rename): Record<string, number> {
  return Object.fromEntries(
    Object.entries(history).map(([key, value]) => {
      const [first = '', second = ''] = key.split('|');
      return [roomPairKey(rename(first), rename(second)), value];
    }),
  );
}

function renameAssignments(entries: RoundAssignment[], rename: Rename): RoundAssignment[] {
  return entries.map((entry) => ({ ...entry, name: rename(entry.name) }));
}

/** The names a round itself holds: a fixed draw's future rooms and a group stage's matches and byes. */
function renameRound(round: TournamentRound, rename: Rename): TournamentRound {
  return {
    ...round,
    ...(round.fixedRoomAssignments && {
      fixedRoomAssignments: renameAssignments(round.fixedRoomAssignments, rename),
    }),
    ...(round.matches && {
      matches: round.matches.map((match) => ({
        ...match,
        pair: [rename(match.pair[0]), rename(match.pair[1])] as [string, string],
      })),
    }),
    ...(round.groupByes && { groupByes: round.groupByes.map(rename) }),
  };
}

/**
 * Every place the schedule stores a unit's name, renamed: rounds, assignments, byes, bracket seats waiting for a
 * later round, groups, room history and anonymous finalists. A name left behind in any of them comes back as a
 * player who is no longer on the roster, so a rename must reach all of them.
 */
export function renameInSchedule(
  state: TournamentState,
  rename: Rename,
): Pick<
  TournamentState,
  | 'rounds'
  | 'assignments'
  | 'byes'
  | 'poolingByeCounts'
  | 'roomHistory'
  | 'pendingBracketSeeds'
  | 'qualTable'
  | 'groups'
  | 'groupStandings'
  | 'luckyLosers'
  | 'anonymousFinalists'
> {
  return {
    rounds: state.rounds.map((round) => renameRound(round, rename)),
    assignments: state.assignments.map((round) => renameAssignments(round, rename)),
    byes: state.byes.map((round) => round.map(rename)),
    poolingByeCounts: renameKeys(state.poolingByeCounts, rename),
    roomHistory: renamePairKeys(state.roomHistory, rename),
    pendingBracketSeeds: Object.fromEntries(
      Object.entries(state.pendingBracketSeeds).map(([key, seeds]) => [
        key,
        seeds.map((seed) => ({ ...seed, name: rename(seed.name) })),
      ]),
    ),
    qualTable: state.qualTable.map((entry) => ({ ...entry, name: rename(entry.name) })),
    groups: state.groups.map((group) => ({ ...group, members: group.members.map(rename) })),
    groupStandings: Object.fromEntries(
      Object.entries(state.groupStandings).map(([group, standings]) => [
        group,
        standings.map((entry) => ({ ...entry, name: rename(entry.name) })),
      ]),
    ),
    luckyLosers: state.luckyLosers.map((round) => round.map(rename)),
    anonymousFinalists: state.anonymousFinalists.map((finalist) => ({
      ...finalist,
      realKey: rename(finalist.realKey),
    })),
  };
}
