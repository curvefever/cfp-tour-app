import { circleMethodSchedule } from './pooling';
import { assignWaveToRooms, recordRoomHistory, selectPoolingBye } from './seeding';
import type { RoundAssignment, TournamentRound } from './types';

/**
 * The whole qual-table/Swiss room schedule, computed once at generation
 * time from roster order alone -- never from live results. Used when
 * gamemodeConfig.drawPublication === 'fixed' instead of the live
 * tieredSeed()/swissFoldPair() reseed every other tournament uses. Stored
 * per-round on TournamentRound.fixedRoomAssignments (mirroring group-stage's
 * own matches/groupByes precedent) rather than pre-populated into
 * state.assignments, since a non-empty state.assignments[roundIndex] is
 * used elsewhere in the app as the "this round has been reached" signal
 * (see rankings.ts's lastAssignedRound, BracketView.tsx's PlaceholderRound
 * gate) -- populating it ahead of time would silently break both.
 */

export interface FixedRoomScheduleResult {
  rounds: RoundAssignment[][];
  roomHistory: Record<string, number>;
  poolingByeCounts: Record<string, number>;
}

/**
 * Swiss is always room-size-2 (pooling restricted to head-to-head formats),
 * so its fixed schedule is exactly circleMethodSchedule()'s own pairwise
 * round-robin over the whole roster -- the same primitive Group Stage
 * already uses per-group -- which guarantees zero repeat pairings through
 * its own numRounds. `roundCount` cycles through that schedule if it
 * exceeds numRounds (only reachable via a manual round-count override on a
 * very small roster) -- a true zero-repeat pairwise round-robin cannot
 * exceed numRounds without repeating, so cycling is the best any fixed
 * schedule can do at that point.
 */
export function buildFixedSwissSchedule(roster: string[], roundCount: number): RoundAssignment[][] {
  const schedule = circleMethodSchedule(roster.length);
  const rounds: RoundAssignment[][] = [];
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const pairs = schedule.rounds[roundIndex % schedule.numRounds] ?? [];
    const assignments: RoundAssignment[] = [];
    let room = 1;
    for (const [first, second] of pairs) {
      if (first === schedule.phantomPosition) {
        assignments.push({ name: roster[second], room: null, isLucky: false });
      } else if (second === schedule.phantomPosition) {
        assignments.push({ name: roster[first], room: null, isLucky: false });
      } else {
        assignments.push(
          { name: roster[first], room, isLucky: false },
          { name: roster[second], room, isLucky: false },
        );
        room += 1;
      }
    }
    rounds.push(assignments);
  }
  return rounds;
}

/**
 * Qual-table's fixed schedule -- room size can exceed 2 and vary round to
 * round, so circleMethodSchedule's pairwise construction doesn't apply.
 * Reuses assignWaveToRooms() (the same room-choice primitive tieredSeed
 * itself uses) wave by wave, with every candidate's tierRank held constant
 * at 0 -- there's no live skill signal to balance in a fixed draw, so
 * balanceCost is inert by construction and repeat-avoidance (diversityWeight
 * 1, balanceWeight 0) is the only real signal, matching the quality bar
 * tieredSeed already sets for the adaptive path, not exceeding it. Byes are
 * picked purely structurally via selectPoolingBye (fewest-byes-so-far),
 * exactly as the live path does.
 *
 * Known, accepted limitation: this is a greedy, no-lookahead search, same as
 * tieredSeed already is -- it can be forced into an avoidable-looking repeat
 * in a later wave by an earlier wave's locally-optimal choice, particularly
 * for dense small-field/large-room shapes. Not a new weakness introduced
 * here.
 */
export function buildFixedRoomSchedule(
  roster: string[],
  rounds: ReadonlyArray<Pick<TournamentRound, 'rooms' | 'byeCount'>>,
): FixedRoomScheduleResult {
  let roomHistory: Record<string, number> = {};
  const poolingByeCounts: Record<string, number> = {};
  const result: RoundAssignment[][] = [];

  for (const [roundIndex, round] of rounds.entries()) {
    let pool = roster;
    const byeAssignments: RoundAssignment[] = [];
    for (let i = 0; i < round.byeCount; i += 1) {
      const candidate = selectPoolingBye(
        pool.map((name) => ({ name })),
        poolingByeCounts,
      );
      if (!candidate) break;
      byeAssignments.push({ name: candidate.name, room: null, isLucky: false });
      poolingByeCounts[candidate.name] = (poolingByeCounts[candidate.name] ?? 0) + 1;
      pool = pool.filter((name) => name !== candidate.name);
    }

    const allRoomNumbers = round.rooms.map((_, index) => index + 1);
    const maxWave = Math.max(0, ...round.rooms);
    const roomMembersSoFar = new Map<number, string[]>(allRoomNumbers.map((room) => [room, []]));
    const roomBalanceSoFar = new Map<number, number>(allRoomNumbers.map((room) => [room, 0]));
    const roomAssignments: RoundAssignment[] = [];
    let cursor = 0;

    for (let wave = 0; wave < maxWave; wave += 1) {
      const waveRooms = allRoomNumbers.filter((room) => round.rooms[room - 1] > wave);
      const members = pool.slice(cursor, cursor + waveRooms.length).map((name) => ({ name, tierRank: 0 }));
      cursor += waveRooms.length;
      if (members.length === 0) continue;
      const assigned = assignWaveToRooms(members, waveRooms, roomMembersSoFar, roomBalanceSoFar, {
        roomHistory,
        targetRoundIndex: roundIndex,
        allRoomNumbers,
        diversityWeight: 1,
        balanceWeight: 0,
      });
      for (const { name, room } of assigned) {
        roomMembersSoFar.set(room, [...(roomMembersSoFar.get(room) ?? []), name]);
        roomAssignments.push({ name, room, isLucky: false });
      }
    }

    const roundAssignments = [...roomAssignments, ...byeAssignments];
    result.push(roundAssignments);
    roomHistory = recordRoomHistory(roomHistory, roundAssignments, roundIndex);
  }

  return { rounds: result, roomHistory, poolingByeCounts };
}

function removeFromFixedRound(round: TournamentRound, oldKey: string): TournamentRound {
  const entries = round.fixedRoomAssignments;
  if (!entries?.some((entry) => entry.name === oldKey)) return round;

  const remaining = entries.filter((entry) => entry.name !== oldKey);
  const roomSizes = new Map<number, number>();
  for (const entry of remaining) {
    if (entry.room !== null) roomSizes.set(entry.room, (roomSizes.get(entry.room) ?? 0) + 1);
  }
  // A room left with a single unit has nobody to play: that unit gets a bye,
  // like the unit whose published opponent is removed in Group Stage.
  const orphaned = (entry: RoundAssignment) => entry.room !== null && roomSizes.get(entry.room) === 1;
  const keptRooms = [...roomSizes.keys()].filter((room) => roomSizes.get(room) !== 1).sort((a, b) => a - b);
  const renumbered = new Map(keptRooms.map((room, index) => [room, index + 1]));

  const patched = remaining.map((entry) =>
    orphaned(entry) || entry.room === null
      ? { ...entry, room: null }
      : { ...entry, room: renumbered.get(entry.room) as number },
  );
  return {
    ...round,
    fixedRoomAssignments: patched,
    rooms: keptRooms.map((room) => roomSizes.get(room) as number),
    byeCount: patched.filter((entry) => entry.room === null).length,
    players: patched.length,
  };
}

function relabelFixedRound(round: TournamentRound, oldKey: string, newKey: string): TournamentRound {
  const entries = round.fixedRoomAssignments;
  if (!entries?.some((entry) => entry.name === oldKey)) return round;
  return {
    ...round,
    fixedRoomAssignments: entries.map((entry) =>
      entry.name === oldKey ? { ...entry, name: newKey } : entry,
    ),
  };
}

/**
 * Keeps the already-published future rounds of a fixed-draw tournament in
 * step with a roster change (the fixed-draw counterpart of
 * patchFutureGroupStageRounds, mutations.ts). Only rounds after `curRound`
 * are touched: the current round is handled by the mutation itself and past
 * rounds are history. Rounds that don't change are returned as-is.
 *
 * newKey is a string for "swapped": oldKey is relabeled, room shape is
 * unchanged. newKey is null for "removed": oldKey's entry is dropped, a room
 * left with one unit turns that unit into a bye, an emptied room disappears,
 * the remaining rooms are renumbered 1..k, and rooms/byeCount/players are
 * recomputed from the patched list.
 */
export function patchFutureFixedDrawRounds(
  rounds: TournamentRound[],
  curRound: number,
  oldKey: string,
  newKey: string | null,
): TournamentRound[] {
  const patched = rounds.map((round, index) => {
    if (index <= curRound || !round.fixedRoomAssignments) return round;
    return newKey === null ? removeFromFixedRound(round, oldKey) : relabelFixedRound(round, oldKey, newKey);
  });
  return patched.every((round, index) => round === rounds[index]) ? rounds : patched;
}

/**
 * Rebuilds roomHistory/poolingByeCounts for a fixed-draw tournament from the
 * rounds as they now stand: assignments for rounds already reached, the
 * published fixedRoomAssignments for the rest. generation.ts folds the same
 * two maps in once up front; after a roster change their future part is
 * stale (names the old unit, misses new byes, counts pairings that no longer
 * happen).
 */
export function rebuildFixedDrawHistory(
  rounds: TournamentRound[],
  assignments: RoundAssignment[][],
  curRound: number,
): Pick<FixedRoomScheduleResult, 'roomHistory' | 'poolingByeCounts'> {
  let roomHistory: Record<string, number> = {};
  const poolingByeCounts: Record<string, number> = {};
  for (const [roundIndex, round] of rounds.entries()) {
    const entries = roundIndex <= curRound ? assignments[roundIndex] : round.fixedRoomAssignments;
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.room === null) poolingByeCounts[entry.name] = (poolingByeCounts[entry.name] ?? 0) + 1;
    }
    roomHistory = recordRoomHistory(roomHistory, entries, roundIndex);
  }
  return { roomHistory, poolingByeCounts };
}
