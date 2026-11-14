import { describe, expect, it } from 'vitest';
import { computeGroupStandings } from '../advancement';
import { generateTournament } from '../generation';
import { groupSwapClears, groupSwapWindow, swapBetweenGroups } from '../group-swap';
import { resetTournamentState } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { roomPairKey } from '../seeding';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { scoreCurrentRound } from './play-through';
import { fixedIdSource, generatedState } from './test-fixtures';

type Setup = Parameters<typeof createDefaultSetup>[0];

const teamsOf = (count: number, size: number): TournamentTeam[] =>
  Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: size }, (_, slot) => ({ name: `p${index}-${slot}` })),
  }));

/** A group stage generated for `count` units, not started: individuals head to head unless the setup says otherwise. */
function drawn(count: number, setup: Setup = {}): TournamentState {
  const teamSize = setup.gameFormat === 'team-2v2' ? 2 : 0;
  return generatedState(
    generateTournament(
      createDefaultTournamentState({
        confirmedCount: count,
        players: teamSize
          ? teamsOf(count, teamSize)
          : Array.from({ length: count }, (_, index) => `P${index + 1}`),
      }),
      createDefaultSetup({
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        scheduleLogic: 'single-elimination',
        ...setup,
      }),
      createTournamentRuntime({ ids: fixedIdSource() }),
    ),
  );
}

const started = (state: TournamentState): TournamentState => ({ ...state, started: true });

const groupRounds = (state: TournamentState) => state.rounds.filter((round) => round.isGroupStage);

const sizesOf = (state: TournamentState) => state.groups.map((group) => group.members.length);

const groupOf = (state: TournamentState, name: string) =>
  state.groups.find((group) => group.members.includes(name))?.label;

/** The unit seated in `room` of Round 1 at `position` (0 or 1). */
const seat = (state: TournamentState, room: number, position: number) =>
  (state.assignments[0] ?? []).filter((entry) => entry.room === room)[position].name;

/** Every pair of every group meets exactly `legs` times over the group rounds, and nobody meets outside the group. */
function expectCompleteRoundRobin(state: TournamentState, legs = 1) {
  const met = new Map<string, number>();
  for (const round of groupRounds(state)) {
    round.matches?.forEach((match, index) => {
      expect(groupOf(state, match.pair[0])).toBe(match.group);
      expect(groupOf(state, match.pair[1])).toBe(match.group);
      expect(round.roomGroups?.[index]).toBe(match.group);
      const key = roomPairKey(match.pair[0], match.pair[1]);
      met.set(key, (met.get(key) ?? 0) + 1);
    });
  }
  for (const group of state.groups) {
    for (const [index, first] of group.members.entries()) {
      for (const second of group.members.slice(index + 1)) {
        expect(met.get(roomPairKey(first, second))).toBe(legs);
      }
    }
    // A group's units are on a bye or in a match each round, never both and never twice.
    for (const round of groupRounds(state)) {
      const seated = [
        ...(round.matches ?? [])
          .filter((match) => match.group === group.label)
          .flatMap((match) => match.pair),
        ...(round.groupByes ?? []).filter((name) => group.members.includes(name)),
      ];
      expect(new Set(seated).size).toBe(seated.length);
    }
  }
  expect(met.size).toBe(
    state.groups.reduce((sum, group) => sum + (group.members.length * (group.members.length - 1)) / 2, 0),
  );
}

/** Types a score into every seat of the given rooms of the round in play. */
function scoreRooms(state: TournamentState, rooms: number[], teamSize = 0): TournamentState {
  const scores = { ...state.scores };
  for (const room of rooms) {
    (state.assignments[state.curRound] ?? [])
      .filter((entry) => entry.room === room)
      .forEach((_, position) => {
        for (const key of scoreKeysForPosition({
          roundIndex: state.curRound,
          room,
          position,
          numGames: state.rounds[state.curRound].numGames ?? 1,
          teamSize: teamSize || undefined,
        })) {
          scores[key] = position === 0 ? 30 : 20;
        }
      });
  }
  return { ...state, scores };
}

const scoredKeys = (state: TournamentState, room: number) =>
  Object.keys(state.scores).filter((key) => key.startsWith(`r0-rm${room}-`) && state.scores[key] !== null);

function swapped(state: TournamentState, first: string, second: string): TournamentState {
  const result = swapBetweenGroups(state, first, second);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('swapping two units between groups before the start: 13 units in groups of 4 (5, 4, 4)', () => {
  const state = drawn(13);
  const first = state.groups[0].members[1];
  const second = state.groups[1].members[2];
  const result = swapped(state, first, second);

  it('exchanges the two names in place and keeps the group sizes', () => {
    expect(sizesOf(state)).toEqual([5, 4, 4]);
    expect(sizesOf(result)).toEqual([5, 4, 4]);
    expect(result.groups[0].members[1]).toBe(second);
    expect(result.groups[1].members[2]).toBe(first);
    expect(result.groups[0].members.filter((_, index) => index !== 1)).toEqual(
      state.groups[0].members.filter((_, index) => index !== 1),
    );
    expect(result.groups[2]).toEqual(state.groups[2]);
  });

  it('moves the pairs and byes of every group round, and the Round 1 seats, with them', () => {
    const rename = (name: string) => (name === first ? second : name === second ? first : name);
    groupRounds(state).forEach((round, index) => {
      const after = groupRounds(result)[index];
      expect(after.matches).toEqual(
        round.matches?.map((match) => ({ ...match, pair: match.pair.map(rename) })),
      );
      expect(after.groupByes).toEqual(round.groupByes?.map(rename));
      expect(after.roomGroups).toEqual(round.roomGroups);
      expect([after.rooms, after.byeCount, after.players]).toEqual([
        round.rooms,
        round.byeCount,
        round.players,
      ]);
    });
    expect(result.assignments[0].map((entry) => [entry.room, entry.name])).toEqual(
      state.assignments[0].map((entry) => [entry.room, rename(entry.name)]),
    );
    expect(result.byes[0]).toEqual(state.byes[0].map(rename));
  });

  it('leaves every pair of every group meeting exactly once', () => {
    expectCompleteRoundRobin(state);
    expectCompleteRoundRobin(result);
  });

  it('remembers the new Round 1 pairs in the room history, not the old ones', () => {
    const roomOf = (name: string) => state.assignments[0].find((entry) => entry.name === name)?.room;
    const opponent = (name: string) =>
      state.assignments[0].find((entry) => entry.room === roomOf(name) && entry.name !== name)?.name;
    const oldOpponent = opponent(first);
    expect(oldOpponent).toBeDefined();
    if (!oldOpponent) return;
    expect(state.roomHistory[roomPairKey(first, oldOpponent)]).toBe(0);
    expect(result.roomHistory[roomPairKey(first, oldOpponent)]).toBeUndefined();
    expect(result.roomHistory[roomPairKey(second, oldOpponent)]).toBe(0);
  });

  it('does not touch the state it was given', () => {
    expect(state.groups[0].members[1]).toBe(first);
    expect(groupOf(state, first)).toBe('A');
  });

  it('keeps the placeholder tables of the groups in step with their members', () => {
    expect(result.groupStandings.A.map((entry) => entry.name)).toEqual(result.groups[0].members);
    expect(result.groupStandings.B.map((entry) => entry.name)).toEqual(result.groups[1].members);
  });
});

describe('swapping during Round 1', () => {
  // Rooms 1-2 are group A's matches, 3-4 group B's, 5-6 group C's; group A's fifth unit is on a bye.
  const base = started(drawn(13));
  const inRoomOne = seat(base, 1, 0);
  const inRoomThree = seat(base, 3, 1);
  const scored = scoreRooms(base, [1, 3, 5]);

  it('clears the results of the two units rooms, and only those', () => {
    const result = swapped(
      { ...scored, absences: { 'r0-rm1-p1': 'absent', 'r0-rm5-p1': 'absent' } },
      inRoomOne,
      inRoomThree,
    );
    expect(scoredKeys(result, 1)).toEqual([]);
    expect(scoredKeys(result, 3)).toEqual([]);
    expect(scoredKeys(result, 5)).toHaveLength(2);
    expect(result.absences).toEqual({ 'r0-rm5-p1': 'absent' });
    expect(result.curRound).toBe(0);
    expect(result.started).toBe(true);
  });

  it('names the matches that would lose their results, for the confirmation', () => {
    expect(groupSwapClears(scored, inRoomOne, inRoomThree)).toEqual([
      { room: 1, units: [seat(base, 1, 0), seat(base, 1, 1)] },
      { room: 3, units: [seat(base, 3, 0), seat(base, 3, 1)] },
    ]);
    expect(groupSwapClears(base, inRoomOne, inRoomThree)).toEqual([]);
    expect(groupSwapClears(scoreRooms(base, [5]), inRoomOne, inRoomThree)).toEqual([]);
  });

  it('clears a room that holds only an absence, no score yet', () => {
    const marked = { ...base, absences: { 'r0-rm1-p1': 'absent' as const } };
    expect(groupSwapClears(marked, inRoomOne, inRoomThree)).toEqual([
      { room: 1, units: [seat(base, 1, 0), seat(base, 1, 1)] },
    ]);
    expect(swapped(marked, inRoomOne, inRoomThree).absences).toEqual({});
  });

  it('shows the swapped units without a result in the standings, and the others as they were', () => {
    const result = swapped(scored, inRoomOne, inRoomThree);
    const rows = Object.values(computeGroupStandings(result)).flat();
    const played = (name: string) => rows.find((row) => row.name === name)?.rounds?.length ?? 0;
    for (const name of [seat(base, 1, 0), seat(base, 1, 1), seat(base, 3, 0), seat(base, 3, 1)]) {
      expect(played(name)).toBe(0);
    }
    expect(played(seat(base, 5, 0))).toBe(1);
    expect(played(seat(base, 5, 1))).toBe(1);
  });

  it('clears the room tie resolutions of the cleared rooms and the group cut-off ties', () => {
    const result = swapped(
      { ...scored, tieResolutions: { 'r0-rm1-0': ['a'], 'r0-rm5-0': ['b'], 'group-cutoff-A': ['c'] } },
      inRoomOne,
      inRoomThree,
    );
    expect(Object.keys(result.tieResolutions)).toEqual(['r0-rm5-0']);
  });

  it('with a unit on a bye, clears only the match of the other', () => {
    const [onBye] = base.rounds[0].groupByes ?? [];
    expect(onBye).toBeDefined();
    const other = seat(base, 3, 0);
    expect(groupOf(base, onBye)).not.toBe(groupOf(base, other));
    const result = swapped(scoreRooms(base, [1, 3, 5]), onBye, other);
    expect(scoredKeys(result, 3)).toEqual([]);
    expect(scoredKeys(result, 1)).toHaveLength(2);
    expect(scoredKeys(result, 5)).toHaveLength(2);
    expect(result.rounds[0].groupByes).toContain(other);
    expect(result.byes[0]).toContain(other);
    expect(result.byes[0]).not.toContain(onBye);
    expect(result.assignments[0].find((entry) => entry.name === other)?.room).toBeNull();
    expect(result.assignments[0].find((entry) => entry.name === onBye)?.room).toBe(3);
  });
});

describe('swapping teams of 2 scored by the sum of their members', () => {
  const base = started(drawn(13, { gameFormat: 'team-2v2', teamScoringRule: 'sum-members' }));
  const first = seat(base, 1, 0);
  const second = seat(base, 3, 1);
  const scored = scoreRooms(base, [1, 3, 5], 2);

  it('clears the score of every member of the two rooms', () => {
    expect(scoredKeys(scored, 1)).toHaveLength(4);
    const result = swapped(scored, first, second);
    expect(scoredKeys(result, 1)).toEqual([]);
    expect(scoredKeys(result, 3)).toEqual([]);
    expect(scoredKeys(result, 5)).toHaveLength(4);
  });

  it('keeps the Save your Buddy defender changes: a team takes its defender into its new room', () => {
    const buddy = started(drawn(13, { gameFormat: 'team-2v2', teamScoringRule: 'designated-player' }));
    const first = seat(buddy, 1, 0);
    const second = seat(buddy, 3, 1);
    const defenderChanges = {
      [first]: [{ round: 0, memberIdx: 1 }],
      [second]: [{ round: 0, memberIdx: 1 }],
      [seat(buddy, 1, 1)]: [{ round: 0, memberIdx: 1 }],
    };
    const before = { ...scoreRooms(buddy, [1, 3], 2), defenderChanges };
    expect(swapped(before, first, second).defenderChanges).toEqual(defenderChanges);
    // A room holding only a defender choice has no result to lose: nothing to confirm.
    expect(groupSwapClears({ ...buddy, defenderChanges }, first, second)).toEqual([]);
  });
});

describe('the window', () => {
  const base = started(drawn(13));

  it('is open before the start and during Round 1', () => {
    expect(groupSwapWindow(drawn(13))).toBeNull();
    expect(groupSwapWindow(base)).toBeNull();
  });

  it('is closed once Round 2 is drawn, even when the view is back on Round 1', () => {
    const advanced = advanceTournamentRound(scoreCurrentRound(base, 0));
    if (advanced.status !== 'advanced') throw new Error(advanced.status);
    expect(groupSwapWindow(advanced.state)).toBe('Round 2 is drawn — groups are fixed from here.');
    expect(groupSwapWindow({ ...advanced.state, curRound: 0 })).toBe(
      'Round 2 is drawn — groups are fixed from here.',
    );
    const first = advanced.state.groups[0].members[0];
    const second = advanced.state.groups[1].members[0];
    expect(swapBetweenGroups(advanced.state, first, second)).toEqual({
      ok: false,
      error: 'Round 2 is drawn — groups are fixed from here.',
    });
  });

  it('refuses two units of one group, a unit in no group, and the same unit twice', () => {
    const [one, two] = base.groups[1].members;
    expect(swapBetweenGroups(base, one, two)).toEqual({
      ok: false,
      error: `${one} and ${two} are in the same group.`,
    });
    expect(swapBetweenGroups(base, one, one)).toEqual({
      ok: false,
      error: `${one} and ${one} are in the same group.`,
    });
    expect(swapBetweenGroups(base, one, 'Reserve')).toEqual({
      ok: false,
      error: "Reserve isn't in a group.",
    });
  });

  it('refuses a tournament with no group stage, and one with no schedule', () => {
    const qualification = drawn(13, { poolingPhase: 'qual-table' });
    expect(groupSwapWindow(qualification)).toBe('This tournament has no group stage.');
    expect(swapBetweenGroups(qualification, 'P1', 'P2')).toEqual({
      ok: false,
      error: 'This tournament has no group stage.',
    });
    const empty = createDefaultTournamentState({ cfg: { poolingPhase: 'group-stage' } });
    expect(groupSwapWindow(empty)).toBe('The schedule has not been generated yet.');
  });
});

describe('after Back to draft', () => {
  it('is closed until the schedule is generated again: the groups keep but Round 1 has no line-up', () => {
    const back = resetTournamentState(scoreRooms(started(drawn(13)), [1, 3]));
    expect(back.groups).toHaveLength(3);
    expect(groupSwapWindow(back)).toBe('Generate the schedule again to swap groups.');
    expect(swapBetweenGroups(back, back.groups[0].members[0], back.groups[1].members[0])).toEqual({
      ok: false,
      error: 'Generate the schedule again to swap groups.',
    });
  });

  it('is open again once the schedule is generated again', () => {
    const again = drawn(13);
    expect(groupSwapWindow(again)).toBeNull();
    const result = swapped(again, again.groups[0].members[0], again.groups[2].members[3]);
    expectCompleteRoundRobin(result);
  });
});

describe('a double round robin', () => {
  it('follows in both legs', () => {
    const state = drawn(13, { roundRobinMode: 'double' });
    const result = swapped(state, state.groups[0].members[4], state.groups[2].members[0]);
    expectCompleteRoundRobin(state, 2);
    expectCompleteRoundRobin(result, 2);
    expect(groupRounds(result)).toHaveLength(groupRounds(state).length);
  });
});

describe('31 units in groups of 4 and 3', () => {
  it('swaps across sizes and keeps the round robin complete', () => {
    const state = started(drawn(31));
    const big = state.groups.find((group) => group.members.length === 4);
    const small = state.groups.find((group) => group.members.length === 3);
    expect(big && small).toBeTruthy();
    if (!big || !small) return;
    const result = swapped(state, big.members[3], small.members[0]);
    expect(sizesOf(result)).toEqual(sizesOf(state));
    expect(groupOf(result, big.members[3])).toBe(small.label);
    expect(groupOf(result, small.members[0])).toBe(big.label);
    expectCompleteRoundRobin(state);
    expectCompleteRoundRobin(result);
  });
});
