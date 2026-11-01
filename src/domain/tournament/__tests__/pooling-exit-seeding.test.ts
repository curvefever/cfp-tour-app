import { describe, expect, it } from 'vitest';
import { orderedQualificationTable, selectGroupExit } from '../advancement';
import { avoidMetPairsNearRank, roomPairKey, seedFromPoolingExit, snakeSeed, tieredSeed } from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { RoundAssignment, TournamentGroup, TournamentState } from '../types';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';
import { buildRound } from './test-fixtures';

const ranks = (count: number) => Array.from({ length: count }, (_, index) => `U${index + 1}`);

/** The rooms as lists of exit ranks (1 = best), the way the draw reads: `1v8 | 2v7`. */
function roomsByRank(seeded: readonly RoundAssignment[], order: readonly string[]): string {
  const rooms = new Map<number, number[]>();
  for (const entry of seeded) {
    if (entry.room !== null) {
      rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), order.indexOf(entry.name) + 1]);
    }
  }
  return [...rooms.entries()]
    .sort(([first], [second]) => first - second)
    .map(([, members]) => members.sort((first, second) => first - second).join('v'))
    .join(' | ');
}

describe('snakeSeed with room sizes', () => {
  it('bounces over the rooms: 8 into 4 rooms of 2 is 1v8, 2v7, 3v6, 4v5', () => {
    expect(roomsByRank(snakeSeed(ranks(8), [2, 2, 2, 2]), ranks(8))).toBe('1v8 | 2v7 | 3v6 | 4v5');
  });

  it('16 into 2 rooms of 8, and into 4 rooms of 4', () => {
    const order = ranks(16);
    expect(roomsByRank(snakeSeed(order, [8, 8]), order)).toBe('1v4v5v8v9v12v13v16 | 2v3v6v7v10v11v14v15');
    expect(roomsByRank(snakeSeed(order, [4, 4, 4, 4]), order)).toBe(
      '1v8v9v16 | 2v7v10v15 | 3v6v11v14 | 4v5v12v13',
    );
  });

  it('skips a full room: 23 into [8, 8, 7] seats rank 22 in room 2 and rank 23 in room 1', () => {
    const order = ranks(23);
    const seeded = snakeSeed(order, [8, 8, 7]);
    const roomOf = (rank: number) => seeded.find((entry) => entry.name === `U${rank}`)?.room;
    expect([roomOf(21), roomOf(22), roomOf(23)]).toEqual([3, 2, 1]);
    expect([1, 2, 3].map((room) => seeded.filter((entry) => entry.room === room).length)).toEqual([8, 8, 7]);
  });

  it.each([
    [31, [8, 8, 8, 7]],
    [37, [8, 8, 7, 7, 7]],
    [11, [4, 4, 3]],
  ])('%i units: every room is filled to its size, no unit twice', (count, sizes) => {
    const order = ranks(count);
    const seeded = snakeSeed(order, sizes);
    expect(new Set(seeded.map((entry) => entry.name)).size).toBe(count);
    expect(sizes.map((_, index) => seeded.filter((entry) => entry.room === index + 1).length)).toEqual(sizes);
  });

  it('a count of rooms is rooms of any size', () => {
    expect(snakeSeed(['A', 'B', 'C', 'D', 'E'], 2).map((entry) => entry.room)).toEqual([1, 2, 2, 1, 1]);
  });
});

describe('avoidMetPairsNearRank', () => {
  const order = ranks(8);
  const draw = snakeSeed(order, [2, 2, 2, 2]);

  it('leaves a draw with no met pair as it is', () => {
    expect(avoidMetPairsNearRank(draw, order, new Set())).toEqual(draw);
  });

  it('1 and 8 having met: the lower-ranked 8 trades with 7 (1v7, 2v8)', () => {
    const result = avoidMetPairsNearRank(draw, order, new Set([roomPairKey('U1', 'U8')]));
    expect(roomsByRank(result, order)).toBe('1v7 | 2v8 | 3v6 | 4v5');
  });

  it('the neighbour one rank below first: 6 and 3 having met, 6 trades with 7', () => {
    const result = avoidMetPairsNearRank(draw, order, new Set([roomPairKey('U3', 'U6')]));
    expect(roomsByRank(result, order)).toBe('1v8 | 2v6 | 3v7 | 4v5');
  });

  it('makes no trade that does not lower the met pairs of the two rooms', () => {
    // 1v8 met, and 8 has met 7's room-mate 2 too: the trade 8 <-> 7 would give 1v7 | 2v8 (one met pair left, 2v8).
    const met = new Set([roomPairKey('U1', 'U8'), roomPairKey('U2', 'U7'), roomPairKey('U2', 'U8')]);
    const result = avoidMetPairsNearRank(draw, order, met);
    const metLeft = [...new Set(result.map((entry) => entry.room))].flatMap((room) => {
      const names = result.filter((entry) => entry.room === room).map((entry) => entry.name);
      return names.flatMap((name, index) => names.slice(index + 1).map((other) => roomPairKey(name, other)));
    });
    expect(metLeft.filter((key) => met.has(key)).length).toBeLessThan(2);
  });

  it('never touches a bye, and every room keeps its size', () => {
    const everyone = new Set(order.flatMap((first) => order.map((second) => roomPairKey(first, second))));
    const withBye = [...draw, { name: 'BYE', room: null, isLucky: false }];
    const result = avoidMetPairsNearRank(withBye, [...order, 'BYE'], everyone);
    expect(result.find((entry) => entry.name === 'BYE')?.room).toBeNull();
    expect([1, 2, 3, 4].map((room) => result.filter((entry) => entry.room === room).length)).toEqual([
      2, 2, 2, 2,
    ]);
  });
});

/** A state at the last qualification round, `count` units in rooms of two, `met` pairs having shared a room in it. */
function atQualificationExit(count: number, nextRooms: number[], met: Array<[string, string]> = []) {
  const names = ranks(count);
  // The met pairs share a room of the played round; every other unit has a room of its own (no other pair has met).
  const together = met.flat();
  const assignments: RoundAssignment[] = names.map((name, index) => ({
    name,
    room: together.includes(name) ? Math.floor(together.indexOf(name) / 2) + 1 : met.length + index + 1,
    isLucky: false,
  }));
  return createDefaultTournamentState({
    cfg: { poolingPhase: 'qual-table', qualAdv: nextRooms.reduce((sum, size) => sum + size, 0) },
    rounds: [
      buildRound({
        roundNum: 1,
        isQual: true,
        isNoElim: true,
        rooms: [2, ...Array<number>(count - 2).fill(1)],
        players: count,
      }),
      buildRound({ roundNum: 2, rooms: nextRooms, players: nextRooms.reduce((sum, size) => sum + size, 0) }),
    ],
    assignments: [assignments],
    curRound: 0,
  });
}

describe('seedFromPoolingExit: the draw after a qualification table', () => {
  const advance = (names: string[]) => names.map((name) => ({ name, isLucky: false }));

  it('FFA, 16 into 2 rooms of 8: ranks 1,4,5,8,9,12,13,16 | 2,3,6,7,10,11,14,15 when no pair has met', () => {
    const state = atQualificationExit(16, [8, 8]);
    const order = ranks(16);
    const noMeetings = { ...state, assignments: [[] as RoundAssignment[]] };
    const seeded = seedFromPoolingExit({ state: noMeetings, roundIndex: 0, advancing: advance(order) });
    expect(roomsByRank(seeded, order)).toBe('1v4v5v8v9v12v13v16 | 2v3v6v7v10v11v14v15');
  });

  it('4v4, 16 into 8: 1v8 | 2v7 | 3v6 | 4v5 when no pair has met, and 1v7 | 2v8 when 1 and 8 have', () => {
    const order = ranks(8);
    const clean = { ...atQualificationExit(16, [2, 2, 2, 2]), assignments: [[] as RoundAssignment[]] };
    expect(
      roomsByRank(seedFromPoolingExit({ state: clean, roundIndex: 0, advancing: advance(order) }), order),
    ).toBe('1v8 | 2v7 | 3v6 | 4v5');
    const met = atQualificationExit(16, [2, 2, 2, 2], [['U1', 'U8']]);
    expect(
      roomsByRank(seedFromPoolingExit({ state: met, roundIndex: 0, advancing: advance(order) }), order),
    ).toBe('1v7 | 2v8 | 3v6 | 4v5');
  });

  it('a resolved cut-off tie changes the exit order, and so the draw: whoever is ranked first meets the weakest', () => {
    const state = { ...atQualificationExit(16, [2, 2, 2, 2]), assignments: [[] as RoundAssignment[]] };
    const exit = ['U9', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U1'];
    const seeded = seedFromPoolingExit({ state, roundIndex: 0, advancing: advance(exit) });
    expect(seeded.find((entry) => entry.name === 'U9')?.room).toBe(
      seeded.find((entry) => entry.name === 'U1')?.room,
    );
  });

  it('a seeding override keeps its own fill, over the exit order: random stays random, balance reads the order', () => {
    const state = { ...atQualificationExit(16, [2, 2]), assignments: [[] as RoundAssignment[]] };
    const order = ranks(4);
    const balance = seedFromPoolingExit({
      state,
      roundIndex: 0,
      advancing: advance(order),
      seedingOverride: 'balance',
    });
    expect(roomsByRank(balance, order)).toBe('1v4 | 2v3');
    const random = tieredSeed({ state, roundIndex: 0, advancing: advance(order), seedingOverride: 'random' });
    expect(random.seeded).toHaveLength(4);
  });
});

type Setup = SweepConfig['setup'];

function playToFirstBracketRound(start: TournamentState, seed = 0): TournamentState {
  let state = start;
  for (let guard = 0; guard < 20; guard += 1) {
    const round = state.rounds[state.curRound];
    if (!round.isQual && !round.isSwiss && !round.isGroupStage && !round.isNoElim) return state;
    const scored =
      seed === 0 ? scoreCurrentRound(state, 4) : scoreFromSeed(scoreCurrentRound(state, 4), seed + guard);
    const result = advanceTournamentRound(scored);
    if (result.status !== 'advanced')
      throw new Error(`blocked: ${result.status} ${JSON.stringify(result).slice(0, 200)}`);
    state = result.state;
  }
  throw new Error('no bracket round reached');
}

/** Replaces the distinct part of every score of the round in play by one drawn from the seed: the tables differ per seed. */
function scoreFromSeed(state: TournamentState, seed: number): TournamentState {
  let draw = seed;
  const scores = { ...state.scores };
  for (const key of Object.keys(scores)) {
    if (!key.startsWith(`r${state.curRound}-`) || !/-m0$|p\d+$/.test(key)) continue;
    draw = (draw * 48271) % 2147483647;
    scores[key] = (100 + (draw % 900)) * 100 + (draw % 97);
  }
  return { ...state, scores };
}

const bracketRooms = (state: TournamentState) => {
  const rooms = new Map<number, string[]>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()];
};

const exitOrderOf = (state: TournamentState, count: number) =>
  orderedQualificationTable(state)
    .ordered.slice(0, count)
    .map((standing) => standing.name);

/** Every pair that shared a room in a round before the one in play. */
function metBefore(state: TournamentState): Set<string> {
  const met = new Set<string>();
  for (const assignments of state.assignments.slice(0, state.curRound)) {
    const byRoom = new Map<number, string[]>();
    for (const entry of assignments) {
      if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
    }
    for (const names of byRoom.values()) {
      names.forEach((name, index) =>
        names.slice(index + 1).forEach((other) => met.add(roomPairKey(name, other))),
      );
    }
  }
  return met;
}

describe('the first bracket round after a qualification table or Swiss, played through', () => {
  // A shared Final of two takes one losers-bracket qualifier (a form setting kept out of the persisted setup).
  const sharedFinalQualifiers = { lbQualifiers: '1' };
  const base: Setup = { gameFormat: 'team-4v4', qualAdv: '8', scheduleLogic: 'single-elimination' };

  it.each(['qual-table', 'swiss'] as const)(
    '%s, 16 teams into 8: 1v8 | 2v7 | 3v6 | 4v5 unless a pair has met, then one rank off',
    (poolingPhase) => {
      let plain = 0;
      for (let seed = 1; seed <= 12; seed += 1) {
        const start = buildState({
          label: poolingPhase,
          count: 16,
          teams: true,
          setup: { ...base, poolingPhase },
        });
        const state = playToFirstBracketRound(start!, seed * 7919);
        const order = exitOrderOf(state, 8);
        const seeded = state.assignments[state.curRound];
        const snake = roomsByRank(snakeSeed(order, state.rounds[state.curRound].rooms), order);
        const met = metBefore(state);
        const snakeMet = [
          [1, 8],
          [2, 7],
          [3, 6],
          [4, 5],
        ].some(([first, second]) => met.has(roomPairKey(order[first - 1], order[second - 1])));
        if (!snakeMet) {
          expect(roomsByRank(seeded, order), `seed ${seed}`).toBe(snake);
          plain += 1;
        }
        expect(new Set(seeded.map((entry) => entry.name)).size).toBe(8);
      }
      expect(plain).toBeGreaterThan(0);
    },
  );

  it.each([
    [31, 16],
    [37, 24],
  ])(
    '%i teams, qualification table into %i: everyone through is seated once, the rooms follow the size-aware snake',
    (count, advancing) => {
      const start = buildState({
        label: 'awkward',
        count,
        teams: true,
        setup: { ...base, qualAdv: `${advancing}`, poolingPhase: 'qual-table' },
      });
      const state = playToFirstBracketRound(start!);
      const order = exitOrderOf(state, advancing);
      const seeded = state.assignments[state.curRound].filter((entry) => entry.room !== null);
      expect(seeded.map((entry) => entry.name).sort()).toEqual([...order].sort());
      const sizes = state.rounds[state.curRound].rooms;
      expect(sizes.map((_, index) => seeded.filter((entry) => entry.room === index + 1).length)).toEqual(
        sizes,
      );
      const met = metBefore(state);
      const snake = snakeSeed(order, sizes);
      const snakeMet = [...new Set(snake.map((entry) => entry.room))].some((room) => {
        const names = snake.filter((entry) => entry.room === room).map((entry) => entry.name);
        return names.some((name, index) =>
          names.slice(index + 1).some((other) => met.has(roomPairKey(name, other))),
        );
      });
      if (!snakeMet) expect(roomsByRank(seeded, order)).toBe(roomsByRank(snake, order));
    },
  );

  it('single elimination with byes: the top of the order has them, the snake runs over the rest', () => {
    const start = buildState({
      label: 'byes',
      count: 16,
      teams: true,
      setup: { ...base, qualAdv: '7', poolingPhase: 'qual-table', oddCountStrategy: 'bye' },
    });
    const state = playToFirstBracketRound(start!);
    const order = exitOrderOf(state, 7);
    expect(state.byes[state.curRound]).toEqual(order.slice(0, 1));
    const rest = order.slice(1);
    const seeded = state.assignments[state.curRound].filter((entry) => entry.room !== null);
    expect(seeded.map((entry) => entry.name).sort()).toEqual([...rest].sort());
  });

  it.each(['double-elimination', 'double-elimination-shared-final'] as const)(
    '%s: the first winners round is drawn by the same snake',
    (scheduleLogic) => {
      const start = buildState({
        label: scheduleLogic,
        count: 16,
        teams: true,
        setup: { ...base, ...sharedFinalQualifiers, scheduleLogic, poolingPhase: 'qual-table' },
      });
      const state = playToFirstBracketRound(start!);
      const order = exitOrderOf(state, 8);
      const rooms = bracketRooms(state);
      expect(rooms.flat().sort()).toEqual([...order].sort());
      const met = metBefore(state);
      const snake = snakeSeed(order, state.rounds[state.curRound].rooms);
      const snakeMet = [1, 2, 3, 4].some((room) => {
        const names = snake.filter((entry) => entry.room === room).map((entry) => entry.name);
        return met.has(roomPairKey(names[0], names[1]));
      });
      if (!snakeMet)
        expect(roomsByRank(state.assignments[state.curRound], order)).toBe('1v8 | 2v7 | 3v6 | 4v5');
    },
  );
});

describe('the first bracket round after groups, played through', () => {
  const groupSetup = (size: string, extra: Setup = {}): Setup => ({
    gameFormat: 'team-4v4',
    poolingPhase: 'group-stage',
    groupSize: size,
    oddCountStrategy: 'bye',
    scheduleLogic: 'single-elimination',
    ...extra,
  });
  const groupOf = (state: TournamentState, name: string) =>
    state.groups.find((group: TournamentGroup) => group.members.includes(name))?.label;

  function check(count: number, setup: Setup, entering: number) {
    let plain = 0;
    let parted = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const start = buildState({ label: 'groups', count, teams: true, setup });
      const state = playToFirstBracketRound(start!, seed * 7919);
      const exit = selectGroupExit(state, state.groupStandings);
      const order = exit.advancing;
      expect(order).toHaveLength(entering);
      const rooms = bracketRooms(state);
      expect(rooms.flat().sort()).toEqual([...order].sort());
      for (const names of rooms) {
        expect(new Set(names.map((name) => groupOf(state, name))).size, `seed ${seed}: ${names.join()}`).toBe(
          names.length,
        );
      }
      const snake = snakeSeed(order, state.rounds[state.curRound].rooms);
      const collides = [...new Set(snake.map((entry) => entry.room))].some((room) => {
        const labels = snake
          .filter((entry) => entry.room === room)
          .map((entry) => groupOf(state, entry.name));
        return new Set(labels).size < labels.length;
      });
      if (!collides) {
        expect(roomsByRank(state.assignments[state.curRound], order), `seed ${seed}`).toBe(
          roomsByRank(snake, order),
        );
        plain += 1;
      } else {
        parted += 1;
      }
    }
    return { plain, parted };
  }

  it('16 teams in 4 groups of 4, 2 per group: the winners meet the runners-up by exit order, group-mates apart', () => {
    const { plain, parted } = check(16, groupSetup('4', { qualifiersPerGroup: '2' }), 8);
    expect(plain).toBeGreaterThan(0);
    expect(parted).toBeGreaterThan(0);
  });

  it('12 teams in 3 groups of 4, fair cut 8: 1v8 | 2v7 | 3v6 | 4v5 over the exit order, group-mates apart', () => {
    const { plain } = check(12, groupSetup('4', { groupExit: 'fair-cut', qualAdv: '8' }), 8);
    expect(plain).toBeGreaterThan(0);
  });

  it('13 and 31 teams in groups of 4, 2 per group: every unit through is seated once', () => {
    check(13, groupSetup('4', { qualifiersPerGroup: '2' }), 6);
    check(31, groupSetup('4', { qualifiersPerGroup: '2' }), 16);
  });
});

describe('a Custom bracket entry round without a Qual source', () => {
  const GRAPH = `
ROUNDS:
R1 = 4x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1.C: 1->R2, 2->eliminated
R1.D: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

  it.each(['swiss', 'group-stage'] as const)('after %s: drawn by the exit order', (poolingPhase) => {
    let plain = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const start = buildState({
        label: 'custom',
        count: 16,
        teams: true,
        setup: {
          gameFormat: 'team-4v4',
          poolingPhase,
          qualAdv: '8',
          groupSize: '4',
          qualifiersPerGroup: '2',
          scheduleLogic: 'waterfall-bracket',
          waterfallGraph: GRAPH,
        },
      });
      const state = playToFirstBracketRound(start!, seed * 7919);
      const order =
        poolingPhase === 'swiss'
          ? exitOrderOf(state, 8)
          : selectGroupExit(state, state.groupStandings).advancing;
      expect(bracketRooms(state).flat().sort()).toEqual([...order].sort());
      const snake = snakeSeed(order, state.rounds[state.curRound].rooms);
      const unmet =
        poolingPhase === 'swiss'
          ? ![
              [0, 7],
              [1, 6],
              [2, 5],
              [3, 4],
            ].some(([first, second]) => metBefore(state).has(roomPairKey(order[first], order[second])))
          : [...new Set(snake.map((entry) => entry.room))].every((room) => {
              const labels = snake
                .filter((entry) => entry.room === room)
                .map((entry) => state.groups.find((group) => group.members.includes(entry.name))?.label);
              return new Set(labels).size === labels.length;
            });
      if (unmet) {
        expect(roomsByRank(state.assignments[state.curRound], order), `seed ${seed}`).toBe(
          roomsByRank(snake, order),
        );
        plain += 1;
      }
    }
    expect(plain).toBeGreaterThan(0);
  });
});
