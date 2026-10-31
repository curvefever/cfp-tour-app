import { describe, expect, it } from 'vitest';
import { getAllTies, hasPendingTies, isTieResolved } from '../advancement';
import { generateTournament } from '../generation';
import {
  GROUP_EXIT_TIE_KEY,
  groupExitRefusal,
  groupExitSelection,
  groupExitShape,
  type GroupExitShape,
} from '../group-exit';
import { resolveTournamentTie } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { describeStandings } from '../standings-display';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type {
  GeneratedTournamentConfig,
  GroupExitMode,
  TournamentGroup,
  TournamentStanding,
  TournamentState,
  TournamentTeam,
} from '../types';
import { scoreCurrentRound } from './play-through';

type Setup = Parameters<typeof createDefaultSetup>[0];

/** The shape as `[direct, [place, fewest, most]…]` per size class, to read it against the worked examples. */
const classesOf = (shape: GroupExitShape) =>
  shape.classes.map((cls) => ({
    sizes: cls.sizes,
    groups: cls.groups.length,
    direct: cls.direct,
    chance: cls.chancePlaces.map((place) => [place.place, place.minSpots, place.maxSpots]),
  }));

function standing(name: string, points: number, share = 1): TournamentStanding {
  return {
    name,
    totalFP: points * 3,
    totalScore: 0,
    played: 3,
    matches: 3,
    averagePoints: points,
    roomShare: share,
  };
}

/** A group's table, best first: `A1`, `A2`, … with the given points per match. */
const table = (label: string, points: number[]): TournamentStanding[] =>
  points.map((value, index) => standing(`${label}${index + 1}`, value));

const groupsOf = (sizes: number[]): TournamentGroup[] =>
  sizes.map((size, index) => ({
    label: String.fromCharCode(65 + index),
    members: Array.from({ length: size }, (_, member) => `m${index}-${member}`),
  }));

function stateOf(
  sizes: number[],
  mode: GroupExitMode,
  amount: number,
  tieResolutions: Record<string, string[]> = {},
) {
  const cfg: Partial<GeneratedTournamentConfig> =
    mode === 'per-group' ? { qualifiersPerGroup: amount } : { groupExit: mode, qualAdv: amount };
  return { groups: groupsOf(sizes), cfg, tieResolutions };
}

const select = (
  sizes: number[],
  mode: GroupExitMode,
  amount: number,
  tables: TournamentStanding[][],
  tieResolutions: Record<string, string[]> = {},
) => groupExitSelection(stateOf(sizes, mode, amount, tieResolutions), tables);

/** Tables of three groups, 5, 4 and 4 teams, whose places below the direct ones carry the given points. */
const groups544 = (a3: number, a4: number, b3: number, c3: number) => [
  table('A', [3, 2.5, a3, a4, 0.2]),
  table('B', [3, 2.5, b3, 0.1]),
  table('C', [3, 2.5, c3, 0.1]),
];

describe('groupExitShape: the worked examples', () => {
  it('5, 4, 4 with 8 advancing', () => {
    expect(classesOf(groupExitShape([5, 4, 4], 'even-split', 8))).toEqual([
      { sizes: [5, 4], groups: 3, direct: 2, chance: [[3, 2, 2]] },
    ]);
    expect(classesOf(groupExitShape([5, 4, 4], 'fair-cut', 8))).toEqual([
      { sizes: [5], groups: 1, direct: 3, chance: [[4, 0, 1]] },
      { sizes: [4], groups: 2, direct: 2, chance: [[3, 0, 1]] },
    ]);
  });

  it('5, 5, 4 with 8 advancing', () => {
    expect(classesOf(groupExitShape([5, 5, 4], 'even-split', 8))).toEqual([
      { sizes: [5, 4], groups: 3, direct: 2, chance: [[3, 2, 2]] },
    ]);
    expect(classesOf(groupExitShape([5, 5, 4], 'fair-cut', 8))).toEqual([
      { sizes: [5], groups: 2, direct: 2, chance: [[3, 1, 2]] },
      { sizes: [4], groups: 1, direct: 2, chance: [[3, 0, 1]] },
    ]);
  });

  it('5, 4, 4 with 6 advancing', () => {
    expect(classesOf(groupExitShape([5, 4, 4], 'even-split', 6))).toEqual([
      { sizes: [5, 4], groups: 3, direct: 2, chance: [] },
    ]);
    expect(classesOf(groupExitShape([5, 4, 4], 'fair-cut', 6))).toEqual([
      { sizes: [5], groups: 1, direct: 2, chance: [[3, 0, 1]] },
      { sizes: [4], groups: 2, direct: 1, chance: [[2, 1, 2]] },
    ]);
  });

  it('5, 5, 4 with 6 advancing', () => {
    expect(classesOf(groupExitShape([5, 5, 4], 'even-split', 6))).toEqual([
      { sizes: [5, 4], groups: 3, direct: 2, chance: [] },
    ]);
    expect(classesOf(groupExitShape([5, 5, 4], 'fair-cut', 6))).toEqual([
      { sizes: [5], groups: 2, direct: 2, chance: [[3, 0, 1]] },
      { sizes: [4], groups: 1, direct: 1, chance: [[2, 0, 1]] },
    ]);
  });

  it('per group is one class: the same direct count everywhere, no chance place', () => {
    expect(classesOf(groupExitShape([5, 4, 4], 'per-group', 2))).toEqual([
      { sizes: [5, 4], groups: 3, direct: 2, chance: [] },
    ]);
  });
});

describe('groupExitSelection: 5, 4, 4 with 8 advancing', () => {
  it('even split: the top 2 of each group, plus the best 2 of the three 3rds', () => {
    const result = select([5, 4, 4], 'even-split', 8, groups544(1.0, 0.9, 1.5, 1.2));
    expect([...result.advancing].sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3']);
    expect(result.chance).toEqual(['B3', 'C3']);
    expect(result.cutByGroup).toEqual([2, 3, 3]);
  });

  it("fair cut, the group of 5's 4th beats the better 3rd of the groups of 4: it takes the spot", () => {
    const result = select([5, 4, 4], 'fair-cut', 8, groups544(2.0, 1.5, 1.2, 1.0));
    expect(result.chance).toEqual(['A4']);
    expect(result.cutByGroup).toEqual([4, 2, 2]);
    expect(result.throughByGroup).toEqual([
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ]);
  });

  it('fair cut, the 4th does not beat the better 3rd of the groups of 4: that 3rd takes it', () => {
    const result = select([5, 4, 4], 'fair-cut', 8, groups544(2.0, 1.0, 1.2, 1.1));
    expect(result.chance).toEqual(['B3']);
    expect(result.cutByGroup).toEqual([3, 3, 2]);
  });

  it('every group winner goes through whatever the points', () => {
    const tables = [
      table('A', [0.1, 0.05, 0.04, 0.03, 0.02]),
      table('B', [3, 2.5, 2, 1]),
      table('C', [3, 2.5, 2, 1]),
    ];
    for (const mode of ['even-split', 'fair-cut'] as const) {
      expect(select([5, 4, 4], mode, 8, tables).advancing).toContain('A1');
    }
  });
});

describe('groupExitSelection: 5, 5, 4', () => {
  const tables = (a3: number, b3: number, c3: number) => [
    table('A', [3, 2.5, a3, 0.3, 0.2]),
    table('B', [3, 2.5, b3, 0.3, 0.2]),
    table('C', [3, 2.5, c3, 0.1]),
  ];

  it.each([
    ['the group of 4 has the best 3rd', 1.4, 1.1, 1.6],
    ['the group of 4 has the worst 3rd', 1.4, 1.1, 0.5],
    ['both 3rds of the groups of 5 are below the other', 1.0, 0.9, 1.6],
  ])('8 advancing: both modes pick the same teams when %s', (_name, a3, b3, c3) => {
    const even = select([5, 5, 4], 'even-split', 8, tables(a3, b3, c3));
    const fair = select([5, 5, 4], 'fair-cut', 8, tables(a3, b3, c3));
    expect([...fair.advancing].sort()).toEqual([...even.advancing].sort());
    expect(fair.advancing).toHaveLength(8);
  });

  it('6 advancing, fair cut: the group of 4 takes its runner-up when it beats both 3rds of the groups of 5', () => {
    const result = select([5, 5, 4], 'fair-cut', 6, [
      table('A', [3, 2.5, 1.0, 0.3, 0.2]),
      table('B', [3, 2.5, 0.9, 0.3, 0.2]),
      table('C', [3, 2.0, 0.1, 0.05]),
    ]);
    expect(result.chance).toEqual(['C2']);
  });

  it('even split with 6 advancing is the top 2 of each, nothing left to the chance', () => {
    const result = select([5, 5, 4], 'even-split', 6, tables(1, 1, 1));
    expect(result.chance).toEqual([]);
    expect(result.cutByGroup).toEqual([2, 2, 2]);
  });
});

describe('groupExitSelection: 5, 4, 4 with 6 advancing, fair cut', () => {
  it("the group of 5's 3rd and the better runner-up of the groups of 4 take the two spots", () => {
    const result = select([5, 4, 4], 'fair-cut', 6, [
      table('A', [3, 2.5, 2.0, 0.3, 0.2]),
      table('B', [3, 1.8, 0.2, 0.1]),
      table('C', [3, 1.6, 0.2, 0.1]),
    ]);
    expect(result.chance).toEqual(['A3', 'B2']);
    expect(result.cutByGroup).toEqual([3, 2, 1]);
  });

  it('both runners-up of the groups of 4 take them when each beats the 3rd of the group of 5', () => {
    const result = select([5, 4, 4], 'fair-cut', 6, [
      table('A', [3, 2.5, 1.0, 0.3, 0.2]),
      table('B', [3, 2.0, 0.2, 0.1]),
      table('C', [3, 1.9, 0.2, 0.1]),
    ]);
    expect(result.chance).toEqual(['B2', 'C2']);
  });
});

describe('groupExitSelection: how the greedy keeps to the shape', () => {
  const direct2 = (label: string, points: number[]) => table(label, [3, 2.5, ...points]);

  it("within one size a lower place goes first: B's 3rd is taken before A's 4th that has more points", () => {
    const shape: GroupExitShape = {
      mode: 'fair-cut',
      amount: 6,
      classes: [
        {
          sizes: [5],
          groups: [0, 1],
          direct: 2,
          chancePlaces: [
            { place: 3, minSpots: 0, maxSpots: 2 },
            { place: 4, minSpots: 0, maxSpots: 1 },
          ],
          minSpots: 0,
          maxSpots: 2,
        },
      ],
    };
    const result = groupExitSelection(
      stateOf([5, 5], 'fair-cut', 6),
      [direct2('A', [2.0, 1.8, 0.2]), direct2('B', [1.0, 0.5, 0.1])],
      shape,
    );
    expect(result.chance).toEqual(['A3', 'B3']);
  });

  it('across sizes only the points count: a 4th of one size takes a spot before a 3rd of another', () => {
    const shape: GroupExitShape = {
      mode: 'fair-cut',
      amount: 5,
      classes: [
        {
          sizes: [5],
          groups: [0],
          direct: 2,
          chancePlaces: [{ place: 3, minSpots: 0, maxSpots: 1 }],
          minSpots: 0,
          maxSpots: 1,
        },
        {
          sizes: [4],
          groups: [1],
          direct: 2,
          chancePlaces: [{ place: 3, minSpots: 0, maxSpots: 1 }],
          minSpots: 0,
          maxSpots: 1,
        },
      ],
    };
    const result = groupExitSelection(
      stateOf([5, 4], 'fair-cut', 5),
      [direct2('A', [1.0, 0.5, 0.2]), direct2('B', [1.4, 0.1])],
      shape,
    );
    expect(result.chance).toEqual(['B3']);
  });

  it("a size's fewest spots stay reachable: the last spot goes to the size that still owes one", () => {
    const shape: GroupExitShape = {
      mode: 'fair-cut',
      amount: 5,
      classes: [
        {
          sizes: [5],
          groups: [0],
          direct: 1,
          chancePlaces: [{ place: 2, minSpots: 1, maxSpots: 1 }],
          minSpots: 1,
          maxSpots: 1,
        },
        {
          sizes: [4],
          groups: [1, 2],
          direct: 1,
          chancePlaces: [{ place: 2, minSpots: 0, maxSpots: 2 }],
          minSpots: 0,
          maxSpots: 2,
        },
      ],
    };
    const result = groupExitSelection(
      stateOf([5, 4, 4], 'fair-cut', 5),
      [table('A', [3, 0.5, 0.2]), table('B', [3, 2.0, 0.1]), table('C', [3, 1.5, 0.1])],
      shape,
    );
    expect(result.chance).toEqual(['B2', 'A2']);
  });

  it('a size takes no more than its most spots, even when its next in line beat the rest', () => {
    const shape: GroupExitShape = {
      mode: 'fair-cut',
      amount: 5,
      classes: [
        {
          sizes: [4],
          groups: [0, 1],
          direct: 1,
          chancePlaces: [{ place: 2, minSpots: 0, maxSpots: 1 }],
          minSpots: 0,
          maxSpots: 1,
        },
        {
          sizes: [3],
          groups: [2],
          direct: 1,
          chancePlaces: [{ place: 2, minSpots: 0, maxSpots: 1 }],
          minSpots: 0,
          maxSpots: 1,
        },
      ],
    };
    const result = groupExitSelection(
      stateOf([4, 4, 3], 'fair-cut', 5),
      [table('A', [3, 2.0, 0.2]), table('B', [3, 1.9, 0.2]), table('C', [3, 0.5, 0.2])],
      shape,
    );
    expect(result.chance).toEqual(['A2', 'C2']);
  });
});

describe('a cross-group tie at the last chance spot', () => {
  const level = () => [
    table('A', [3, 2.5, 2.0, 1.5, 0.2]),
    table('B', [3, 2.5, 1.5, 0.1]),
    table('C', [3, 2.5, 1.0, 0.1]),
  ];

  it('is raised for the units level on the last spot, with how many go through', () => {
    const result = select([5, 4, 4], 'fair-cut', 8, level());
    expect(result.tie?.players.map((player) => player.entry.name).sort()).toEqual(['A4', 'B3']);
    expect(result.tie?.spots).toBe(1);
  });

  it("the organiser's pick decides it", () => {
    expect(select([5, 4, 4], 'fair-cut', 8, level(), { [GROUP_EXIT_TIE_KEY]: ['B3'] }).chance).toEqual([
      'B3',
    ]);
    expect(select([5, 4, 4], 'fair-cut', 8, level(), { [GROUP_EXIT_TIE_KEY]: ['A4'] }).chance).toEqual([
      'A4',
    ]);
  });

  it('is not raised when the level units all go through, or the spot is clear', () => {
    expect(select([5, 4, 4], 'even-split', 8, groups544(1.0, 0.9, 1.5, 1.2)).tie).toBeNull();
    expect(select([5, 4, 4], 'fair-cut', 8, groups544(2.0, 1.5, 1.2, 1.0)).tie).toBeNull();
  });

  it('even split: three level 3rds for two spots is one tie of three', () => {
    const tables = [
      table('A', [3, 2.5, 1.5, 0.3, 0.2]),
      table('B', [3, 2.5, 1.5, 0.1]),
      table('C', [3, 2.5, 1.5, 0.1]),
    ];
    const result = select([5, 4, 4], 'even-split', 8, tables);
    expect(result.tie?.players).toHaveLength(3);
    expect(result.tie?.spots).toBe(2);
  });
});

describe('group exit validation', () => {
  const refusal = (count: number, size: number, mode: GroupExitMode, total: number) =>
    groupExitRefusal(count, size, mode, total, 'teams');

  it('refuses a total below the number of groups, naming the groups', () => {
    expect(refusal(13, 4, 'fair-cut', 2)).toMatch(/3 groups \(5, 4, 4\)/);
    expect(refusal(13, 4, 'fair-cut', 2)).toMatch(/at least 3/);
  });

  it('refuses a total above the teams minus the groups', () => {
    expect(refusal(13, 4, 'fair-cut', 11)).toMatch(/at most 10 \(13 - 3\)/);
    expect(refusal(13, 4, 'fair-cut', 10)).toBeNull();
  });

  it('refuses an even split that would take every team of the smallest group, not the fair cut', () => {
    expect(refusal(13, 4, 'even-split', 10)).toMatch(/smallest group \(4\)/);
    expect(refusal(13, 4, 'even-split', 9)).toBeNull();
    expect(refusal(13, 4, 'fair-cut', 10)).toBeNull();
  });

  it('never refuses per group', () => {
    expect(refusal(13, 4, 'per-group', 99)).toBeNull();
  });
});

function runtime() {
  return createTournamentRuntime();
}

function teamsOf(count: number, size: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: size }, (_, slot) => ({ name: `p${index}-${slot}` })),
  }));
}

function generate(count: number, setup: Setup) {
  return generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teamsOf(count, 4) }),
    createDefaultSetup({
      gameFormat: 'team-4v4',
      poolingPhase: 'group-stage',
      groupSize: '4',
      oddCountStrategy: 'bye',
      scheduleLogic: 'single-elimination',
      ...setup,
    }),
    runtime(),
  );
}

function generated(count: number, setup: Setup): TournamentState {
  const result = generate(count, setup);
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true };
}

const FAIR_8 = { groupExit: 'fair-cut', qualAdv: '8' } as const;

describe('group exit in a generated tournament', () => {
  it('stores the mode, and a tournament without it is a per-group one', () => {
    expect(generated(13, FAIR_8).cfg.groupExit).toBe('fair-cut');
    expect(generated(13, { qualifiersPerGroup: '2' }).cfg.groupExit).toBeUndefined();
  });

  it('the group stage seeds the total, not groups times qualifiers', () => {
    const state = generated(13, FAIR_8);
    expect(state.groups.map((group) => group.members.length)).toEqual([5, 4, 4]);
    expect(state.rounds.find((round) => !round.isGroupStage)?.players).toBe(8);
  });

  it('refuses the totals the groups cannot share, with the groups in the message', () => {
    const tooFew = generate(13, { groupExit: 'fair-cut', qualAdv: '2' });
    expect(tooFew.status).not.toBe('generated');
    if (tooFew.status !== 'generated') expect(tooFew.message).toMatch(/3 groups \(5, 4, 4\)/);
    expect(generate(13, { groupExit: 'fair-cut', qualAdv: '11' }).status).not.toBe('generated');
    expect(generate(13, { groupExit: 'even-split', qualAdv: '10' }).status).not.toBe('generated');
  });

  it('a total that is not a bracket size still goes through the bracket checks (6 teams: a Semis needs rooms)', () => {
    expect(generate(13, { groupExit: 'fair-cut', qualAdv: '6' }).status).toBe('generated');
  });

  it('plays through: 13 teams 4v4, fair cut, total 8, into a bracket of 8', () => {
    let state = generated(13, FAIR_8);
    for (let guard = 0; guard < 12 && state.rounds[state.curRound].isGroupStage; guard += 1) {
      const result = advanceTournamentRound(scoreCurrentRound(state, 4));
      if (result.status !== 'advanced') throw new Error(`blocked: ${JSON.stringify(result)}`);
      state = result.state;
    }
    const seated = (state.assignments[state.curRound] ?? []).filter((entry) => entry.room !== null);
    expect(seated).toHaveLength(8);
    expect(new Set(seated.map((entry) => entry.name)).size).toBe(8);
    const winners = state.groups.map(
      (group) =>
        describeStandings(state)?.tables.find((entry) => entry.groupLabel === group.label)?.entries[0].name,
    );
    for (const winner of winners) expect(seated.map((entry) => entry.name)).toContain(winner);
  });
});

/** Scores every room of the round in play with the first-listed team winning 120 to 80: the records repeat across the groups. */
function scoreLevel(state: TournamentState): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    for (const key of scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: 4,
    })) {
      scores[key] = position === 0 ? 30 : 20;
    }
  }
  return { ...state, scores };
}

describe('the cross-group tie in a played group stage', () => {
  function levelAtLastRound(): TournamentState {
    let state = generated(13, FAIR_8);
    for (let guard = 0; guard < 12 && state.rounds[state.curRound + 1]?.isGroupStage; guard += 1) {
      const result = advanceTournamentRound(scoreLevel(state));
      if (result.status !== 'advanced') throw new Error(`blocked: ${JSON.stringify(result)}`);
      state = result.state;
    }
    return scoreLevel(state);
  }

  it('is among the ties of the last group round, and holds Next Round back until it is decided', () => {
    const state = levelAtLastRound();
    const ties = getAllTies(state, state.curRound);
    expect(Object.keys(ties)).toContain(GROUP_EXIT_TIE_KEY);
    expect(hasPendingTies(state, state.curRound)).toBe(true);
    expect(advanceTournamentRound(state).status).toBe('blocked');
  });

  it("resolved by the organiser's picks, the round advances with 8 teams, the picked one among them", () => {
    let state = levelAtLastRound();
    for (let guard = 0; guard < 10 && hasPendingTies(state, state.curRound); guard += 1) {
      const [key, tie] =
        Object.entries(getAllTies(state, state.curRound)).find(
          ([tieKey, cluster]) => !isTieResolved(tieKey, cluster, state),
        ) ?? [];
      if (!key || !tie) break;
      const ranked = state.tieResolutions[key] ?? [];
      const next = tie.players.find((player) => !ranked.includes(player.name));
      if (next) state = resolveTournamentTie(state, key, next.name);
    }
    expect(hasPendingTies(state, state.curRound)).toBe(false);
    const picked = state.tieResolutions[GROUP_EXIT_TIE_KEY]?.[0];
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status === 'advanced') {
      const seated = (result.state.assignments[result.state.curRound] ?? []).filter(
        (entry) => entry.room !== null,
      );
      expect(seated).toHaveLength(8);
      expect(seated.map((entry) => entry.name)).toContain(picked);
    }
  });
});

describe.each([31, 37])('group exit with %i teams 4v4 in groups of 4', (count) => {
  const sizesOf = (total: number, mode: GroupExitMode) => {
    const result = generate(count, { groupExit: mode, qualAdv: String(total) });
    return result.status === 'generated' ? result.state.groups.map((group) => group.members.length) : null;
  };

  it.each([
    [16, 'fair-cut'],
    [16, 'even-split'],
    [8, 'fair-cut'],
    [8, 'even-split'],
  ] as const)(
    'total %i, %s: the totals add up and every group winner goes through, or the total is refused',
    (total, mode) => {
      const sizes = sizesOf(total, mode);
      const refusal = groupExitRefusal(count, 4, mode, total, 'teams');
      if (sizes === null) {
        expect(refusal).not.toBeNull();
        return;
      }
      expect(refusal).toBeNull();
      const tables = sizes.map((size, index) =>
        table(
          String.fromCharCode(65 + index),
          Array.from({ length: size }, (_, place) => 3 - place * 0.4 - index * 0.01),
        ),
      );
      const result = select(sizes, mode, total, tables);
      expect(result.advancing).toHaveLength(total);
      expect(new Set(result.advancing).size).toBe(total);
      expect(result.throughByGroup.reduce((sum, names) => sum + names.length, 0)).toBe(total);
      sizes.forEach((_, index) =>
        expect(result.throughByGroup[index]).toContain(`${String.fromCharCode(65 + index)}1`),
      );
      sizes.forEach((size, index) => expect(result.throughByGroup[index].length).toBeLessThan(size));
    },
  );
});

describe('per group is unchanged', () => {
  it('the top 2 of each group in tiers, group winners first', () => {
    const tables = [table('A', [3, 2.5, 1]), table('B', [2.8, 2.6, 1]), table('C', [2.9, 2.7, 1])];
    expect(select([3, 3, 3], 'per-group', 2, tables).advancing).toEqual(['A1', 'C1', 'B1', 'C2', 'B2', 'A2']);
  });
});
