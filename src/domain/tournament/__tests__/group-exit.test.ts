import { describe, expect, it } from 'vitest';
import { getAllTies, hasPendingTies, isTieResolved, selectGroupExit } from '../advancement';
import { generateTournament } from '../generation';
import {
  GROUP_EXIT_TIE_KEY,
  groupExitRefusal,
  groupExitSelection,
  groupExitShape,
  groupSizesOf,
  type GroupExitShape,
} from '../group-exit';
import { removeRosterUnit, resolveTournamentTie } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { cutTieMarks, describeStandings } from '../standings-display';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { tieredSeed } from '../seeding';
import { advanceTournamentRound } from '../transitions';
import type {
  GeneratedTournamentConfig,
  GroupExitMode,
  RoundAssignment,
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

describe('groupExitSelection: 4, 4, 4 with 10 advancing, fair cut', () => {
  it('the top 3 of each group, then the best 4th: the strongest group sends all four', () => {
    const tables = [
      table('A', [2.25, 2, 1, 0.25]),
      table('B', [2, 1.6, 1.3, 0]),
      table('C', [2, 1.4, 1.4, 1.3]),
    ];
    const result = select([4, 4, 4], 'fair-cut', 10, tables);
    expect(result.chance).toEqual(['C4']);
    expect(result.cutByGroup).toEqual([3, 3, 4]);
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

  it('a level unit left out at an earlier step is a tie too, when its size is full by the next step', () => {
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
    const tables = [table('A', [3, 2.0, 0.2]), table('B', [3, 2.0, 0.2]), table('C', [3, 1.0, 0.2])];
    const state = stateOf([4, 4, 3], 'fair-cut', 5);
    const result = groupExitSelection(state, tables, shape);
    expect(result.chance).toEqual(['A2', 'C2']);
    expect(result.tie?.players.map((player) => player.entry.name).sort()).toEqual(['A2', 'B2']);
    expect(result.tie?.spots).toBe(1);
    const decided = groupExitSelection(
      { ...state, tieResolutions: { [GROUP_EXIT_TIE_KEY]: ['B2'] } },
      tables,
      shape,
    );
    expect(decided.chance).toEqual(['B2', 'C2']);
  });
});

describe('group exit validation', () => {
  const refusal = (count: number, size: number, mode: GroupExitMode, total: number) =>
    groupExitRefusal(count, size, mode, total, 'teams');

  it('refuses a total below the number of groups, naming the groups', () => {
    expect(refusal(13, 4, 'fair-cut', 2)).toMatch(/3 groups \(5, 4, 4\)/);
    expect(refusal(13, 4, 'fair-cut', 2)).toMatch(/at least 3/);
  });

  it('lets a fair cut send every team of a group, as long as one team is out in all', () => {
    expect(refusal(12, 4, 'fair-cut', 10)).toBeNull();
    expect(refusal(12, 4, 'fair-cut', 11)).toBeNull();
    expect(refusal(13, 4, 'fair-cut', 12)).toBeNull();
    expect(refusal(12, 4, 'fair-cut', 12)).toMatch(/every one of the 12 teams.*at most 11/);
  });

  it('refuses an even split that would leave a group with nobody out, pointing to the fair cut', () => {
    expect(refusal(12, 4, 'even-split', 10)).toMatch(
      /even split of 3 groups \(4, 4, 4\).*at most 9.*fair cut/,
    );
    expect(refusal(13, 4, 'even-split', 10)).toMatch(/3 groups \(5, 4, 4\).*at most 9/);
    expect(refusal(13, 4, 'even-split', 9)).toBeNull();
    expect(refusal(12, 4, 'even-split', 9)).toBeNull();
  });

  it.each([
    [
      15,
      4,
      3,
      /\(3\) would take every team of a group of 3: 15 teams make 4 groups \(4, 4, 4, 3\)\. Use at most 2/,
    ],
    [31, 4, 3, /8 groups \(4, 4, 4, 4, 4, 4, 4, 3\)\. Use at most 2/],
    [
      11,
      5,
      4,
      /\(4\) would take every team of a group of 3: 11 teams make 3 groups \(4, 4, 3\)\. Use at most 2/,
    ],
    [7, 5, 4, /2 groups \(4, 3\)\. Use at most 2/],
    [16, 4, 4, /group of 4: 16 teams make 4 groups \(4, 4, 4, 4\)\. Use at most 3, or change the group size/],
  ])(
    'refuses qualifiers per group that take a whole real group: %i teams, size %i, %i per group',
    (count, size, qualifiers, message) => {
      expect(refusal(count, size, 'per-group', qualifiers)).toMatch(message);
    },
  );

  it('accepts qualifiers per group below the smallest real group', () => {
    expect(refusal(16, 4, 'per-group', 3)).toBeNull();
    expect(refusal(37, 5, 'per-group', 3)).toBeNull();
    expect(refusal(37, 5, 'per-group', 4)).toMatch(/group of 4: 37 teams make 8 groups/);
    expect(refusal(13, 4, 'per-group', 3)).toBeNull();
    expect(refusal(15, 4, 'per-group', 2)).toBeNull();
  });

  it('refuses qualifiers per group below 1', () => {
    expect(refusal(16, 4, 'per-group', -1)).toMatch(/positive number/);
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

  it.each([
    [15, '4', '3'],
    [31, '4', '3'],
    [11, '5', '4'],
    [7, '5', '4'],
    [12, '4', '4'],
  ])(
    'refuses qualifiers per group that take a whole group: %i teams, size %s, %s per group',
    (count, size, per) => {
      const result = generate(count, { groupSize: size, qualifiersPerGroup: per });
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') expect(result.message).toMatch(/would take every team of a group of/);
    },
  );

  it.each([
    [16, '4', '3', 12],
    [13, '4', '3', 9],
    [37, '5', '3', 24],
  ])('generates %i teams, size %s, %s per group: %i go to the bracket', (count, size, per, entering) => {
    const state = generated(count, { groupSize: size, qualifiersPerGroup: per });
    expect(state.groups.reduce((sum, group) => sum + Math.min(Number(per), group.members.length), 0)).toBe(
      entering,
    );
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
    expect(generate(13, { groupExit: 'fair-cut', qualAdv: '13' }).status).not.toBe('generated');
    expect(generate(13, { groupExit: 'even-split', qualAdv: '10' }).status).not.toBe('generated');
  });

  it('12 teams in groups of 4: a fair cut sends 10 (3, 3 and 4), an even split refuses', () => {
    const state = generated(12, { groupExit: 'fair-cut', qualAdv: '10' });
    expect(state.groups.map((group) => group.members.length)).toEqual([4, 4, 4]);
    expect(state.rounds.find((round) => !round.isGroupStage)?.players).toBe(10);
    expect(generate(12, { groupExit: 'even-split', qualAdv: '10' }).status).not.toBe('generated');
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

describe('the tie marks of a cross-group tie', () => {
  it('waits on the units level at the last spot, then places them once the organiser has picked', () => {
    let state = (() => {
      let current = generated(13, FAIR_8);
      for (let guard = 0; guard < 12 && current.rounds[current.curRound + 1]?.isGroupStage; guard += 1) {
        const result = advanceTournamentRound(scoreLevel(current));
        if (result.status !== 'advanced') throw new Error('blocked');
        current = result.state;
      }
      return scoreLevel(current);
    })();
    const names = (getAllTies(state, state.curRound)[GROUP_EXIT_TIE_KEY]?.players ?? []).map((p) => p.name);
    expect(names.length).toBeGreaterThan(1);
    const marks = (current: TournamentState) => {
      const display = describeStandings(current);
      if (!display) throw new Error('no standings');
      return Object.values(cutTieMarks(current, display));
    };
    expect(marks(state).every((mark) => names.every((name) => mark.pending.includes(name)))).toBe(true);
    for (let guard = 0; guard < 10 && hasPendingTies(state, state.curRound); guard += 1) {
      const [key, tie] =
        Object.entries(getAllTies(state, state.curRound)).find(
          ([tieKey, cluster]) => !isTieResolved(tieKey, cluster, state),
        ) ?? [];
      const ranked = key ? (state.tieResolutions[key] ?? []) : [];
      const next = tie?.players.find((player) => !ranked.includes(player.name));
      if (key && next) state = resolveTournamentTie(state, key, next.name);
    }
    const decided = marks(state);
    expect(decided.flatMap((mark) => mark.placed)).toEqual(expect.arrayContaining(names));
    expect(decided.flatMap((mark) => mark.pending)).toEqual([]);
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

describe('a group too short to fill its places gives the spot to another group', () => {
  it('15 teams 5/5/5, even split 12, two of A removed: 12 go through, the 13th spot is the better 5th of B and C', () => {
    const tables = (b5: number, c5: number) => [
      table('A', [3, 2.5, 2]),
      table('B', [3, 2.5, 2, 1.5, b5]),
      table('C', [3, 2.5, 2, 1.5, c5]),
    ];
    const lowerGroup = select([3, 5, 5], 'even-split', 12, tables(0.4, 0.8));
    expect(lowerGroup.advancing).toHaveLength(12);
    expect(lowerGroup.chance).toEqual(['C5']);
    expect(lowerGroup.throughByGroup.map((names) => names.length)).toEqual([3, 4, 5]);
    expect(lowerGroup.cutByGroup).toEqual([4, 4, 5]);
    expect(select([3, 5, 5], 'even-split', 12, tables(0.9, 0.8)).chance).toEqual(['B5']);
    expect(lowerGroup.tie).toBeNull();
  });

  it('12 teams 4/4/4, per group 3, two of A removed: 9 go through, the best 4th of B and C among them', () => {
    const tables = [table('A', [3, 2]), table('B', [3, 2.5, 2, 1.2]), table('C', [3, 2.5, 2, 0.9])];
    const result = select([2, 4, 4], 'per-group', 3, tables);
    expect(result.advancing).toHaveLength(9);
    expect(result.chance).toEqual(['B4']);
    expect(result.throughByGroup[0]).toEqual(['A1', 'A2']);
    expect(result.cutByGroup).toEqual([3, 4, 3]);
  });

  it("with B's and C's 4th level a cross-group tie is raised, and the organiser's pick decides it", () => {
    const tables = [table('A', [3, 2]), table('B', [3, 2.5, 2, 1]), table('C', [3, 2.5, 2, 1])];
    const tied = select([2, 4, 4], 'per-group', 3, tables);
    expect(tied.tie?.players.map((player) => player.entry.name).sort()).toEqual(['B4', 'C4']);
    expect(tied.tie?.spots).toBe(1);
    const picked = select([2, 4, 4], 'per-group', 3, tables, { [GROUP_EXIT_TIE_KEY]: ['C4'] });
    expect(picked.chance).toEqual(['C4']);
  });

  it("the lowest place goes first: C's 4th is taken before B's 5th that has more points per match", () => {
    const tables = [table('A', [3]), table('B', [3, 2.5, 2, 1.5, 1.4]), table('C', [3, 2.5, 2, 1, 0.1])];
    const result = select([1, 5, 5], 'per-group', 3, tables);
    expect(result.advancing).toHaveLength(9);
    expect(result.chance).toEqual(['B4', 'C4']);
  });

  it('a unit without a counted match is a candidate too, last by the usual order', () => {
    const tables = [
      table('A', [3, 2]),
      table('B', [3, 2.5, 2, 0]),
      [...table('C', [3, 2.5, 2]), { ...standing('C4', 0), totalFP: null }],
    ];
    expect(select([2, 4, 4], 'per-group', 3, tables).chance).toEqual(['B4']);
    expect(select([2, 4, 4], 'per-group', 3, [tables[0], tables[1].slice(0, 3), tables[2]]).chance).toEqual([
      'C4',
    ]);
  });

  it('fair cut, 13 teams (5/4/4), total 10, three of one group removed: every remaining unit, as the total is more', () => {
    const tables = [table('A', [3, 2]), table('B', [3, 2.5, 2, 1.2]), table('C', [3, 2.5, 2, 0.9])];
    const result = select([2, 4, 4], 'fair-cut', 10, tables);
    expect(result.advancing).toHaveLength(10);
    expect(new Set(result.advancing).size).toBe(10);
    const fewer = select([1, 4, 4], 'fair-cut', 10, [table('A', [3]), tables[1], tables[2]]);
    expect(fewer.advancing).toHaveLength(9);
  });

  it('no removal: nothing is refilled, the selection is the direct places and the chance spots', () => {
    const result = select([5, 4, 4], 'fair-cut', 8, groups544(2.0, 1.5, 1.2, 1.0));
    expect(result.advancing).toHaveLength(8);
    expect(result.chance).toEqual(['A4']);
    expect(
      select([4, 4, 4], 'per-group', 3, [
        table('A', [3, 2, 1, 0]),
        table('B', [3, 2, 1, 0]),
        table('C', [3, 2, 1, 0]),
      ]).advancing,
    ).toHaveLength(9);
  });

  it('no table yet: nothing is refilled', () => {
    const result = select([2, 4, 4], 'per-group', 3, [[], [], []]);
    expect(result.advancing).toEqual([]);
    expect(result.cutByGroup).toEqual([3, 3, 3]);
  });
});

describe.each([31, 37])(
  'group exit with %i teams 4v4 in groups of 4, two units of one group removed',
  (count) => {
    const intact = groupSizesOf(count, 4);
    const sizes = intact.map((size, index) => (index === 0 ? size - 2 : size));
    const tables = sizes.map((size, index) =>
      table(
        String.fromCharCode(65 + index),
        Array.from({ length: size }, (_, place) => 3 - place * 0.4 - index * 0.01),
      ),
    );
    const left = sizes.reduce((sum, size) => sum + size, 0);

    it.each([
      ['per-group', 2],
      ['even-split', 16],
      ['fair-cut', 16],
    ] as const)(
      '%s at %i: min(entry count, units left) go through, every winner in, no duplicates',
      (mode, amount) => {
        const entry = mode === 'per-group' ? sizes.length * amount : amount;
        const result = select(sizes, mode, amount, tables);
        expect(result.advancing).toHaveLength(Math.min(entry, left));
        expect(new Set(result.advancing).size).toBe(result.advancing.length);
        sizes.forEach((_, index) =>
          expect(result.throughByGroup[index]).toContain(`${String.fromCharCode(65 + index)}1`),
        );
      },
    );
  },
);

describe('a played group stage with units removed: per group 3 of 12 teams, two of A removed', () => {
  function levelAtLastRound(): TournamentState {
    const start = generated(12, { qualifiersPerGroup: '3' });
    let state = [...start.groups[0].members.slice(0, 2)].reduce(removeRosterUnit, start);
    for (let guard = 0; guard < 12 && state.rounds[state.curRound + 1]?.isGroupStage; guard += 1) {
      const result = advanceTournamentRound(scoreLevel(state));
      if (result.status !== 'advanced') throw new Error(`blocked: ${JSON.stringify(result)}`);
      state = result.state;
    }
    return scoreLevel(state);
  }

  it('raises the cross-group tie for the refill spot, marks it and holds Next Round back', () => {
    const state = levelAtLastRound();
    const ties = getAllTies(state, state.curRound);
    expect(ties[GROUP_EXIT_TIE_KEY]?.players.length).toBeGreaterThan(1);
    expect(advanceTournamentRound(state).status).toBe('blocked');
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    const names = ties[GROUP_EXIT_TIE_KEY].players.map((player) => player.name);
    expect(
      Object.values(cutTieMarks(state, display)).some((mark) =>
        names.every((name) => mark.pending.includes(name)),
      ),
    ).toBe(true);
  });
});

describe('per group is unchanged', () => {
  it('the top 2 of each group in tiers, group winners first', () => {
    const tables = [table('A', [3, 2.5, 1]), table('B', [2.8, 2.6, 1]), table('C', [2.9, 2.7, 1])];
    expect(select([3, 3, 3], 'per-group', 2, tables).advancing).toEqual(['A1', 'C1', 'B1', 'C2', 'B2', 'A2']);
  });
});

/** Scores every room of the round in play with distinct scores drawn from the seed: the group tables come out differently per seed. */
function scoreFromSeed(state: TournamentState, seed: number): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  let draw = seed;
  let counter = 0;
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    draw = (draw * 48271) % 2147483647;
    counter += 1;
    const keys = scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: 4,
    });
    keys.forEach((key, index) => {
      scores[key] = index === 0 ? (100 + (draw % 900)) * 100 + counter : 1;
    });
  }
  return { ...state, scores };
}

/**
 * Plays the group stage and returns the state on the first bracket round, the draw as the seeding makes it before
 * group-mates are parted, and the group place of every unit that went through.
 */
function leaveGroups(start: TournamentState, seed: number) {
  let state = start;
  let lastGroupRound = 0;
  for (let guard = 0; guard < 12 && state.rounds[state.curRound].isGroupStage; guard += 1) {
    lastGroupRound = state.curRound;
    const result = advanceTournamentRound(scoreFromSeed(state, seed + guard));
    if (result.status !== 'advanced') throw new Error(`blocked: ${JSON.stringify(result)}`);
    state = result.state;
  }
  const exit = selectGroupExit(state, state.groupStandings);
  const rawDraw = tieredSeed({
    state,
    roundIndex: lastGroupRound,
    advancing: exit.advancing.map((name) => ({ name, isLucky: false })),
    seedingOverride: state.rounds[lastGroupRound].seedingOverride,
  }).seeded;
  const placeOf = new Map(
    exit.throughByGroup.flatMap((names) => names.map((name, position) => [name, position + 1] as const)),
  );
  return { state, rawDraw, placeOf };
}

const roomsOf = (assignments: readonly RoundAssignment[]) => {
  const rooms = new Map<number, string[]>();
  for (const entry of assignments) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()].map((names) => names.sort());
};

describe('group-mates apart in the first bracket round keep the seeding', () => {
  const groupOf = (state: TournamentState, name: string) =>
    state.groups.find((group) => group.members.includes(name))?.label;

  it.each([
    [16, '4'],
    [12, '3'],
  ])(
    '%i teams in groups of %s, 2 per group: no group-mates, and no more winner-against-winner rooms than the draw made',
    (count, size) => {
      let partedGroupMates = 0;
      for (let seed = 1; seed <= 150; seed += 1) {
        const { state, rawDraw, placeOf } = leaveGroups(
          generated(count, { groupSize: size, qualifiersPerGroup: '2' }),
          seed * 7919,
        );
        const sameKind = (names: string[]) => placeOf.get(names[0]) === placeOf.get(names[1]);
        const rooms = roomsOf(state.assignments[state.curRound] ?? []);
        const drawn = roomsOf(rawDraw);
        expect(rooms).toHaveLength(4);
        for (const names of rooms) {
          expect(
            new Set(names.map((name) => groupOf(state, name))).size,
            `seed ${seed}: ${names.join()}`,
          ).toBe(2);
        }
        expect(rooms.filter(sameKind).length, `seed ${seed}`).toBeLessThanOrEqual(
          drawn.filter(sameKind).length,
        );
        if (drawn.some((names) => new Set(names.map((name) => groupOf(state, name))).size === 1)) {
          partedGroupMates += 1;
        }
      }
      expect(partedGroupMates).toBeGreaterThan(0);
    },
  );
});
