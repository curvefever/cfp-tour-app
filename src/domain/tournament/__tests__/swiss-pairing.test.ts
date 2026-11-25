import { describe, expect, it } from 'vitest';
import { computeQualificationStandings } from '../advancement';
import { rankingPoints, samePoints } from '../standing-compare';
import { previousColumnStart } from '../round-columns';
import { rosterKeys } from '../roster';
import { roomPairKey } from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import { swissPair } from '../swiss-pairing';
import { advanceTournamentRound } from '../transitions';
import type { RoundAssignment, TournamentState } from '../types';
import { pressNextRound } from './play-through';
import { buildAssignments, buildRound, generated } from './test-fixtures';

const roomSize = { min: 2, max: 2, ideal: 2 };
const POINTS_TABLE = [10, 8, 6, 5, 4, 3, 2, 1];

/** The pairs of a draw as `[first, second]` name lists, in room order. */
function pairsOf(seeded: RoundAssignment[]): string[][] {
  const rooms = new Map<number, string[]>();
  for (const entry of seeded) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()];
}

/** Units that played one room of Swiss round 1, listed in finishing order: every unit has different points. */
function afterOneRoom(finishing: string[], extraPlayers: string[] = []): TournamentState {
  const scores: Record<string, number> = {};
  for (const [position] of finishing.entries()) scores[`r0-rm1-p${position}`] = 100 - 5 * position;
  return createDefaultTournamentState({
    players: [...finishing, ...extraPlayers],
    gamemodeConfig: { scoring: 'positional-points', positionalPointsTable: POINTS_TABLE },
    rounds: [
      buildRound({
        roundNum: 1,
        isSwiss: true,
        isNoElim: true,
        players: finishing.length,
        rooms: [finishing.length],
      }),
      buildRound({ roundNum: 2, isSwiss: true, isNoElim: true, pairingTBD: true, players: 0, rooms: [] }),
    ],
    assignments: [buildAssignments(finishing, [finishing.length])],
    scores,
  });
}

describe('swissPair', () => {
  it('throws when roomSize.ideal !== 2', () => {
    expect(() =>
      swissPair({
        activeNames: ['A', 'B', 'C'],
        throughRoundIndex: 0,
        roomSize: { min: 3, max: 3, ideal: 3 },
        state: createDefaultTournamentState(),
      }),
    ).toThrow();
  });

  describe('inside a score group', () => {
    it('pairs the top half against the bottom half: a group of 6 on equal points is 1v4, 2v5, 3v6', () => {
      // With no scored rounds every unit is level (null points), so the roster order is the standings order.
      const players = Array.from({ length: 6 }, (_, index) => `P${index + 1}`);
      const state = createDefaultTournamentState({ players, rounds: [] });
      const { seeded, byeName } = swissPair({ activeNames: players, throughRoundIndex: -1, roomSize, state });
      expect(byeName).toBeNull();
      expect(pairsOf(seeded)).toEqual([
        ['P1', 'P4'],
        ['P2', 'P5'],
        ['P3', 'P6'],
      ]);
      expect(seeded.map((entry) => entry.room)).toEqual([1, 1, 2, 2, 3, 3]);
    });

    it('pairs 1v5, 2v6, 3v7, 4v8 for a group of 8', () => {
      const players = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
      const state = createDefaultTournamentState({ players, rounds: [] });
      const { seeded } = swissPair({ activeNames: players, throughRoundIndex: -1, roomSize, state });
      expect(pairsOf(seeded)).toEqual([
        ['P1', 'P5'],
        ['P2', 'P6'],
        ['P3', 'P7'],
        ['P4', 'P8'],
      ]);
    });

    it('pairs 1v2, 3v4, 5v6 when every unit has different points', () => {
      const finishing = ['A', 'B', 'C', 'D', 'E', 'F'];
      const { seeded } = swissPair({
        activeNames: finishing,
        throughRoundIndex: 0,
        roomSize,
        state: afterOneRoom(finishing),
      });
      expect(pairsOf(seeded)).toEqual([
        ['A', 'B'],
        ['C', 'D'],
        ['E', 'F'],
      ]);
    });
  });

  describe('the bye', () => {
    const players = Array.from({ length: 9 }, (_, index) => `P${index + 1}`);

    it('goes to the lowest ranked unit on an odd count, listed last without a room', () => {
      const state = createDefaultTournamentState({ players, rounds: [] });
      const result = swissPair({ activeNames: players, throughRoundIndex: -1, roomSize, state });
      expect(result.byeName).toBe('P9');
      expect(result.poolingByeCounts).toEqual({ P9: 1 });
      expect(result.seeded.at(-1)).toEqual({ name: 'P9', room: null, isLucky: false });
      expect(pairsOf(result.seeded)).toHaveLength(4);
    });

    it('goes to the lowest ranked of the units with the fewest byes', () => {
      const state = createDefaultTournamentState({
        players,
        rounds: [],
        poolingByeCounts: { P9: 1, P8: 1, P1: 1 },
      });
      const result = swissPair({ activeNames: players, throughRoundIndex: -1, roomSize, state });
      expect(result.byeName).toBe('P7');
      expect(result.poolingByeCounts).toEqual({ P1: 1, P7: 1, P8: 1, P9: 1 });
    });

    it('starts over once everyone has had one: a second bye goes to the lowest ranked again', () => {
      const state = createDefaultTournamentState({
        players,
        rounds: [],
        poolingByeCounts: Object.fromEntries(players.map((name) => [name, 1])),
      });
      const result = swissPair({ activeNames: players, throughRoundIndex: -1, roomSize, state });
      expect(result.byeName).toBe('P9');
      expect(result.poolingByeCounts.P9).toBe(2);
    });

    it('is taken out before the groups are formed: the rest pair as an even field', () => {
      const finishing = ['A', 'B', 'C', 'D', 'E'];
      const { seeded, byeName } = swissPair({
        activeNames: finishing,
        throughRoundIndex: 0,
        roomSize,
        state: afterOneRoom(finishing),
      });
      expect(byeName).toBe('E');
      expect(pairsOf(seeded)).toEqual([
        ['A', 'B'],
        ['C', 'D'],
      ]);
    });
  });

  describe('a rematch', () => {
    const swissRound = (roundNum: number) =>
      buildRound({
        roundNum,
        isSwiss: true,
        pairingTBD: roundNum > 1,
        players: 4,
        rooms: [2, 2],
        advTotal: 4,
      });
    const room = (first: string, second: string, third: string, fourth: string) => [
      { name: first, room: 1, isLucky: false },
      { name: second, room: 1, isLucky: false },
      { name: third, room: 2, isLucky: false },
      { name: fourth, room: 2, isLucky: false },
    ];

    it('is avoided by trading the bottom half: P1-P4 and P3-P2 instead of the pairing of round 1', () => {
      const state = createDefaultTournamentState({
        players: ['P1', 'P3', 'P2', 'P4'],
        rounds: [swissRound(1)],
        assignments: [room('P1', 'P2', 'P3', 'P4')],
      });
      const result = swissPair({
        activeNames: ['P1', 'P2', 'P3', 'P4'],
        throughRoundIndex: 0,
        roomSize,
        state,
      });
      expect(pairsOf(result.seeded)).toEqual([
        ['P1', 'P4'],
        ['P3', 'P2'],
      ]);
    });

    it('is avoided where the old single swap could not: the only rematch-free pairing is found', () => {
      // Rounds 1 and 2 played P1-P2/P3-P4 and P1-P4/P2-P3; only P1-P3 and P2-P4 are left.
      const state = createDefaultTournamentState({
        players: ['P1', 'P3', 'P2', 'P4'],
        rounds: [swissRound(1), swissRound(2)],
        assignments: [room('P1', 'P2', 'P3', 'P4'), room('P1', 'P4', 'P2', 'P3')],
      });
      const result = swissPair({
        activeNames: ['P1', 'P2', 'P3', 'P4'],
        throughRoundIndex: 1,
        roomSize,
        state,
      });
      expect(pairsOf(result.seeded)).toEqual([
        ['P1', 'P3'],
        ['P2', 'P4'],
      ]);
    });

    it('still gives a full pairing when every unit has met every other (the plain pairing, as a last resort)', () => {
      const state = createDefaultTournamentState({
        players: ['P1', 'P2', 'P3', 'P4'],
        rounds: [swissRound(1), swissRound(2), swissRound(3)],
        assignments: [
          room('P1', 'P2', 'P3', 'P4'),
          room('P1', 'P3', 'P2', 'P4'),
          room('P1', 'P4', 'P2', 'P3'),
        ],
      });
      const result = swissPair({
        activeNames: ['P1', 'P2', 'P3', 'P4'],
        throughRoundIndex: 2,
        roomSize,
        state,
      });
      expect(result.byeName).toBeNull();
      expect(result.seeded).toHaveLength(4);
      expect(new Set(result.seeded.map((entry) => entry.name)).size).toBe(4);
      expect(pairsOf(result.seeded)).toEqual([
        ['P1', 'P3'],
        ['P2', 'P4'],
      ]);
    });

    it('counts only Swiss rounds: a unit pair that met in a non-Swiss round may meet again', () => {
      const state = createDefaultTournamentState({
        players: ['P1', 'P2', 'P3', 'P4'],
        rounds: [buildRound({ roundNum: 1, isQual: true, players: 4, rooms: [4] })],
        assignments: [buildAssignments(['P1', 'P2', 'P3', 'P4'], [4])],
      });
      const result = swissPair({
        activeNames: ['P1', 'P2', 'P3', 'P4'],
        throughRoundIndex: 0,
        roomSize,
        state,
      });
      expect(pairsOf(result.seeded)).toEqual([
        ['P1', 'P3'],
        ['P2', 'P4'],
      ]);
    });
  });

  describe('a late joiner', () => {
    const finishing = ['A', 'B', 'C', 'D', 'E', 'F'];

    it('is paired inside the score group holding the middle rank, not last', () => {
      // Six regular units (even), one joiner: the odd field gives the bye to the lowest ranked regular, F.
      const state = afterOneRoom(finishing, ['J']);
      const result = swissPair({ activeNames: [...finishing, 'J'], throughRoundIndex: 0, roomSize, state });
      expect(result.byeName).toBe('F');
      // Five regulars, groups of one: the middle rank is C, so J meets C; A-B and D-E pair as neighbours.
      expect(pairsOf(result.seeded)).toEqual([
        ['A', 'B'],
        ['C', 'J'],
        ['D', 'E'],
      ]);
    });

    it('never takes the bye while a regular unit can', () => {
      const result = swissPair({
        activeNames: [...finishing, 'J'],
        throughRoundIndex: 0,
        roomSize,
        state: afterOneRoom(finishing, ['J']),
      });
      expect(result.byeName).not.toBe('J');
    });

    it('takes the bye when only joiners are left', () => {
      const state = createDefaultTournamentState({
        players: ['J1', 'J2', 'J3'],
        rounds: [
          buildRound({ roundNum: 1, isSwiss: true, isNoElim: true, players: 0, rooms: [] }),
          buildRound({ roundNum: 2, isSwiss: true, isNoElim: true, pairingTBD: true, players: 0, rooms: [] }),
        ],
      });
      const result = swissPair({
        activeNames: ['J1', 'J2', 'J3'],
        throughRoundIndex: 0,
        roomSize,
        state,
      });
      expect(result.byeName).toBe('J3');
      expect(pairsOf(result.seeded)).toEqual([['J1', 'J2']]);
    });
  });
});

/** The reported tournament: 12 teams, team indexes as in the log; each pair is `[first, second, winner]`. */
const REPORTED: Array<Array<[number, number, number]>> = [
  [
    [6, 2, 6],
    [9, 3, 9],
    [10, 7, 10],
    [5, 4, 5],
    [1, 8, 8],
    [0, 11, 0],
  ],
  [
    [10, 2, 10],
    [0, 1, 0],
    [9, 4, 9],
    [5, 3, 3],
    [8, 11, 8],
    [6, 7, 6],
  ],
  [
    [10, 3, 10],
    [0, 2, 0],
    [9, 1, 9],
    [8, 4, 8],
    [6, 11, 6],
    [5, 7, 5],
  ],
];

/** A generated 12-unit head-to-head Swiss, the first `roundCount` rounds replaced by the reported pairings and results. */
function reportedTournament(roundCount: number): { state: TournamentState; names: string[] } {
  const base = generated(12, {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'swiss',
    qualAdv: '8',
    oddCountStrategy: 'bye',
  });
  const names = rosterKeys(base.players);
  const assignments = base.assignments.map((round) => [...round]);
  const scores: Record<string, number> = {};
  for (const [roundIndex, pairs] of REPORTED.slice(0, roundCount).entries()) {
    assignments[roundIndex] = pairs.flatMap(([first, second], index) => {
      scores[`r${roundIndex}-rm${index + 1}-p0`] = first === pairs[index][2] ? 900 : 100;
      scores[`r${roundIndex}-rm${index + 1}-p1`] = second === pairs[index][2] ? 900 : 100;
      return [
        { name: names[first], room: index + 1, isLucky: false },
        { name: names[second], room: index + 1, isLucky: false },
      ];
    });
  }
  return { state: { ...base, started: true, assignments, scores }, names };
}

describe('the reported tournament (test 1793544046722)', () => {
  const index = (names: string[], name: string) => names.indexOf(name);

  it('round 3 pairs the 2-0 units with each other, one of them floating down to the 1-1 units', () => {
    const { state, names } = reportedTournament(2);
    const draw = swissPair({ activeNames: names, throughRoundIndex: 1, roomSize, state });
    const pairs = pairsOf(draw.seeded).map((pair) => pair.map((name) => index(names, name)));
    const undefeated = new Set([10, 0, 9, 8, 6]);
    const inside = pairs.filter((pair) => pair.every((unit) => undefeated.has(unit)));
    expect(inside).toHaveLength(2);
    expect(
      pairs.filter((pair) => pair.some((unit) => undefeated.has(unit)) && !inside.includes(pair)),
    ).toHaveLength(1);
    expect(draw.byeName).toBeNull();
  });

  it('round 4 pairs the 3-0 units with each other and repeats no pair', () => {
    const { state, names } = reportedTournament(3);
    const draw = swissPair({ activeNames: names, throughRoundIndex: 2, roomSize, state });
    const pairs = pairsOf(draw.seeded).map((pair) => pair.map((name) => index(names, name)));
    expect(pairs).toHaveLength(6);
    const unbeaten = new Set([10, 0, 9, 8, 6]);
    const inside = pairs.filter((pair) => pair.every((unit) => unbeaten.has(unit)));
    expect(inside).toHaveLength(2);
    // The fifth unbeaten unit floats down and meets the 2-1 unit, 5.
    const floater = pairs.find((pair) => pair.includes(5));
    expect(floater?.filter((unit) => unbeaten.has(unit))).toHaveLength(1);
    const played = new Set(
      REPORTED.flatMap((round) => round.map(([first, second]) => roomPairKey(names[first], names[second]))),
    );
    for (const pair of pairsOf(draw.seeded)) expect(played.has(roomPairKey(pair[0], pair[1]))).toBe(false);
  });
});

/** A small repeatable generator: the results of a test run must not change from one run to the next. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scores every 1v1 room of the round in play; the first or the second unit wins, at random. */
function scoreAtRandom(state: TournamentState, random: () => number): TournamentState {
  const scores = { ...state.scores };
  const firstWins = new Map<number, boolean>();
  const seated = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    if (!firstWins.has(entry.room)) firstWins.set(entry.room, random() < 0.5);
    const position = seated.get(entry.room) ?? 0;
    seated.set(entry.room, position + 1);
    const wins = firstWins.get(entry.room) === (position === 0);
    scores[`r${state.curRound}-rm${entry.room}-p${position}`] = wins ? 900 : 100;
  }
  return { ...state, scores };
}

/** The pairs of a Swiss round, as unit pair keys. */
function pairKeys(state: TournamentState, roundIndex: number): string[] {
  return pairsOf(state.assignments[roundIndex]).map((pair) => roomPairKey(pair[0], pair[1]));
}

describe.each([31, 37])('an adaptive Swiss of %i units played through at random', (count) => {
  const swiss = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'swiss',
    qualAdv: '16',
    oddCountStrategy: 'bye',
  } as const;

  it('draws every round with one bye, no repeated pair and pairs inside their score group', () => {
    const random = seededRandom(count);
    let state: TournamentState = { ...generated(count, swiss), started: true };
    const swissRounds = state.rounds.filter((round) => round.isSwiss).length;
    expect(swissRounds).toBeGreaterThanOrEqual(5);
    const seen = new Set(pairKeys(state, 0));
    for (let roundIndex = 0; roundIndex + 1 < swissRounds; roundIndex += 1) {
      const scored = scoreAtRandom(state, random);
      const standings = computeQualificationStandings(scored);
      const fewest = Math.min(...standings.map((entry) => scored.poolingByeCounts[entry.name] ?? 0));
      const expectedBye = standings
        .filter((entry) => (scored.poolingByeCounts[entry.name] ?? 0) === fewest)
        .at(-1)?.name;
      state = pressNextRound(scored);

      // One bye, to the lowest ranked of those with the fewest so far; nobody has two while another has none.
      expect(state.byes[roundIndex + 1]).toEqual([expectedBye]);
      const counts = standings.map((entry) => state.poolingByeCounts[entry.name] ?? 0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

      // No pair repeats.
      const keys = pairKeys(state, roundIndex + 1);
      for (const key of keys) expect(seen.has(key)).toBe(false);
      for (const key of keys) seen.add(key);

      // A pair is inside one score group, apart from the floaters: one for each group boundary an odd number of units is above.
      const pointsOf = new Map(standings.map((entry) => [entry.name, rankingPoints(entry)]));
      const groupSizes = new Map<number, number>();
      for (const entry of standings.filter((entry) => entry.name !== expectedBye)) {
        const points = rankingPoints(entry) ?? -1;
        groupSizes.set(points, (groupSizes.get(points) ?? 0) + 1);
      }
      let above = 0;
      let floaters = 0;
      for (const size of [...groupSizes.values()].slice(0, -1)) {
        above += size;
        if (above % 2 !== 0) floaters += 1;
      }
      const across = pairsOf(state.assignments[roundIndex + 1]).filter(
        ([first, second]) => !samePoints(pointsOf.get(first) ?? null, pointsOf.get(second) ?? null),
      );
      expect(across.length).toBeLessThanOrEqual(floaters);
    }
  });
});

describe('a Swiss draw undone and drawn again', () => {
  it('counts the bye once and gives it to the same unit', () => {
    const base = {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'swiss',
      qualAdv: '4',
      oddCountStrategy: 'bye',
    } as const;
    const random = seededRandom(9);
    const scored = scoreAtRandom({ ...generated(9, base), started: true }, random);
    const first = pressNextRound(scored);
    const byeCount = (counts: Record<string, number>) =>
      Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(byeCount(first.poolingByeCounts)).toBe(byeCount(scored.poolingByeCounts) + 1);
    const previous = { ...first, curRound: previousColumnStart(first) ?? first.curRound - 1 };
    const redone = advanceTournamentRound(previous);
    expect(redone.status).toBe('advanced');
    if (redone.status !== 'advanced') return;
    expect(byeCount(redone.state.poolingByeCounts)).toBe(byeCount(scored.poolingByeCounts) + 1);
    expect(redone.state.poolingByeCounts).toEqual(first.poolingByeCounts);
    expect(redone.state.byes[1]).toEqual(first.byes[1]);
    expect(redone.state.assignments[1]).toEqual(first.assignments[1]);
  });
});
