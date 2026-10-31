import { describe, expect, it } from 'vitest';
import {
  compareStandings,
  computeGroupStandings,
  getAllTies,
  hasPendingTies,
  roomBasedComputeAdvancement,
  sameStanding,
} from '../advancement';
import { groupSeats, sameGroupStanding, usesGroupAverages } from '../group-standings';
import { removeRosterUnit } from '../mutations';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentStanding, TournamentState, WithdrawnUnit } from '../types';
import { buildState, scoreCurrentRound } from './play-through';
import { buildRound } from './test-fixtures';

/** One match of a hand-built group: the two units in room order, then their scores. */
type Match = [string, string, number, number];

interface GroupOptions {
  members: string[];
  absences?: Record<string, 'absent'>;
  withdrawn?: WithdrawnUnit[];
  /** False builds the tournament as it was stored before per-match standings. */
  averaged?: boolean;
}

/** One group A of `members`, a head-to-head round per entry of `rounds`, the last one in play. Standard points: a win 2, a loss 1. */
function groupState(rounds: Match[][], options: GroupOptions): TournamentState {
  const { members, absences = {}, withdrawn = [], averaged = true } = options;
  return createDefaultTournamentState({
    gameFormat: 'individual-1v1',
    started: true,
    curRound: rounds.length - 1,
    groups: [{ label: 'A', members }],
    gamemodeConfig: {
      roomSize: { min: 2, max: 2, ideal: 2 },
      pointsVersion: 2,
      absenceVersion: 1,
      ...(averaged ? { groupAverageVersion: 2 } : {}),
    },
    rounds: rounds.map((matches, index) =>
      buildRound({
        roundNum: index + 1,
        isGroupStage: true,
        rooms: matches.map(() => 2),
        roomGroups: matches.map(() => 'A'),
        players: matches.length * 2,
        matches: matches.map(([first, second]) => ({ group: 'A', pair: [first, second] })),
      }),
    ),
    assignments: rounds.map((matches) =>
      matches.flatMap(([first, second], index) => [
        { name: first, room: index + 1, isLucky: false },
        { name: second, room: index + 1, isLucky: false },
      ]),
    ),
    scores: Object.fromEntries(
      rounds.flatMap((matches, roundIndex) =>
        matches.flatMap(([, , firstScore, secondScore], index) => [
          [`r${roundIndex}-rm${index + 1}-p0`, firstScore],
          [`r${roundIndex}-rm${index + 1}-p1`, secondScore],
        ]),
      ),
    ),
    absences,
    withdrawnUnits: withdrawn,
  });
}

function swappedOut(name: string, replacedBy: string): WithdrawnUnit {
  return { name, label: name, members: null, playedAnyMatch: false, reason: 'swapped', replacedBy };
}

function removed(name: string): WithdrawnUnit {
  return { name, label: name, members: null, playedAnyMatch: true, reason: 'removed' };
}

function lineOf(state: TournamentState, name: string) {
  return computeGroupStandings(state).A.find((entry) => entry.name === name);
}

/** The organiser's group of 5: Team 5 is absent against T3 and T4, then swapped for reserve R, who loses to T1 and beats T2. */
const ORGANISER_ROUNDS: Match[][] = [
  [
    ['T1', 'T2', 300, 200],
    ['T3', 'T5', 100, 0],
  ],
  [
    ['T1', 'T3', 300, 200],
    ['T4', 'T5', 100, 0],
  ],
  [
    ['T1', 'T4', 200, 300],
    ['T2', 'T3', 300, 200],
  ],
  [
    ['T1', 'R', 300, 200],
    ['T2', 'T4', 300, 200],
  ],
  [
    ['T2', 'R', 200, 300],
    ['T3', 'T4', 300, 100],
  ],
];
const ORGANISER_GROUP: GroupOptions = {
  members: ['T1', 'T2', 'T3', 'T4', 'R'],
  absences: { 'r0-rm2-p1': 'absent', 'r1-rm2-p1': 'absent' },
  withdrawn: [swappedOut('T5', 'R')],
};

describe('usesGroupAverages', () => {
  it('asks only the groupAverageVersion field', () => {
    expect(usesGroupAverages({ gamemodeConfig: { groupAverageVersion: 2 } })).toBe(true);
    expect(usesGroupAverages({ gamemodeConfig: {} })).toBe(false);
  });
});

describe('groupSeats', () => {
  it('follows a swap chain to the unit now in the seat, and sees a removal through it', () => {
    const seats = groupSeats({
      withdrawnUnits: [swappedOut('A', 'B'), swappedOut('B', 'C'), removed('D')],
      rounds: [],
    });
    expect(seats.holderOf('A')).toBe('C');
    expect(seats.holderOf('B')).toBe('C');
    expect(seats.holderOf('E')).toBe('E');
    expect(seats.isRemoved('D')).toBe(true);
    expect(seats.isRemoved('A')).toBe(false);
    expect(
      groupSeats({ withdrawnUnits: [swappedOut('A', 'B'), removed('B')], rounds: [] }).isRemoved('A'),
    ).toBe(true);
  });

  it('counts a removal only if it was made during the group stage', () => {
    const rounds = [
      buildRound({ roundNum: 1, isGroupStage: true }),
      buildRound({ roundNum: 2, isGroupStage: true }),
    ];
    const leftAt = (round: number | undefined) =>
      groupSeats({
        withdrawnUnits: [{ ...removed('X'), round }],
        rounds: [...rounds, buildRound({ roundNum: 3 })],
      });
    expect(leftAt(0).isRemoved('X')).toBe(true);
    expect(leftAt(1).isRemoved('X')).toBe(true);
    expect(leftAt(2).isRemoved('X')).toBe(false);
    expect(leftAt(undefined).isRemoved('X')).toBe(true);
  });
});

describe('per-match group standings', () => {
  it("the organiser's group of 5: a bye and a void match give nothing, a no-show a counted 0, a swapped-in reserve takes over the seat's line", () => {
    const standings = computeGroupStandings(groupState(ORGANISER_ROUNDS, ORGANISER_GROUP)).A;
    expect(standings.map((entry) => entry.name)).toEqual(['T1', 'T2', 'T3', 'T4', 'R']);
    expect(standings.map((entry) => entry.totalFP)).toEqual([7, 6, 4, 4, 3]);
    expect(standings.map((entry) => entry.matches)).toEqual([4, 4, 3, 3, 4]);
    expect(standings.map((entry) => Number(entry.averagePoints?.toFixed(4)))).toEqual([
      1.75, 1.5, 1.3333, 1.3333, 0.75,
    ]);
  });

  it('orders units equal per match by their room share', () => {
    const [, , t3, t4] = computeGroupStandings(groupState(ORGANISER_ROUNDS, ORGANISER_GROUP)).A;
    expect([t3.name, t4.name]).toEqual(['T3', 'T4']);
    expect(sameStanding(t3, t4)).toBe(false);
    expect(t3.roomShare ?? 0).toBeGreaterThan(t4.roomShare ?? 0);
  });

  it("the replacement's line holds the absences at 0, then its own results", () => {
    const state = groupState(ORGANISER_ROUNDS, ORGANISER_GROUP);
    const reserve = lineOf(state, 'R');
    const absence = { score: null, rank: null, points: 0, bye: false };
    expect(reserve?.rounds).toEqual([
      { roundIndex: 0, ...absence },
      { roundIndex: 1, ...absence },
      { roundIndex: 3, score: 200, rank: 2, points: 1, bye: false },
      { roundIndex: 4, score: 300, rank: 1, points: 2, bye: false },
    ]);
    expect(lineOf(state, 'T5')).toBeUndefined();
  });

  it('a swap chain A → B → C: C holds the results of A and of B', () => {
    const state = groupState(
      [
        [
          ['A', 'X', 300, 200],
          ['Y', 'Z', 300, 200],
        ],
        [
          ['B', 'Y', 100, 200],
          ['X', 'Z', 300, 200],
        ],
        [
          ['C', 'Z', 300, 200],
          ['X', 'Y', 300, 200],
        ],
      ],
      { members: ['C', 'X', 'Y', 'Z'], withdrawn: [swappedOut('A', 'B'), swappedOut('B', 'C')] },
    );
    const line = lineOf(state, 'C');
    expect(line?.rounds?.map((round) => [round.roundIndex, round.points])).toEqual([
      [0, 2],
      [1, 1],
      [2, 2],
    ]);
    expect(line?.matches).toBe(3);
    expect(lineOf(state, 'X')?.rounds?.map((round) => round.points)).toEqual([1, 2, 2]);
  });

  describe('a removal voids the unit’s matches for the whole group, past and future', () => {
    const rounds: Match[][] = [
      [
        ['X', 'T3', 300, 200],
        ['T1', 'T2', 300, 200],
      ],
      [
        ['T1', 'T3', 300, 200],
        ['T2', 'X', 100, 200],
      ],
      [['T2', 'T3', 300, 200]],
    ];
    const group = { members: ['T1', 'T2', 'T3'], withdrawn: [removed('X')] };

    it('drops every result against the removed unit, so T3 is not left with the loss to it', () => {
      const state = groupState(rounds, group);
      expect(lineOf(state, 'T3')?.rounds?.map((round) => round.roundIndex)).toEqual([1, 2]);
      expect(lineOf(state, 'T3')?.totalFP).toBe(2);
      expect(lineOf(state, 'T3')?.matches).toBe(2);
      expect(lineOf(state, 'T2')?.rounds?.map((round) => round.roundIndex)).toEqual([0, 2]);
      expect(lineOf(state, 'X')).toBeUndefined();
    });

    it('gives the others nothing for a bye', () => {
      const state = groupState(rounds, group);
      state.rounds[2] = { ...state.rounds[2], groupByes: ['T1', 'X'] };
      expect(lineOf(state, 'T1')?.rounds?.map((round) => round.roundIndex)).toEqual([0, 1]);
      expect(lineOf(state, 'T1')?.matches).toBe(2);
    });

    it('voids both legs of a double round robin', () => {
      const state = groupState([[['X', 'T1', 300, 200]], [['T1', 'X', 300, 200]], [['T1', 'T2', 300, 200]]], {
        members: ['T1', 'T2'],
        withdrawn: [removed('X')],
      });
      expect(lineOf(state, 'T1')?.rounds?.map((round) => round.roundIndex)).toEqual([2]);
      expect(lineOf(state, 'T1')?.matches).toBe(1);
    });
  });

  it('ranks by points per match, not by the total: 4 points in 3 matches beat 5 points in 4', () => {
    // X is removed, so U's match against it is void: U has W, L, L (4 points, 1.33); V has W, L, L, L (5 points, 1.25).
    const state = groupState(
      [
        [
          ['U', 'A', 300, 200],
          ['B', 'V', 300, 200],
          ['C', 'Y', 300, 200],
        ],
        [
          ['B', 'U', 300, 200],
          ['C', 'V', 300, 200],
          ['A', 'Y', 300, 200],
        ],
        [
          ['C', 'U', 300, 200],
          ['Y', 'V', 300, 200],
          ['A', 'B', 300, 200],
        ],
        [
          ['V', 'A', 300, 200],
          ['X', 'U', 300, 200],
          ['B', 'C', 300, 200],
        ],
      ],
      { members: ['U', 'V', 'A', 'B', 'C', 'Y'], withdrawn: [removed('X')] },
    );
    const table = computeGroupStandings(state).A;
    const u = table.find((entry) => entry.name === 'U');
    const v = table.find((entry) => entry.name === 'V');
    expect([u?.totalFP, u?.matches]).toEqual([4, 3]);
    expect([v?.totalFP, v?.matches]).toEqual([5, 4]);
    expect(table.findIndex((entry) => entry.name === 'U')).toBeLessThan(
      table.findIndex((entry) => entry.name === 'V'),
    );
  });

  describe('a unit whose every match is void', () => {
    it('has no total and sorts last', () => {
      const state = groupState(
        [
          [
            ['X', 'T3', 300, 200],
            ['T1', 'T2', 300, 200],
          ],
        ],
        { members: ['T1', 'T2', 'T3'], withdrawn: [removed('X')] },
      );
      const table = computeGroupStandings(state).A;
      expect(table.at(-1)).toMatchObject({ name: 'T3', totalFP: null, matches: 0 });
      expect(table.at(-1)?.averagePoints).toBeUndefined();
      expect(table.map((entry) => entry.name)).toEqual(['T1', 'T2', 'T3']);
    });
  });

  describe('absences', () => {
    it('both units absent: each gets a counted 0', () => {
      const state = groupState([[['A', 'B', 0, 0]]], {
        members: ['A', 'B'],
        absences: { 'r0-rm1-p0': 'absent', 'r0-rm1-p1': 'absent' },
      });
      for (const name of ['A', 'B']) {
        expect(lineOf(state, name)).toMatchObject({ totalFP: 0, matches: 1, averagePoints: 0 });
      }
    });

    it('the unit that turned up gets nothing: the match is void for it', () => {
      const state = groupState([[['A', 'B', 100, 0]]], {
        members: ['A', 'B'],
        absences: { 'r0-rm1-p1': 'absent' },
      });
      expect(lineOf(state, 'A')).toMatchObject({ totalFP: null, matches: 0 });
      expect(lineOf(state, 'B')).toMatchObject({ totalFP: 0, matches: 1, averagePoints: 0 });
    });

    it('a unit absent in only one of two games is present: the game played at 0', () => {
      const state = groupState([[['A', 'B', 100, 0]]], {
        members: ['A', 'B'],
        absences: { 'r0-rm1-p1-g1': 'absent' },
      });
      state.rounds[0] = { ...state.rounds[0], numGames: 2 };
      state.scores = { 'r0-rm1-p0-g1': 100, 'r0-rm1-p1-g1': 0, 'r0-rm1-p0-g2': 50, 'r0-rm1-p1-g2': 60 };
      expect(lineOf(state, 'A')).toMatchObject({ totalFP: 2, matches: 1 });
      expect(lineOf(state, 'B')?.rounds).toEqual([
        { roundIndex: 0, score: 60, rank: 2, points: 1, bye: false },
      ]);
    });

    it('a team with one member absent is present: the match counts', () => {
      const generated = buildState({
        label: 'teams',
        count: 8,
        teams: true,
        setup: {
          gameFormat: 'team-2v2',
          poolingPhase: 'group-stage',
          groupSize: '4',
          qualifiersPerGroup: '2',
          qualAdv: '4',
        },
      });
      expect(generated).not.toBeNull();
      const scored = scoreCurrentRound(generated as TournamentState, 2);
      const keys = scoreKeysForPosition({ roundIndex: 0, room: 1, position: 0, numGames: 1, teamSize: 2 });
      const state: TournamentState = {
        ...scored,
        scores: { ...scored.scores, [keys[1]]: 0 },
        absences: { [keys[1]]: 'absent' },
      };
      const [first, second] = state.assignments[0].filter((entry) => entry.room === 1);
      const table = Object.values(computeGroupStandings(state)).flat();
      for (const name of [first.name, second.name]) {
        expect(table.find((entry) => entry.name === name)?.matches).toBe(1);
      }
    });
  });

  describe('the switch off', () => {
    it("keeps today's rule: the present unit takes a walkover win, no matches or averages are written", () => {
      const standings = computeGroupStandings(
        groupState(ORGANISER_ROUNDS, { ...ORGANISER_GROUP, averaged: false }),
      ).A;
      const t3 = standings.find((entry) => entry.name === 'T3');
      // A walkover win (2) against the absent Team 5, then L, L, W.
      expect(t3?.totalFP).toBe(2 + 1 + 1 + 2);
      for (const entry of standings) {
        expect(entry).not.toHaveProperty('matches');
        expect(entry).not.toHaveProperty('averagePoints');
      }
    });
  });
});

describe('a room that loses a unit to a removal in play', () => {
  function currentRoom() {
    const generated = buildState({
      label: 'removal',
      count: 8,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '4',
      },
    }) as TournamentState;
    const [first, second] = generated.assignments[0].filter((entry) => entry.room === 1);
    return { generated, first: first.name, second: second.name };
  }

  it('is void for the other unit before its score is typed', () => {
    const { generated, first, second } = currentRoom();
    const state = removeRosterUnit({ ...generated, scores: { 'r0-rm1-p0': 500 } }, second);
    const table = Object.values(computeGroupStandings(state)).flat();
    expect(table.find((entry) => entry.name === first)).toMatchObject({ totalFP: null, matches: 0 });
    expect(table.some((entry) => entry.name === second)).toBe(false);
  });

  it('and after it', () => {
    const { generated, first, second } = currentRoom();
    const state = removeRosterUnit({ ...generated, scores: { 'r0-rm1-p0': 500, 'r0-rm1-p1': 300 } }, second);
    const table = Object.values(computeGroupStandings(state)).flat();
    expect(table.find((entry) => entry.name === first)).toMatchObject({ totalFP: null, matches: 0 });
  });
});

describe('groups of different sizes', () => {
  /**
   * Plays a group stage to its last round, each group's first member beating the rest, and returns the state with that
   * round scored. The biggest groups win by a smaller margin, so their winners have the lower room share. With
   * `intoBracket` the last round is advanced too.
   */
  function playedGroupStage(count: number, intoBracket = false): TournamentState {
    let state = buildState({
      label: `groups-${count}`,
      count,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '8',
        oddCountStrategy: 'bye',
      },
    }) as TournamentState;
    const lastRound = state.rounds.filter((round) => round.isGroupStage).length - 1;
    const biggest = Math.max(...state.groups.map((group) => group.members.length));
    for (let roundIndex = 0; roundIndex <= lastRound; roundIndex += 1) {
      const seen = new Map<number, number>();
      const scores = { ...state.scores };
      for (const entry of state.assignments[roundIndex] ?? []) {
        if (entry.room === null) continue;
        const position = seen.get(entry.room) ?? 0;
        seen.set(entry.room, position + 1);
        const group = state.groups.find((candidate) => candidate.members.includes(entry.name));
        const rank = group?.members.indexOf(entry.name) ?? 0;
        const gap = group?.members.length === biggest ? 1 : 10;
        scores[`r${roundIndex}-rm${entry.room}-p${position}`] = 1000 - gap * rank;
      }
      state = { ...state, scores };
      if (roundIndex < lastRound || intoBracket) {
        const result = advanceTournamentRound(state);
        if (result.status !== 'advanced') throw new Error(`stuck at round ${roundIndex}: ${result.status}`);
        state = result.state;
      }
    }
    return state;
  }

  it.each([31, 37, 43, 53])(
    'at %i the group winners are equal on points per match whatever the size of the group, and ordered by room share',
    (count) => {
      const state = playedGroupStage(count);
      const standings = computeGroupStandings(state);
      const sizes = new Set(state.groups.map((group) => group.members.length));
      expect(sizes.size).toBeGreaterThan(1);
      const winners = state.groups.map((group) => standings[group.label][0]);
      for (const winner of winners) expect(winner.averagePoints).toBe(2);
      const biggest = state.groups.reduce((most, group) =>
        group.members.length > most.members.length ? group : most,
      );
      const smallest = state.groups.reduce((least, group) =>
        group.members.length < least.members.length ? group : least,
      );
      const big = standings[biggest.label][0];
      const small = standings[smallest.label][0];
      expect(big.matches).toBe(biggest.members.length - 1);
      expect(small.matches).toBe(smallest.members.length - 1);
      // The bigger group's winner has more matches, so more points in total, but the lower room share.
      expect(big.totalFP ?? 0).toBeGreaterThan(small.totalFP ?? 0);
      expect(big.roomShare ?? 0).toBeLessThan(small.roomShare ?? 0);
      const byShare = [...winners].sort((a, b) => (b.roomShare ?? 0) - (a.roomShare ?? 0));
      const sorted = [...winners].sort(compareStandings);
      expect(sorted.map((entry) => entry.name)).toEqual(byShare.map((entry) => entry.name));
      expect(sorted.indexOf(big)).toBeGreaterThan(sorted.indexOf(small));
    },
  );

  it('a qualifier removed from the bracket leaves the group results as they were', () => {
    const played = playedGroupStage(37, true);
    expect(played.rounds[played.curRound].isGroupStage).toBeFalsy();
    const before = computeGroupStandings(played);
    const group = played.groups[0];
    const qualifier = before[group.label][0].name;
    const after = computeGroupStandings(removeRosterUnit(played, qualifier));
    const others = (table: TournamentStanding[]) => table.filter((entry) => entry.name !== qualifier);
    expect(others(after[group.label])).toEqual(others(before[group.label]));
    expect(after[group.label].map((entry) => entry.name)).not.toContain(qualifier);
  });
});

describe('the head-to-head tie-break inside a group', () => {
  /** Round-robin results of A, B, C, D where A, B and C are level on points per match and room share (a cycle), D is last. */
  const CYCLE: Match[][] = [
    [
      ['A', 'B', 300, 200],
      ['C', 'D', 300, 200],
    ],
    [
      ['A', 'C', 200, 300],
      ['B', 'D', 300, 200],
    ],
    [
      ['B', 'C', 300, 200],
      ['A', 'D', 300, 200],
    ],
  ];
  const members = ['A', 'B', 'C', 'D'];

  function withQualifiers(state: TournamentState, qualifiersPerGroup: number): TournamentState {
    return { ...state, cfg: { ...state.cfg, qualifiersPerGroup } };
  }

  function tieOf(state: TournamentState) {
    return getAllTies(state, state.curRound)['group-cutoff-A'];
  }

  it('orders two units level on points per match and room share by the match they played', () => {
    // C loses to D instead: A and B are level at 5 points, C and D at 4.
    const rounds = CYCLE.map((round) => round.map((match) => [...match] as Match));
    rounds[0][1] = ['D', 'C', 300, 200];
    const state = withQualifiers(groupState(rounds, { members }), 1);
    const table = computeGroupStandings(state).A;
    expect(table.map((entry) => entry.name)).toEqual(['A', 'B', 'D', 'C']);
    const [a, b, d, c] = table;
    expect([a.headToHead, b.headToHead, d.headToHead, c.headToHead]).toEqual([2, 1, 2, 1]);
    expect(sameStanding(a, b)).toBe(true);
    expect(sameGroupStanding(a, b)).toBe(false);
    expect(tieOf(withQualifiers(state, 2))).toBeUndefined();
    expect(roomBasedComputeAdvancement(state, state.curRound).advancing.map((entry) => entry.name)).toEqual([
      'A',
    ]);
  });

  it('three units that each won once are still level after it: the organiser places them', () => {
    const state = withQualifiers(groupState(CYCLE, { members }), 2);
    const table = computeGroupStandings(state).A;
    expect(table.slice(0, 3).map((entry) => entry.headToHead)).toEqual([3, 3, 3]);
    expect(
      tieOf(state)
        ?.players.map((player) => player.name)
        .sort(),
    ).toEqual(['A', 'B', 'C']);
    expect(hasPendingTies(state, state.curRound)).toBe(true);
  });

  it('a double round robin that ends 1-1 between two units leaves them level', () => {
    const state = withQualifiers(
      groupState([[['A', 'B', 300, 200]], [['B', 'A', 300, 200]]], { members: ['A', 'B'] }),
      1,
    );
    const table = computeGroupStandings(state).A;
    expect(table.map((entry) => entry.headToHead)).toEqual([3, 3]);
    expect(tieOf(state)?.players).toHaveLength(2);
  });

  it('a mutual match voided by an absence gives nothing: they stay level', () => {
    // A and B are both absent against each other (a counted 0 each), then each beats C and D by the same margin.
    const state = withQualifiers(
      groupState(
        [
          [
            ['A', 'B', 0, 0],
            ['C', 'D', 300, 200],
          ],
          [
            ['A', 'C', 300, 200],
            ['B', 'D', 300, 200],
          ],
          [
            ['B', 'C', 300, 200],
            ['A', 'D', 300, 200],
          ],
        ],
        { members, absences: { 'r0-rm1-p0': 'absent', 'r0-rm1-p1': 'absent' } },
      ),
      1,
    );
    const table = computeGroupStandings(state).A;
    expect(table.slice(0, 2).map((entry) => [entry.name, entry.headToHead])).toEqual([
      ['A', 0],
      ['B', 0],
    ]);
    expect(tieOf(state)?.players.map((player) => player.name)).toEqual(['A', 'B']);
  });

  it('is not used across groups: the tier order ignores it', () => {
    const level = { totalFP: 5, totalScore: 0, played: 3, roomShare: 1, matches: 3, averagePoints: 5 / 3 };
    const first = { name: 'A', ...level, headToHead: 2 };
    const second = { name: 'X', ...level, headToHead: 4 };
    expect(sameStanding(first, second)).toBe(true);
    expect(compareStandings(first, second)).toBe(0);
  });

  it('the earlier group rule has no head-to-head step', () => {
    const state = groupState(CYCLE, { members, averaged: false });
    for (const entry of computeGroupStandings(state).A) expect(entry).not.toHaveProperty('headToHead');
  });
});
