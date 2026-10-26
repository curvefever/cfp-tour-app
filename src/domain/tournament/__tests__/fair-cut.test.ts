import { describe, expect, it } from 'vitest';
import { roomBasedComputeAdvancement, doubleEliminationComputeAdvancement } from '../advancement';
import { doubleEliminationContributions } from '../bracket-replay';
import {
  fairCutAdvancement,
  fairCutShape,
  fairCutSurvivors,
  sizePools,
  usesFairCut,
  type FairCutResult,
} from '../fair-cut';
import { splitAdvancement } from '../room-distribution';
import { scoredTeamSize, scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, scoreCurrentRound, withEarlierCutRule, type SweepConfig } from './play-through';

/**
 * The fair cut (fair-cut.ts, `gamemodeConfig.cutVersion` 2). Most tests seat a round synthetically (`seatRound`: unit
 * `R{room}P{position}` in each room of the round's planned shape) and score it from a list per room, so the shapes
 * come from the real schedule generators and the scores are chosen here.
 */

type Setup = SweepConfig['setup'];

const SE_2V2V2V2: Setup = {
  gameFormat: 'team-2v2v2v2',
  teamScoringRule: 'survival-teams',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'none',
};
const SE_FFA: Setup = {
  gameFormat: 'ffa-individual',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'none',
};

function config(label: string, count: number, setup: Setup): SweepConfig {
  return { label, count, setup, teams: setup?.gameFormat?.startsWith('team-') ?? false };
}

function generate(label: string, count: number, setup: Setup): TournamentState {
  const state = buildState(config(label, count, setup));
  if (!state) throw new Error(`generation refused: ${label}`);
  return state;
}

function firstEliminationIndex(state: TournamentState): number {
  return state.rounds.findIndex((round) => !round.isNoElim && !round.isQual && !round.isFinal);
}

/** Puts unit `R{room}P{position}` in every seat of a round's planned rooms, with `rooms` overriding the shape when given. */
function seatRound(state: TournamentState, roundIndex: number, rooms?: number[]): TournamentState {
  const shape = rooms ?? state.rounds[roundIndex].rooms;
  const lineUp = shape.flatMap((size, index) =>
    Array.from({ length: size }, (_, position) => ({
      name: `R${index + 1}P${position + 1}`,
      room: index + 1,
      isLucky: false,
    })),
  );
  const assignments = [...state.assignments];
  assignments[roundIndex] = lineUp;
  return { ...state, assignments };
}

/** Scores a seated round: `scores[room - 1][position]` is that seat's score. Extra keys (games, team members) hold 0. */
function scoreRooms(state: TournamentState, roundIndex: number, scores: number[][]): TournamentState {
  const round = state.rounds[roundIndex];
  const next = { ...state.scores };
  scores.forEach((roomScores, roomIndex) => {
    roomScores.forEach((score, position) => {
      const keys = scoreKeysForPosition({
        roundIndex,
        room: roomIndex + 1,
        position,
        numGames: round.numGames ?? 1,
        teamSize: scoredTeamSize(state),
      });
      keys.forEach((key, index) => {
        next[key] = index === 0 ? score : 0;
      });
    });
  });
  return { ...state, scores: next };
}

function seatedAndScored(state: TournamentState, roundIndex: number, scores: number[][]): TournamentState {
  return scoreRooms(
    seatRound(
      state,
      roundIndex,
      scores.map((room) => room.length),
    ),
    roundIndex,
    scores,
  );
}

function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomScores(rooms: number[], seed: number): number[][] {
  const random = mulberry32(seed);
  return rooms.map((size) => Array.from({ length: size }, () => 1 + Math.floor(random() * 60)));
}

/** A placeholder round on a generated state: `rooms` and `advTotal` replaced, nothing else. */
function withRoundShape(
  state: TournamentState,
  roundIndex: number,
  shape: { rooms: number[]; advTotal: number; isSemis?: boolean; numGames?: number },
): TournamentState {
  const rounds = [...state.rounds];
  const { isSemis, ...rest } = shape;
  rounds[roundIndex] = {
    ...rounds[roundIndex],
    ...rest,
    ...splitAdvancement(shape.advTotal, 0, shape.rooms.length),
    players: shape.rooms.reduce((sum, size) => sum + size, 0),
    byeCount: 0,
    ...(isSemis ? { isSemis: true } : {}),
  };
  return { ...state, rounds };
}

function names(result: FairCutResult): Set<string> {
  return new Set(result.advancing.map((entry) => entry.name));
}

const NINE_COUNTS = [
  { label: '2v2v2v2 17', count: 17, setup: SE_2V2V2V2 },
  { label: '2v2v2v2 25', count: 25, setup: SE_2V2V2V2 },
  { label: '2v2v2v2 31', count: 31, setup: SE_2V2V2V2 },
  { label: '2v2v2v2 37', count: 37, setup: SE_2V2V2V2 },
  { label: '2v2v2v2 43', count: 43, setup: SE_2V2V2V2 },
  { label: '2v2v2v2 53', count: 53, setup: SE_2V2V2V2 },
  { label: 'FFA 37', count: 37, setup: SE_FFA },
  { label: 'FFA 43', count: 43, setup: SE_FFA },
  { label: 'FFA 53', count: 53, setup: SE_FFA },
];

describe('fairCutShape: the first elimination round of each awkward count', () => {
  /** Per group: room size, rooms, places always through, and the lucky spots at the next place (min, max). */
  const EXPECTED: Record<string, Array<[number, number, number, number, number]>> = {
    '2v2v2v2 17': [
      [4, 2, 3, 0, 1],
      [3, 3, 2, 1, 2],
    ],
    '2v2v2v2 25': [
      [4, 4, 3, 1, 2],
      [3, 3, 2, 1, 2],
    ],
    '2v2v2v2 31': [
      [4, 7, 3, 2, 3],
      [3, 1, 2, 0, 1],
    ],
    '2v2v2v2 37': [
      [4, 7, 3, 1, 2],
      [3, 3, 2, 1, 2],
    ],
    '2v2v2v2 43': [
      [4, 10, 3, 2, 3],
      [3, 1, 2, 0, 1],
    ],
    '2v2v2v2 53': [
      [4, 11, 3, 1, 2],
      [3, 3, 2, 1, 2],
    ],
    'FFA 37': [
      [8, 2, 6, 0, 1],
      [7, 3, 5, 2, 3],
    ],
    'FFA 43': [
      [8, 1, 6, 0, 1],
      [7, 5, 5, 3, 4],
    ],
    'FFA 53': [
      [8, 4, 6, 1, 2],
      [7, 3, 5, 2, 3],
    ],
  };

  it.each(NINE_COUNTS)('$label', ({ label, count, setup }) => {
    const state = generate(label, count, setup);
    const round = state.rounds[firstEliminationIndex(state)];
    const shape = fairCutShape(round.rooms, fairCutSurvivors(round, round.rooms));
    expect(shape.spare).toBe(1);
    expect(shape.winnersSafe).toBe(true);
    expect(
      shape.groups.map((group) => [
        group.size,
        group.rooms.length,
        group.direct,
        group.minSpots,
        group.maxSpots,
      ]),
    ).toEqual(EXPECTED[label]);
    for (const group of shape.groups) {
      expect(group.chancePlaces.map((place) => place.place)).toEqual(
        group.maxSpots > 0 ? [group.direct + 1] : [],
      );
    }
  });
});

describe('fairCutShape: safeguard and constructed shapes', () => {
  it('a shared-Final losers round [3, 2] -> 2: the spare cut goes to the room of 3, both winners advance', () => {
    const shape = fairCutShape([3, 2], 2);
    expect(shape.spare).toBe(1);
    const [three, two] = shape.groups;
    expect([three.whole, three.mayTakeSpare, three.direct, three.maxSpots]).toEqual([1, true, 1, 0]);
    expect([two.whole, two.mayTakeSpare, two.direct, two.maxSpots]).toEqual([1, true, 1, 0]);
    expect([three.minKeep, three.maxKeep, two.minKeep, two.maxKeep]).toEqual([1, 1, 1, 1]);
  });

  it('flex [3, 2, 2, 2, 2] -> 5 keeps every winner; -> 6 contests the spare cut', () => {
    const five = fairCutShape([3, 2, 2, 2, 2], 5);
    expect(five.groups.map((group) => [group.size, group.minKeep, group.maxKeep])).toEqual([
      [3, 1, 1],
      [2, 4, 4],
    ]);
    const six = fairCutShape([3, 2, 2, 2, 2], 6);
    expect(six.groups.map((group) => [group.size, group.minKeep, group.maxKeep])).toEqual([
      [3, 1, 2],
      [2, 4, 5],
    ]);
  });

  it('the cap example: 3 rooms of 3 and 9 of 2 with 12 advancing, the freed cut goes to the rooms of 3', () => {
    const lineUps = [3, 3, 3, ...Array.from({ length: 9 }, () => 2)];
    const shape = fairCutShape(lineUps, 12);
    const [three, two] = shape.groups;
    expect(two.whole).toBe(9);
    expect([three.whole, shape.spare]).toEqual([5, 1]);
    expect([three.minKeep, three.maxKeep, two.minKeep, two.maxKeep]).toEqual([3, 3, 9, 9]);
    expect(two.direct).toBe(1);
  });

  it('a group with two lucky-chance places gets both', () => {
    // Five rooms of 8, 5 and 2: the cap frees cuts that the rooms of 8 and 5 absorb in different amounts.
    const lineUps = [8, 8, 8, 8, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2];
    const eights = fairCutShape(lineUps, 19).groups[0];
    expect(eights.size).toBe(8);
    expect(eights.chancePlaces).toEqual([
      { place: 2, minSpots: 3, maxSpots: 4 },
      { place: 3, minSpots: 0, maxSpots: 1 },
    ]);
    expect([eights.minSpots, eights.maxSpots]).toEqual([3, 5]);
  });

  it('with S below the room count some winners must go: no cap, no guaranteed place', () => {
    const shape = fairCutShape([4, 4, 4, 4], 3);
    expect(shape.winnersSafe).toBe(false);
    expect(shape.groups[0]).toMatchObject({ direct: 0, minSpots: 3, maxSpots: 3 });
  });

  it('everyone advances when the target covers the field', () => {
    const shape = fairCutShape([4, 4, 3], 11);
    expect(shape.spare).toBe(0);
    expect(shape.groups.map((group) => [group.size, group.direct, group.maxSpots])).toEqual([
      [4, 4, 0],
      [3, 3, 0],
    ]);
  });
});

// Rooms A–G of 4 and H of 3 (see plans/2026-10-26-fair-cut.md).
const WORKED_SCORES = [
  [40, 30, 20, 10],
  [35, 30, 25, 10],
  [32, 28, 22, 18],
  [45, 25, 18, 12],
  [38, 27, 21, 14],
  [33, 29, 22, 16],
  [60, 20, 12, 8],
  [50, 30, 20],
];

describe('the worked example: 2v2v2v2 31, round 1', () => {
  const state = generate('2v2v2v2 31', 31, SE_2V2V2V2);
  const roundIndex = firstEliminationIndex(state);
  const scored = seatedAndScored(state, roundIndex, WORKED_SCORES);

  it("advances C, F and E as lucky losers, and H's 3rd goes out: 26 advance", () => {
    const result = fairCutAdvancement(scored, roundIndex);
    expect(result.advancing).toHaveLength(26);
    expect(new Set(result.luckyNames)).toEqual(new Set(['R3P4', 'R6P4', 'R5P4']));
    expect(result.luckyNames).toEqual(['R3P4', 'R6P4', 'R5P4']);
    expect(names(result).has('R8P3')).toBe(false);
    expect(result.eliminated).toContain('R8P3');
  });

  it("settles the spare cut by percentile: E at 5.5/28, H's 3rd at 0.5/3", () => {
    const { spareCuts } = fairCutAdvancement(scored, roundIndex);
    expect(spareCuts).toHaveLength(1);
    const [cut] = spareCuts;
    expect(cut.out.unit.name).toBe('R8P3');
    const byName = Object.fromEntries(cut.contenders.map((entry) => [entry.unit.name, entry.percentile]));
    expect(byName.R5P4).toBeCloseTo(5.5 / 28);
    expect(byName.R8P3).toBeCloseTo(0.5 / 3);
  });

  it("today's rule gives a different set: C and F, H's 3rd through without a contest", () => {
    const today = roomBasedComputeAdvancement(withEarlierCutRule(scored), roundIndex);
    expect(today.luckyNames).toEqual(['R3P4', 'R6P4']);
    expect(today.advancing.map((entry) => entry.name)).toContain('R8P3');
    expect(today.advancing.map((entry) => entry.name)).not.toContain('R5P4');
  });

  it('an exact tie at the spot boundary goes to the lower room', () => {
    // Three rooms of 4, 7 advance: places 1-2 through, one lucky spot at 3rd; rooms 1 and 2 tie on 0.8.
    const base = generate('2v2v2v2 17', 17, SE_2V2V2V2);
    const index = firstEliminationIndex(base);
    const shaped = withRoundShape(base, index, { rooms: [4, 4, 4], advTotal: 7 });
    const tied = seatedAndScored(shaped, index, [
      [40, 30, 20, 10],
      [40, 30, 20, 10],
      [50, 30, 15, 5],
    ]);
    expect(fairCutAdvancement(tied, index).luckyNames).toEqual(['R1P3']);
  });
});

describe('the spare-cut contest', () => {
  const base = generate('2v2v2v2 17', 17, SE_2V2V2V2);
  const index = firstEliminationIndex(base);

  it('a tie on percentile and relative score is lost by the higher room', () => {
    // A room of 3 (2nd place at relative 1, percentile 1/2) against a room of 2 on equal scores (relative 1, percentile 1/2).
    for (const rooms of [
      [3, 2],
      [2, 3],
    ]) {
      const scores = rooms.map((size) => (size === 3 ? [40, 30, 20] : [50, 50]));
      const state = seatedAndScored(withRoundShape(base, index, { rooms, advTotal: 3 }), index, scores);
      const [cut] = fairCutAdvancement(state, index).spareCuts;
      expect(cut.contenders.map((entry) => entry.percentile)).toEqual([0.5, 0.5]);
      expect(cut.contenders.map((entry) => entry.unit.relative)).toEqual([1, 1]);
      expect(cut.out.unit.room).toBe(2);
    }
  });

  it('an all-zero room loses the contest', () => {
    for (const zeroRoom of [1, 2]) {
      const scores = [
        [40, 30, 20],
        [60, 40],
      ];
      scores[zeroRoom - 1] = scores[zeroRoom - 1].map(() => 0);
      const state = seatedAndScored(
        withRoundShape(base, index, { rooms: [3, 2], advTotal: 3 }),
        index,
        scores,
      );
      const [cut] = fairCutAdvancement(state, index).spareCuts;
      expect(cut.out.unit.room).toBe(zeroRoom);
      expect(cut.out.percentile).toBe(-1);
    }
  });

  it('three sizes and two spare cuts: each falls on a different group and the lowest percentiles go out', () => {
    // [4, 4, 4, 3, 2] with 12 advancing: the sizes' shares leave two spare cuts.
    const shaped = withRoundShape(base, index, { rooms: [4, 4, 4, 3, 2], advTotal: 12 });
    for (let seed = 1; seed <= 20; seed += 1) {
      const state = seatedAndScored(shaped, index, randomScores([4, 4, 4, 3, 2], seed));
      const result = fairCutAdvancement(state, index);
      expect(result.advancing).toHaveLength(12);
      expect(result.spareCuts).toHaveLength(2);
      const sizes = result.spareCuts.map((cut) => cut.out.size);
      expect(new Set(sizes).size).toBe(2);
      for (const cut of result.spareCuts) {
        const lowest = [...cut.contenders].sort(
          (first, second) =>
            first.percentile - second.percentile ||
            first.unit.relative - second.unit.relative ||
            second.unit.room - first.unit.room,
        )[0];
        expect(cut.out.unit.name).toBe(lowest.unit.name);
      }
    }
  });
});

describe('an all-zero room', () => {
  const base = generate('2v2v2v2 17', 17, SE_2V2V2V2);
  const index = firstEliminationIndex(base);
  const shaped = withRoundShape(base, index, { rooms: [4, 4, 4], advTotal: 7 });

  it('offers no lucky loser: its places through still advance, the spot goes to a scored room', () => {
    const state = seatedAndScored(shaped, index, [
      [0, 0, 0, 0],
      [40, 30, 20, 10],
      [50, 30, 15, 5],
    ]);
    const result = fairCutAdvancement(state, index);
    expect(result.luckyNames).toEqual(['R2P3']);
    expect(names(result).has('R1P1') && names(result).has('R1P2')).toBe(true);
    expect(names(result).has('R1P3')).toBe(false);
  });

  it('leaves the spot empty when every candidate room is all zero', () => {
    const state = seatedAndScored(shaped, index, [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const result = fairCutAdvancement(state, index);
    expect(result.luckyNames).toEqual([]);
    expect(result.advancing).toHaveLength(6);
  });
});

describe('the percentile pool', () => {
  const base = generate('2v2v2v2 31', 31, SE_2V2V2V2);

  it('reads every round up to and including the one being cut, pooling rounds included', () => {
    let state = seatedAndScored(base, 0, randomScores([4, 4, 4, 4, 4, 4, 4, 3], 1));
    state = seatedAndScored(state, 2, randomScores([4, 4, 4, 4, 4, 4, 4, 3], 2));
    const pools = sizePools(state, 2);
    expect(pools.get(4)).toHaveLength(56);
    expect(pools.get(3)).toHaveLength(6);
  });

  it('ignores the scores of a later round', () => {
    let state = seatedAndScored(base, 2, randomScores([4, 4, 4, 4, 4, 4, 4, 3], 2));
    const before = sizePools(state, 2);
    state = seatedAndScored(state, 3, randomScores([4, 4, 4, 4, 4, 3, 3], 3));
    expect(sizePools(state, 2)).toEqual(before);
    expect(sizePools(state, 3).get(4)).toHaveLength(48);
  });

  it('is keyed by line-up: a room of 4 that lost a unit counts as a room of 3, and rooms of one are left out', () => {
    const state = seatedAndScored(base, 2, [[40, 30, 20, 10], [40, 30, 20], [5]]);
    const pools = sizePools(state, 2);
    expect(pools.get(4)).toHaveLength(4);
    expect(pools.get(3)).toHaveLength(3);
    expect(pools.has(1)).toBe(false);
  });
});

describe('which rounds the fair cut covers', () => {
  const state = generate('2v2v2v2 31', 31, SE_2V2V2V2);

  it('single-elimination rounds and Semis, with cutVersion only', () => {
    const covered = state.rounds.map((_, index) => usesFairCut(state, index));
    expect(covered).toEqual(state.rounds.map((round) => !round.isNoElim && !round.isFinal));
    const earlier = withEarlierCutRule(state);
    expect(state.rounds.every((_, index) => !usesFairCut(earlier, index))).toBe(true);
  });

  it('not the Final, a standings cut-off, Kings Valley, a waterfall, or a standings route (even with cutVersion)', () => {
    const index = firstEliminationIndex(state);
    for (const flag of ['isKingsValley', 'isWaterfall', 'isGroupStage', 'isSwiss', 'isQual'] as const) {
      const rounds = [...state.rounds];
      rounds[index] = { ...rounds[index], [flag]: true };
      expect(usesFairCut({ ...state, rounds }, index)).toBe(false);
    }
    const rounds = [...state.rounds];
    rounds[index] = { ...rounds[index], standingsRoutes: [] };
    expect(usesFairCut({ ...state, rounds }, index)).toBe(false);
    expect(usesFairCut(state, state.rounds.length - 1)).toBe(false);
  });

  it("a qualification table's last round is a standings cut-off", () => {
    const qual = generate('2v2v2v2 31 qual', 31, {
      ...SE_2V2V2V2,
      poolingPhase: 'qual-table',
      qualAdv: '16',
    });
    const lastQual = qual.rounds.map((round) => round.isQual).lastIndexOf(true);
    expect(usesFairCut(qual, lastQual)).toBe(false);
  });

  it('double elimination: winners and losers rounds, never the Final', () => {
    const de = generate('FFA 37 DE', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    });
    de.rounds.forEach((round, index) => {
      expect(usesFairCut(de, index)).toBe(round.bracket === 'winners' || round.bracket === 'losers');
    });
  });
});

/** The set today's rule sends through, computed here from the scores: the top `advPerRoom` of each room, then the best candidates by share. */
function earlierRuleSet(
  rooms: number[],
  scores: number[][],
  advPerRoom: number,
  luckyCount: number,
): Set<string> {
  const through: string[] = [];
  const candidates: Array<{ name: string; share: number; room: number }> = [];
  rooms.forEach((size, roomIndex) => {
    const ranked = scores[roomIndex]
      .map((score, position) => ({ score, name: `R${roomIndex + 1}P${position + 1}` }))
      .sort((first, second) => second.score - first.score);
    const total = ranked.reduce((sum, entry) => sum + entry.score, 0);
    through.push(...ranked.slice(0, advPerRoom).map((entry) => entry.name));
    const next = ranked[advPerRoom];
    if (next && total > 0)
      candidates.push({ name: next.name, share: (next.score / total) * size, room: roomIndex });
  });
  const lucky = candidates.sort((first, second) => second.share - first.share).slice(0, luckyCount);
  return new Set([...through, ...lucky.map((entry) => entry.name)]);
}

describe("equal rooms: the fair cut advances exactly today's set", () => {
  const CONTROLS = [
    { label: '2v2v2v2 16', count: 16, setup: SE_2V2V2V2 },
    { label: '2v2v2v2 24', count: 24, setup: SE_2V2V2V2 },
    { label: 'FFA 32', count: 32, setup: SE_FFA },
    { label: 'FFA 40', count: 40, setup: SE_FFA },
  ];

  it.each(CONTROLS)('$label', ({ label, count, setup }) => {
    const state = generate(label, count, setup);
    let compared = 0;
    state.rounds.forEach((round, index) => {
      if (!usesFairCut(state, index) || new Set(round.rooms).size !== 1) return;
      for (let seed = 1; seed <= 15; seed += 1) {
        const scored = seatedAndScored(state, index, randomScores(round.rooms, seed * 100 + index));
        const fair = fairCutAdvancement(scored, index);
        const today = roomBasedComputeAdvancement(withEarlierCutRule(scored), index);
        expect(names(fair)).toEqual(new Set(today.advancing.map((entry) => entry.name)));
        expect(fair.luckyNames).toEqual(today.luckyNames);
        compared += 1;
      }
    });
    expect(compared).toBeGreaterThan(0);
  });

  it.each(CONTROLS)('$label: through advanceTournamentRound too', ({ label, count, setup }) => {
    const state = generate(label, count, setup);
    const index = firstEliminationIndex(state);
    const through = (version: 'fair' | 'earlier'): string[] => {
      let current = version === 'fair' ? state : withEarlierCutRule(state);
      for (let round = 0; round < index; round += 1) {
        const result = advanceTournamentRound(scoreCurrentRound(current, scoredTeamSize(current) ?? 0));
        if (result.status !== 'advanced') throw new Error(result.status);
        current = result.state;
      }
      const lineUp = current.assignments[index];
      const rooms = current.rounds[index].rooms;
      const scores = randomScores(rooms, 7).map((room) => room.map((score, slot) => score * 100 + slot));
      let scored = current;
      const position = new Map<number, number>();
      for (const entry of lineUp) {
        const slot = position.get(entry.room as number) ?? 0;
        position.set(entry.room as number, slot + 1);
        const keys = scoreKeysForPosition({
          roundIndex: index,
          room: entry.room as number,
          position: slot,
          numGames: 1,
          teamSize: scoredTeamSize(current),
        });
        scored = {
          ...scored,
          scores: { ...scored.scores, [keys[0]]: scores[(entry.room as number) - 1][slot] },
        };
      }
      const advanced = advanceTournamentRound(scored);
      if (advanced.status !== 'advanced') throw new Error(advanced.status);
      return advanced.state.assignments[index + 1]
        .filter((entry) => entry.room !== null)
        .map((entry) => entry.name)
        .sort();
    };
    expect(through('fair')).toEqual(through('earlier'));
  });
});

describe('no cutVersion: the earlier rule, round by round', () => {
  it.each(NINE_COUNTS)(
    "$label: the first elimination round advances today's set",
    ({ label, count, setup }) => {
      const state = withEarlierCutRule(generate(label, count, setup));
      const index = firstEliminationIndex(state);
      const round = state.rounds[index];
      for (let seed = 1; seed <= 10; seed += 1) {
        const scores = randomScores(round.rooms, seed);
        const scored = seatedAndScored(state, index, scores);
        const today = roomBasedComputeAdvancement(scored, index);
        expect(new Set(today.advancing.map((entry) => entry.name))).toEqual(
          earlierRuleSet(round.rooms, scores, round.advPerRoom ?? 0, round.luckyCount),
        );
      }
    },
  );
});

interface InvariantFamily {
  label: string;
  count: number;
  setup: Setup;
}

function sharedFinalFamily(gameFormat: NonNullable<Setup>['gameFormat'], count: number): InvariantFamily {
  const teams = gameFormat !== 'ffa-individual';
  return {
    label: `${gameFormat} ${count} double elimination`,
    count,
    setup: {
      gameFormat,
      ...(teams ? { teamScoringRule: 'survival-teams' as const } : {}),
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    },
  };
}

const DOUBLE_ELIMINATION_FAMILIES: InvariantFamily[] = [
  ...[37, 43, 53].map((count) => sharedFinalFamily('ffa-individual', count)),
  ...[31, 37].map((count) => sharedFinalFamily('team-2v2v2v2', count)),
  ...(['team-2v2v2', 'team-3v3v3'] as const).flatMap((gameFormat) =>
    [29, 30, 31, 32, 33, 34].map((count) => sharedFinalFamily(gameFormat, count)),
  ),
];

/** What a covered round must satisfy, checked against the rule's own shape and the scores. */
function expectRuleHolds(state: TournamentState, roundIndex: number, label: string): void {
  const round = state.rounds[roundIndex];
  const result = fairCutAdvancement(state, roundIndex);
  const lineUps = round.rooms;
  const survivors = fairCutSurvivors(round, lineUps);
  const contested = lineUps.filter((size) => size >= 2);
  const units = contested.reduce((sum, size) => sum + size, 0);
  const here = `${label} round ${roundIndex + 1}`;
  const shape = fairCutShape(lineUps, survivors);

  const advancing = names(result);
  const lone = lineUps.filter((size) => size === 1).length;
  expect(advancing.size, `${here}: S advance`).toBe(Math.min(units, survivors) + lone);

  let lost = 0;
  for (const group of result.groups) {
    const groupLost = group.ranked.filter((unit) => !advancing.has(unit.name)).length;
    lost += groupLost;
    expect(groupLost, `${here}: size ${group.size} loses at least its share`).toBeGreaterThanOrEqual(
      group.whole,
    );
    expect(groupLost, `${here}: size ${group.size} loses at most share + spare`).toBeLessThanOrEqual(
      group.whole + shape.spare,
    );
    let worstKept = 0;
    let bestOut = Number.POSITIVE_INFINITY;
    for (const unit of group.ranked) {
      if (advancing.has(unit.name)) worstKept = Math.max(worstKept, unit.place);
      else bestOut = Math.min(bestOut, unit.place);
    }
    expect(worstKept, `${here}: places count first`).toBeLessThanOrEqual(
      bestOut === Infinity ? worstKept : bestOut,
    );
    if (survivors >= contested.length) {
      for (const unit of group.ranked.filter((candidate) => candidate.place === 1)) {
        expect(advancing.has(unit.name), `${here}: ${unit.name} wins room ${unit.room} and advances`).toBe(
          true,
        );
      }
    }
  }
  expect(lost, `${here}: E units go out`).toBe(Math.max(0, units - survivors));
  expect(result.advancing.length + result.eliminated.length).toBe(
    lineUps.reduce((sum, size) => sum + size, 0),
  );
}

describe('invariants over every covered mixed round, seeded random scores', () => {
  it.each(NINE_COUNTS)('single elimination, $label', ({ label, count, setup }) => {
    const state = generate(label, count, setup);
    let checked = 0;
    state.rounds.forEach((round, index) => {
      if (!usesFairCut(state, index)) return;
      for (let seed = 1; seed <= 12; seed += 1) {
        expectRuleHolds(
          seatedAndScored(state, index, randomScores(round.rooms, seed * 31 + index)),
          index,
          label,
        );
      }
      checked += 1;
    });
    expect(checked).toBeGreaterThan(1);
  });

  it.each(DOUBLE_ELIMINATION_FAMILIES)('$label', ({ label, count, setup }) => {
    const state = generate(label, count, setup);
    let checked = 0;
    state.rounds.forEach((round, index) => {
      if (!usesFairCut(state, index)) return;
      // The schedule's target is its rooms' split plus byes, which is what the fair cut reads.
      expect(round.advTotal).toBe(
        (round.advPerRoom ?? 0) * round.rooms.length + round.luckyCount + round.byeCount,
      );
      for (let seed = 1; seed <= 12; seed += 1) {
        expectRuleHolds(
          seatedAndScored(state, index, randomScores(round.rooms, seed * 17 + index)),
          index,
          label,
        );
      }
      checked += 1;
    });
    expect(checked).toBeGreaterThan(2);
  });

  it('a winner is out only when S is below the room count: the best S winners by relative score advance', () => {
    const base = generate('2v2v2v2 31', 31, SE_2V2V2V2);
    const index = firstEliminationIndex(base);
    const shaped = withRoundShape(base, index, { rooms: [4, 4, 4, 4, 4], advTotal: 3 });
    for (let seed = 1; seed <= 10; seed += 1) {
      const scores = randomScores([4, 4, 4, 4, 4], seed);
      const scored = seatedAndScored(shaped, index, scores);
      const fair = fairCutAdvancement(scored, index);
      const today = roomBasedComputeAdvancement(withEarlierCutRule(scored), index);
      expect(names(fair)).toEqual(new Set(today.advancing.map((entry) => entry.name)));
    }
  });
});

describe('double elimination', () => {
  const setup: Setup = {
    gameFormat: 'ffa-individual',
    scheduleLogic: 'double-elimination-shared-final',
    poolingPhase: 'none',
  };

  it('FFA 37 winners round 1 follows its shape, and the units not kept drop to the losers bracket', () => {
    const state = generate('FFA 37 DE', 37, setup);
    const index = firstEliminationIndex(state);
    const round = state.rounds[index];
    expect(round.bracket).toBe('winners');
    const shape = fairCutShape(round.rooms, fairCutSurvivors(round, round.rooms));
    expect(shape.groups.map((group) => [group.size, group.direct, group.minSpots, group.maxSpots])).toEqual([
      [8, 6, 0, 1],
      [7, 5, 1, 2],
    ]);
    const scored = seatedAndScored(state, index, randomScores(round.rooms, 11));
    const result = doubleEliminationComputeAdvancement(scored, index);
    expect(result.winners).toHaveLength(29);
    expect(result.losers).toHaveLength(8);
    const { additions } = doubleEliminationContributions(scored, index);
    expect((additions.get(round.losersTo as number) ?? []).map((seed) => seed.name).sort()).toEqual(
      result.losers.map((entry) => entry.name).sort(),
    );
    expect((additions.get(round.winnersTo as number) ?? []).map((seed) => seed.name).sort()).toEqual(
      result.winners.map((entry) => entry.name).sort(),
    );
  });

  it('the shared-Final losers round [3, 2] -> 2 sends both winners on', () => {
    const state = generate('2v2v2 31 DE', 31, {
      gameFormat: 'team-2v2v2',
      teamScoringRule: 'survival-teams',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    });
    const index = state.rounds.findIndex(
      (round) => round.bracket === 'losers' && round.rooms.join() === '3,2',
    );
    expect(index).toBeGreaterThan(0);
    for (let seed = 1; seed <= 20; seed += 1) {
      const scored = seatedAndScored(state, index, randomScores([3, 2], seed));
      const result = doubleEliminationComputeAdvancement(scored, index);
      expect(result.winners).toHaveLength(2);
      const winnerNames = fairCutAdvancement(scored, index)
        .groups.flatMap((group) => group.ranked)
        .filter((unit) => unit.place === 1)
        .map((unit) => unit.name);
      expect(winnerNames).toHaveLength(2);
      for (const name of winnerNames) expect(result.winners.map((entry) => entry.name)).toContain(name);
    }
  });

  it("race double elimination and every equal-room round give exactly today's winners, losers and lucky losers", () => {
    const races = [
      generate('1v1 13 race', 13, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
      }),
      generate('1v1 24 race', 24, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
      }),
      generate('FFA 32 DE', 32, setup),
    ];
    let compared = 0;
    for (const state of races) {
      state.rounds.forEach((round, index) => {
        if (!usesFairCut(state, index)) return;
        if (new Set(round.rooms.filter((size) => size >= 2)).size > 1) return;
        for (let seed = 1; seed <= 8; seed += 1) {
          const scored = seatedAndScored(state, index, randomScores(round.rooms, seed * 13 + index));
          const fair = doubleEliminationComputeAdvancement(scored, index);
          const today = doubleEliminationComputeAdvancement(withEarlierCutRule(scored), index);
          expect(new Set(fair.winners.map((entry) => entry.name))).toEqual(
            new Set(today.winners.map((entry) => entry.name)),
          );
          expect(new Set(fair.losers.map((entry) => entry.name))).toEqual(
            new Set(today.losers.map((entry) => entry.name)),
          );
          expect(new Set(fair.luckyNames)).toEqual(new Set(today.luckyNames));
          compared += 1;
        }
      });
    }
    expect(compared).toBeGreaterThan(20);
  });
});

describe('Semis', () => {
  it('rooms [8, 7] with 8 to the Final: the fair cut applies, on summed scores', () => {
    const base = generate('FFA 37', 37, SE_FFA);
    const index = base.rounds.findIndex((round) => round.isSemis);
    const shaped = withRoundShape(base, index, { rooms: [8, 7], advTotal: 8, isSemis: true, numGames: 2 });
    expect(usesFairCut(shaped, index)).toBe(true);
    // Game 1 and game 2 split each score: the cut reads their sum.
    const sums = randomScores([8, 7], 5);
    let scored = seatRound(shaped, index);
    sums.forEach((roomScores, roomIndex) => {
      roomScores.forEach((sum, position) => {
        const keys = scoreKeysForPosition({
          roundIndex: index,
          room: roomIndex + 1,
          position,
          numGames: 2,
          teamSize: scoredTeamSize(scored),
        });
        scored = { ...scored, scores: { ...scored.scores, [keys[0]]: sum - 1, [keys[1]]: 1 } };
      });
    });
    const result = fairCutAdvancement(scored, index);
    expect(result.advancing).toHaveLength(8);
    const plain = fairCutAdvancement(seatedAndScored(shaped, index, sums), index);
    expect(names(result)).toEqual(names(plain));
    const shape = fairCutShape([8, 7], 8);
    expect(shape.groups.map((group) => [group.size, group.whole])).toEqual([
      [8, 3],
      [7, 3],
    ]);
    expect(shape.spare).toBe(1);
  });
});

describe('a score correction after Previous', () => {
  it('the re-drawn advance uses the corrected score, in the pool and in the cut', () => {
    const state = generate('2v2v2v2 31', 31, SE_2V2V2V2);
    const index = firstEliminationIndex(state);
    let current = state;
    for (let round = 0; round < index; round += 1) {
      const result = advanceTournamentRound(scoreCurrentRound(current, scoredTeamSize(current) ?? 0));
      if (result.status !== 'advanced') throw new Error(result.status);
      current = result.state;
    }
    const advanceTo = (from: TournamentState): TournamentState => {
      const result = advanceTournamentRound(from);
      if (result.status !== 'advanced') throw new Error(result.status);
      return result.state;
    };
    const advanced = advanceTo(scoreRooms(current, index, WORKED_SCORES));

    // Previous, then room A's last place turns out to have scored 100, not 10.
    const corrected = WORKED_SCORES.map((room) => [...room]);
    corrected[0][3] = 100;
    const redrawn = advanceTo(scoreRooms({ ...advanced, curRound: index }, index, corrected));
    const direct = advanceTo(scoreRooms(current, index, corrected));
    expect(redrawn.assignments[index + 1]).toEqual(direct.assignments[index + 1]);

    const roomA = current.assignments[index].filter((entry) => entry.room === 1).map((entry) => entry.name);
    const through = (state: TournamentState) =>
      new Set(state.assignments[index + 1].filter((entry) => entry.room !== null).map((entry) => entry.name));
    // The corrected unit now wins its room, so the former 3rd is a 4th place at 0.42, below the lucky losers.
    expect(through(advanced).has(roomA[3])).toBe(false);
    expect(through(advanced).has(roomA[2])).toBe(true);
    expect(through(redrawn).has(roomA[3])).toBe(true);
    expect(through(redrawn).has(roomA[2])).toBe(false);
  });
});
