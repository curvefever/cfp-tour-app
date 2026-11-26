import { withoutSeatAbsences } from './absences';
import { getGameFormat } from './formats';
import { lateJoinersOf } from './late-joiners';
import { computeRankings } from './rankings';
import { invalidateStaleTieResolutions } from './room-ties';
import {
  findUnit,
  findUnstorableNames,
  isDisplayNameTaken,
  isWithdrawnName,
  rosterKey,
  teamNames,
  withoutUnit,
  withUnit,
} from './roster';
import { refused, type RosterEditResult } from './roster-edits';
import { roundInPlayOf } from './round-columns';
import { scoredTeamSize, scoreKeysForPosition } from './scoring';
import { inheritedAbsentRound, patchPublishedFutureRounds, recordWithdrawal } from './unit-removal';
import type { TournamentState, TournamentTeam } from './types';

/** A unit replaced by another: the substitute takes its seat wherever it is in play, while the swap window is open. */

function replaceAssignedUnit(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  const assignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  const roundIndex = roundInPlayOf(state, oldKey);
  const current = assignments[roundIndex] ?? [];
  const assignmentIndex = current.findIndex((entry) => entry.name === oldKey);
  if (assignmentIndex < 0) return null;

  const room = current[assignmentIndex].room;
  const position = current.filter((entry) => entry.room === room).findIndex((entry) => entry.name === oldKey);
  current[assignmentIndex].name = newKey;

  const scores = { ...state.scores };
  let absences = state.absences;
  // A unit marked absent leaves its seat's 0 and answer to the replacement, who missed that round too.
  if (room !== null && inheritedAbsentRound(state, oldKey) === undefined) {
    absences = withoutSeatAbsences(absences, roundIndex, room, position);
    for (const key of scoreKeysForPosition({
      roundIndex,
      room,
      position,
      numGames: Math.max(state.rounds[roundIndex].numGames ?? 1, 1),
      teamSize: scoredTeamSize(state),
    }))
      delete scores[key];
  }

  let next: TournamentState = {
    ...state,
    scores,
    absences,
    assignments,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    byes: state.byes.map((values, index) =>
      index === roundIndex ? values.map((name) => (name === oldKey ? newKey : name)) : values,
    ),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
  if (room !== null) next = invalidateStaleTieResolutions(next, roundIndex, room);
  return next;
}

function movePoolingByeCount(counts: Record<string, number>, oldKey: string, newKey: string) {
  if (counts[oldKey] === undefined) return counts;
  const { [oldKey]: moved, ...rest } = counts;
  return { ...rest, [newKey]: moved };
}

/**
 * A unit that has earned a place in a later round but isn't seated yet (it waits in a
 * pendingBracketSeeds pool) is replaced in place: the substitute takes the slot the
 * absentee earned, tierRank/pct/isLucky included. Null if the unit waits in no pool.
 */
function replacePendingUnit(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  const pools = Object.entries(state.pendingBracketSeeds);
  if (!pools.some(([, seeds]) => seeds.some((seed) => seed.name === oldKey))) return null;
  const pendingBracketSeeds = Object.fromEntries(
    pools.map(([destination, seeds]) => [
      destination,
      seeds.map((seed) => (seed.name === oldKey ? { ...seed, name: newKey } : seed)),
    ]),
  );
  return {
    ...state,
    pendingBracketSeeds,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
}

/**
 * A late joiner of the pooling round in play sits in no line-up yet, so there is no seat to hand over:
 * only its ranking-table row and bye count move. The roster swap that follows puts the substitute in
 * `players` unseated, so it is itself a late joiner, drawn in at the next advance. Null if the unit is
 * not a late joiner of the round in play.
 */
function replaceLateJoiner(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  if (!lateJoinersOf(state, state.curRound).includes(oldKey)) return null;
  return {
    ...state,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
}

/**
 * Seated in the current round, else waiting in a pending pool, else a late joiner of the pooling round
 * in play, else not in play (null).
 */
function replaceUnitInPlay(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  return (
    replaceAssignedUnit(state, oldKey, newKey) ??
    replacePendingUnit(state, oldKey, newKey) ??
    replaceLateJoiner(state, oldKey, newKey)
  );
}

/**
 * Reserves can stand in for an absentee only until anyone has been eliminated, in every format: until a round that
 * eliminated someone has been advanced. A unit already out in the round still in play (it has no rank yet) does not
 * close the window, as an absentee in a room not played yet can still be swapped.
 */
export function swapWindowOpen(state: TournamentState): boolean {
  return !computeRankings(state)?.eliminatedList.some((entry) => entry.rank !== null);
}

/**
 * The swap itself, once the incoming unit passed its checks: the outgoing unit leaves the roster (recorded as swapped
 * out), the incoming one takes its seat everywhere, and the bench gives it up if it sat there.
 */
function swapUnit(
  state: TournamentState,
  outgoingKey: string,
  incoming: string | TournamentTeam,
): RosterEditResult {
  const incomingKey = rosterKey(incoming);
  const replaced = replaceUnitInPlay(state, outgoingKey, incomingKey);
  if (!replaced) return refused('not-in-play');
  const withdrawn = recordWithdrawal(state, outgoingKey, 'swapped', incomingKey);

  return {
    status: 'done',
    state: patchPublishedFutureRounds(
      {
        ...replaced,
        withdrawnUnits: withdrawn.withdrawnUnits,
        players: withUnit(withoutUnit(state.players, outgoingKey), incoming),
        reserves: withoutUnit(state.reserves, incomingKey),
        groups: state.groups.map((group) => ({
          ...group,
          members: group.members.map((name) => (name === outgoingKey ? incomingKey : name)),
        })),
      },
      outgoingKey,
      incomingKey,
    ),
  };
}

export function swapIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const result = swapIndividualResult(state, oldName, newName);
  return result.status === 'done' ? result.state : state;
}

export function swapIndividualResult(
  state: TournamentState,
  oldName: string,
  newName: string,
): RosterEditResult {
  const trimmed = newName.trim();
  if (!trimmed) return refused('empty-name');
  if (findUnit(state.players, trimmed) !== undefined) return refused('duplicate-name');
  if (isWithdrawnName(state, trimmed)) return refused('withdrawn-name');
  if (findUnstorableNames([trimmed]).length) return refused('unstorable-name');
  if (!swapWindowOpen(state)) return refused('swap-closed');
  return swapUnit(state, oldName, trimmed);
}

export function swapTeam(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): TournamentState {
  const result = swapTeamResult(state, oldTeamId, replacement);
  return result.status === 'done' ? result.state : state;
}

export function swapTeamResult(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): RosterEditResult {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  if (!teamSize) return refused('not-a-team-format');
  if (!swapWindowOpen(state)) return refused('swap-closed');
  if (findUnit(state.players, replacement.teamId) !== undefined) return refused('duplicate-name');
  // The outgoing team is being removed by this same swap and the replacement may be
  // taken from the reserves, so neither counts as a name collision.
  if (isDisplayNameTaken(state, replacement.teamName, [oldTeamId, replacement.teamId])) {
    return refused('duplicate-name');
  }
  if (findUnstorableNames(teamNames(replacement)).length) return refused('unstorable-name');
  return swapUnit(state, oldTeamId, replacement);
}
