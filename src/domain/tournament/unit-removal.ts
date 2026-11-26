import { hasPlayedAnyMatch, isUnitAbsentFromRoom, withSeatsShiftedUp } from './absences';
import { patchFutureFixedDrawRounds, rebuildFixedDrawHistory } from './fixed-draws';
import { replanFutureRounds } from './replan-future-rounds';
import { invalidateStaleTieResolutions } from './room-ties';
import { unitDisplay, withoutUnit } from './roster';
import { roundInPlayOf } from './round-columns';
import { scoredTeamSize, scoreKeysForPosition } from './scoring';
import type { TournamentRound, TournamentState, WithdrawnUnit } from './types';

/** Removing a unit from the roster, and what a removal shares with a swap: the withdrawal record, the published rounds, the absence handed on. */

function removeUnitFromCurrentRoom(state: TournamentState, key: string): TournamentState {
  const roundIndex = roundInPlayOf(state, key);
  const assignments = state.assignments[roundIndex] ?? [];
  const found = assignments.find((entry) => entry.name === key);
  if (!found || found.room === null) {
    return {
      ...state,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    };
  }
  const room = found.room;
  const roomUnits = assignments.filter((entry) => entry.room === room);
  const position = roomUnits.findIndex((entry) => entry.name === key);
  const scores = { ...state.scores };
  const round = state.rounds[roundIndex];
  const keysAtPosition = (positionIndex: number) =>
    scoreKeysForPosition({
      roundIndex,
      room,
      position: positionIndex,
      numGames: Math.max(round.numGames ?? 1, 1),
      teamSize: scoredTeamSize(state),
    });

  for (let index = position + 1; index < roomUnits.length; index += 1) {
    const from = keysAtPosition(index);
    const to = keysAtPosition(index - 1);
    from.forEach((fromKey, offset) => {
      const toKey = to[offset];
      if (scores[fromKey] !== undefined) scores[toKey] = scores[fromKey];
      else delete scores[toKey];
    });
  }
  for (const scoreKey of keysAtPosition(roomUnits.length - 1)) delete scores[scoreKey];
  return invalidateStaleTieResolutions(
    {
      ...state,
      scores,
      absences: withSeatsShiftedUp(state.absences, roundIndex, room, position),
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    },
    roundIndex,
    room,
  );
}

/** The other name in a group-stage pair, given one of its two members. */
function otherMember(pair: [string, string], key: string): string {
  return pair[0] === key ? pair[1] : pair[0];
}

/**
 * Patches every not-yet-reached group-stage round (index > state.curRound)
 * so a roster change already applied to state.groups doesn't leave a ghost
 * name baked into that round's matches/groupByes -- removeRosterUnit's
 * strip() and swapIndividual/swapTeam's groups remap only ever touch
 * state.groups, never the future TournamentRound objects that were built
 * from group membership once, upfront, at generation time.
 *
 * newKey === null means "removed": oldKey's future match becomes a bye for
 * its surviving opponent -- the same fallback buildRoundRobinRounds already
 * uses when a group's own round-robin schedule runs out early. If oldKey was
 * already scheduled as a bye that round, it's simply dropped. Either way,
 * rooms/byeCount/players are recomputed, and a dropped match's roomGroups
 * entry (same index) is filtered in lockstep so room numbers -- derived
 * fresh from array position by seedFromGroupStageRound/BracketView -- keep
 * lining up with the right group label after the shift.
 *
 * newKey is a string for "swapped": oldKey is relabeled to newKey wherever
 * it appears. Group size is unchanged by a swap, so rooms/byeCount/players/
 * roomGroups are left untouched.
 *
 * A no-op outside group-stage pooling.
 */
function patchFutureGroupStageRounds(
  state: TournamentState,
  oldKey: string,
  newKey: string | null,
): TournamentRound[] {
  if (state.cfg.poolingPhase !== 'group-stage') return state.rounds;

  return state.rounds.map((round, index) => {
    if (index <= state.curRound || !round.isGroupStage) return round;
    const matches = round.matches ?? [];
    const groupByes = round.groupByes ?? [];

    if (newKey !== null) {
      const relabel = (name: string) => (name === oldKey ? newKey : name);
      const touchesOldKey =
        matches.some((match) => match.pair.includes(oldKey)) || groupByes.includes(oldKey);
      if (!touchesOldKey) return round;
      return {
        ...round,
        matches: matches.map((match) => ({ ...match, pair: match.pair.map(relabel) as [string, string] })),
        groupByes: groupByes.map(relabel),
      };
    }

    if (groupByes.includes(oldKey)) {
      const nextGroupByes = groupByes.filter((name) => name !== oldKey);
      return {
        ...round,
        groupByes: nextGroupByes,
        byeCount: nextGroupByes.length,
        players: round.players - 1,
      };
    }

    const matchIndex = matches.findIndex((match) => match.pair.includes(oldKey));
    if (matchIndex < 0) return round;
    const survivor = otherMember(matches[matchIndex].pair, oldKey);
    const nextMatches = matches.filter((_, position) => position !== matchIndex);
    const nextRoomGroups = round.roomGroups?.filter((_, position) => position !== matchIndex);
    const nextGroupByes = [...groupByes, survivor];
    return {
      ...round,
      matches: nextMatches,
      roomGroups: nextRoomGroups,
      groupByes: nextGroupByes,
      rooms: nextMatches.map(() => 2),
      byeCount: nextGroupByes.length,
      players: round.players - 1,
    };
  });
}

/**
 * Applies a roster change (removal when newKey is null, else a swap) to every
 * pre-published future round -- Group Stage's baked-in matches and a
 * fixed-draw tournament's fixedRoomAssignments. For fixed draws, roomHistory/
 * poolingByeCounts are then rebuilt, since generation folded the whole
 * published schedule into both and their future part just changed.
 */
export function patchPublishedFutureRounds(
  state: TournamentState,
  oldKey: string,
  newKey: string | null,
): TournamentState {
  const groupPatched = patchFutureGroupStageRounds(state, oldKey, newKey);
  const rounds = patchFutureFixedDrawRounds(groupPatched, state.curRound, oldKey, newKey);
  const hasFixedFuture = rounds.some((round, index) => index > state.curRound && round.fixedRoomAssignments);
  if (!hasFixedFuture) return { ...state, rounds };
  return { ...state, rounds, ...rebuildFixedDrawHistory(rounds, state.assignments, state.curRound) };
}

/** A removed unit must not be drawn into a later round it was only waiting for. */
function withoutPendingUnit(
  pools: TournamentState['pendingBracketSeeds'],
  key: string,
): TournamentState['pendingBracketSeeds'] {
  return Object.fromEntries(
    Object.entries(pools).map(([destination, seeds]) => [
      destination,
      seeds.filter((seed) => seed.name !== key),
    ]),
  );
}

export function removeRosterUnit(state: TournamentState, key: string): TournamentState {
  let next = removeUnitFromCurrentRoom(recordWithdrawal(state, key, 'removed'), key);
  const strip = (values: string[]) => values.filter((name) => name !== key);
  const tieResolutions = Object.fromEntries(
    Object.entries(next.tieResolutions).map(([tieKey, value]) => {
      const filtered = (Array.isArray(value) ? value : [value]).filter((name) => name !== key);
      return [tieKey, Array.isArray(value) ? filtered : (filtered[0] ?? '')];
    }),
  );
  next = {
    ...next,
    players: withoutUnit(next.players, key),
    reserves: withoutUnit(next.reserves, key),
    qualTable: next.qualTable.filter((entry) => entry.name !== key),
    pendingBracketSeeds: withoutPendingUnit(next.pendingBracketSeeds, key),
    luckyLosers: next.luckyLosers.map(strip),
    byes: next.byes.map(strip),
    groups: next.groups.map((group) => ({ ...group, members: strip(group.members) })),
    tieResolutions,
  };
  return replanFutureRounds(patchPublishedFutureRounds(next, key, null));
}

/**
 * Records `key`'s outgoing display info before it's stripped from
 * state.players -- must be called with the pre-removal `state`, since
 * unitDisplay()/hasPlayedAnyMatch() both depend on state.players/reserves/
 * assignments still containing `key`. A team's display name doesn't survive
 * being removed from the roster (the live TournamentTeam object is gone),
 * so this snapshot is the only place that information can still be captured.
 */
export function recordWithdrawal(
  state: TournamentState,
  key: string,
  reason: WithdrawnUnit['reason'],
  replacedBy?: string,
): TournamentState {
  const info = unitDisplay(state, key);
  const absentRound = reason === 'swapped' ? inheritedAbsentRound(state, key) : undefined;
  const entry: WithdrawnUnit = {
    name: key,
    label: info.label,
    members: info.members,
    playedAnyMatch: hasPlayedAnyMatch(state, key),
    reason,
    round: state.curRound,
    ...(replacedBy === undefined ? {} : { replacedBy }),
    ...(absentRound === undefined ? {} : { absentRound }),
  };
  return { ...state, withdrawnUnits: [...state.withdrawnUnits, entry] };
}

/**
 * The round of the seat a swap of `key` leaves to the replacement as an absence: the round in play, when `key` is seated
 * in a room and absent from it. Undefined for any other swap, which clears the seat.
 */
export function inheritedAbsentRound(state: TournamentState, key: string): number | undefined {
  const roundIndex = roundInPlayOf(state, key);
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room !== null);
  const found = seated.find((entry) => entry.name === key);
  if (found === undefined || found.room === null) return undefined;
  const room = found.room;
  const position = seated.filter((entry) => entry.room === room).findIndex((entry) => entry.name === key);
  return isUnitAbsentFromRoom(state, roundIndex, room, position) ? roundIndex : undefined;
}
