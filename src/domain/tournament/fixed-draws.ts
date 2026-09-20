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
