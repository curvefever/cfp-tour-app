import { describe, expect, it } from 'vitest';
import {
  buildAdvancementTiers,
  computeQualificationStandings,
  relativeRoomShare,
  roomBasedComputeAdvancement,
  roomFinishOrder,
  roomPointsByPlace,
} from '../advancement';
import { fairCutAdvancement, sizePools } from '../fair-cut';
import { stageMatchFields } from '../match-format';
import { computeRankings } from '../rankings';
import { rosterKeys } from '../roster';
import { fitRoundToPool } from '../room-distribution';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import {
  SE_2V2V2V2,
  SE_FFA,
  firstEliminationIndex,
  generate,
  seatRound,
  withRoundShape,
} from './fair-cut-fixtures';
import { scoreCurrentRound, withEarlierCutRule } from './play-through';

/** Per room, per seat, the score of each game. */
type GameScores = number[][][];

/** The round played as a Best of N, its game count worked out for its largest room. */
function asBestOf(state: TournamentState, roundIndex: number, bestOf: number): TournamentState {
  const rounds = [...state.rounds];
  const round = rounds[roundIndex];
  rounds[roundIndex] = { ...round, ...stageMatchFields(1, bestOf, Math.max(...round.rooms)) };
  return { ...state, rounds };
}

function scoreGames(state: TournamentState, roundIndex: number, rooms: GameScores): TournamentState {
  const scores = { ...state.scores };
  rooms.forEach((seats, room) =>
    seats.forEach((games, seat) =>
      games.forEach((value, game) => {
        scores[`r${roundIndex}-rm${room + 1}-p${seat}-g${game + 1}`] = value;
      }),
    ),
  );
  return { ...state, scores };
}

/** A seated, scored round: `rooms` are the games of each seat. */
function played(state: TournamentState, roundIndex: number, rooms: GameScores): TournamentState {
  const seated = seatRound(
    state,
    roundIndex,
    rooms.map((seats) => seats.length),
  );
  return scoreGames(seated, roundIndex, rooms);
}

const total = (games: number[]) => games.reduce((sum, value) => sum + value, 0);

/** What the relative room share of every seat is on the totals, the way the rule reads it. */
function totalShares(room: number[][]): number[] {
  const totals = room.map(total);
  const roomTotal = total(totals);
  return totals.map((seatTotal) => (seatTotal / roomTotal) * room.length);
}

const sortedNumbers = (values: number[]) => [...values].sort((first, second) => first - second);

describe('FFA at 37: a Best of 3 round before the Semis, rooms of 8 and 7', () => {
  /** The winner takes both games; every other seat has no win, and the runner-up of room 1 has the best total of the round. */
  const rooms: GameScores = [8, 8, 7, 7, 7].map((size, room) =>
    Array.from({ length: size }, (_, seat) => {
      if (seat === 0) return [100, 100];
      const score = room === 0 && seat === 1 ? 99 : 55 - 5 * (seat - 1) - room;
      return [score, score];
    }),
  );

  function round() {
    const base = generate('ffa-37', 37, SE_FFA);
    const index = firstEliminationIndex(base);
    return { index, state: played(asBestOf(base, index, 3), index, rooms) };
  }

  it('places the winner first and the runner-up with the best total second, not the room order', () => {
    const { index, state } = round();
    expect(state.rounds[index]).toMatchObject({ bestOf: 3, numGames: 9 });
    expect(roomFinishOrder(state, index, 1).slice(0, 3)).toEqual(['R1P1', 'R1P2', 'R1P3']);
  });

  it('pools the relative scores of each room size from the totals of the counted games, not from the wins', () => {
    const { index, state } = round();
    const pools = sizePools(state, index);
    const expected = (sizes: number[]) => sortedNumbers(sizes.flatMap((room) => totalShares(rooms[room])));
    const read = (size: number) => sortedNumbers(pools.get(size) ?? []);
    expect(read(8)).toHaveLength(16);
    read(8).forEach((value, at) => expect(value).toBeCloseTo(expected([0, 1])[at], 9));
    read(7).forEach((value, at) => expect(value).toBeCloseTo(expected([2, 3, 4])[at], 9));
  });

  it('ranks the units of a room by the relative total in the fair cut', () => {
    const { index, state } = round();
    const group = fairCutAdvancement(state, index).groups.find((entry) => entry.size === 8);
    const unit = group?.ranked.find((entry) => entry.name === 'R1P2');
    expect(unit?.place).toBe(2);
    expect(unit?.relative).toBeCloseTo(totalShares(rooms[0])[1], 9);
  });
});

describe('1v1 at 31, Semis override 6 and Best of 3: the room winners race as lucky losers', () => {
  const setup = { ...SE_FFA, gameFormat: 'individual-1v1', semisOverride: '6', semisBestOf: '3' } as const;

  function semis(rooms: GameScores) {
    const base = generate('1v1-31', 31, setup);
    const index = base.rounds.findIndex((round) => round.isSemis);
    return { index, state: played(base, index, rooms) };
  }

  // Room A won 2-1 by far the most; room B won 2-0 by a hair; room C won 2-0 clearly.
  const rooms: GameScores = [
    [
      [100, 10, 100],
      [10, 11, 10],
    ],
    [
      [100, 100],
      [99, 99],
    ],
    [
      [100, 100],
      [60, 60],
    ],
  ];

  it('is accepted at generation', () => {
    const { index, state } = semis(rooms);
    expect(state.rounds[index]).toMatchObject({ rooms: [2, 2, 2], bestOf: 3, numGames: 3, luckyCount: 2 });
  });

  it('picks the winners with the best relative total (the rule is the total, not the wins)', () => {
    const { index, state } = semis(rooms);
    const wanted = ['R1P1', 'R3P1'];
    expect(roomBasedComputeAdvancement(state, index).luckyNames).toEqual(wanted);
    expect(roomBasedComputeAdvancement(withEarlierCutRule(state), index).luckyNames).toEqual(wanted);
  });
});

describe('2v2v2v2 at 43: a Best of 3 Semis of rooms of 4, 3 and 3 teams, one lucky loser', () => {
  const setup = { ...SE_2V2V2V2, semisOverride: '10', semisBestOf: '3' } as const;

  // Room 1: the runner-up won one game and was blown out in the others; room 2: the runner-up won none, close.
  const rooms: GameScores = [
    [
      [100, 50, 100],
      [10, 90, 10],
      [45, 45, 45],
      [20, 20, 20],
    ],
    [
      [100, 100],
      [95, 95],
      [5, 5],
    ],
    [
      [100, 100],
      [10, 10],
      [5, 5],
    ],
  ];

  function semis() {
    const base = generate('2v2v2v2-43', 43, setup);
    const index = base.rounds.findIndex((round) => round.isSemis);
    return { index, state: played(base, index, rooms) };
  }

  it('generates rooms of 4, 3 and 3 over 5 games (the largest room: 4 x 1 + 1)', () => {
    const { index, state } = semis();
    expect(state.rounds[index]).toMatchObject({ rooms: [4, 3, 3], bestOf: 3, numGames: 5, luckyCount: 1 });
  });

  it('sends the runner-up with the best relative total through, not the one with a win (the rule is the total)', () => {
    const { index, state } = semis();
    expect(totalShares(rooms[1])[1]).toBeGreaterThan(totalShares(rooms[0])[1]);
    expect(roomBasedComputeAdvancement(state, index).luckyNames).toEqual(['R2P2']);
    expect(roomBasedComputeAdvancement(withEarlierCutRule(state), index).luckyNames).toEqual(['R2P2']);
  });

  it('decides the fair cut spare cut on the percentile of the total: the runner-up with a win and a poor total goes out', () => {
    const { index, state } = semis();
    const [cut] = fairCutAdvancement(state, index).spareCuts;
    expect(cut.out.unit.name).toBe('R1P2');
    expect(cut.out.percentile).toBeLessThan(
      cut.contenders.find((entry) => entry.unit.name === 'R2P2')?.percentile ?? 0,
    );
  });

  it('orders the tiers after the round by the relative total', () => {
    const { index, state } = semis();
    const names = ['R1P2', 'R2P2', 'R3P2'];
    const [tier] = buildAdvancementTiers(state, index, names).filter((entry) => entry.rank === 1);
    const pct = Object.fromEntries(tier.members.map((member) => [member.name, member.pct]));
    expect(pct.R1P2).toBeCloseTo(totalShares(rooms[0])[1], 9);
    expect(pct.R2P2).toBeCloseTo(totalShares(rooms[1])[1], 9);
    expect(pct.R3P2).toBeCloseTo(totalShares(rooms[2])[1], 9);
  });
});

describe('a Best of 3 Semis re-fitted after a withdrawal', () => {
  const base = () => generate('2v2v2v2-43', 43, { ...SE_2V2V2V2, semisBestOf: '3' });
  const semisIndex = (state: TournamentState) => state.rounds.findIndex((round) => round.isSemis);

  it('plays and ranks a room of three: the winner by wins, the others by total', () => {
    const state = base();
    const index = semisIndex(state);
    const fitted = fitRoundToPool(state.rounds[index], 7, { min: 3, max: 4, ideal: 4 });
    if ('error' in fitted) throw new Error(fitted.error);
    expect(fitted).toMatchObject({ rooms: [4, 3], bestOf: 3, numGames: 5 });
    const rounds = [...state.rounds];
    rounds[index] = fitted;
    const rooms: GameScores = [
      [
        [100, 100],
        [60, 60],
        [20, 20],
        [10, 10],
      ],
      [
        [100, 100],
        [70, 70],
        [5, 5],
      ],
    ];
    const next = played({ ...state, rounds }, index, rooms);
    expect(roomFinishOrder(next, index, 2)).toEqual(['R2P1', 'R2P2', 'R2P3']);
    expect(roomBasedComputeAdvancement(next, index).advancing.map((entry) => entry.name)).toEqual([
      'R1P1',
      'R1P2',
      'R2P1',
      'R2P2',
    ]);
  });

  it('advances a lone unit as any lone unit advances', () => {
    const state = base();
    const index = semisIndex(state);
    const shaped = asBestOf(withRoundShape(state, index, { rooms: [3, 1], advTotal: 2 }), index, 3);
    const next = played(shaped, index, [
      [
        [100, 100],
        [60, 60],
        [20, 20],
      ],
    ]);
    const named = seatRound(next, index, [3, 1]);
    expect(roomBasedComputeAdvancement(named, index).advancing.map((entry) => entry.name)).toContain('R2P1');
  });
});

describe('a Best of 3 pooling round: Qualification Table, FFA at 53', () => {
  const rooms = (sizes: number[]): GameScores =>
    sizes.map((size) =>
      Array.from({ length: size }, (_, seat) => (seat === 0 ? [100, 100] : [60 - 5 * seat, 60 - 5 * seat])),
    );

  /** Round 1 played by the roster, in order: P1..P8 in room 1, and so on. */
  function qualified() {
    const base = generate('ffa-53', 53, { ...SE_FFA, poolingPhase: 'qual-table', qualAdv: '24' });
    const first = asBestOf(base, 0, 3);
    const names = [...rosterKeys(first.players)];
    const assignments = [...first.assignments];
    assignments[0] = first.rounds[0].rooms.flatMap((size, room) =>
      Array.from({ length: size }, () => ({ name: names.shift() as string, room: room + 1, isLucky: false })),
    );
    return scoreGames({ ...first, assignments }, 0, rooms(first.rounds[0].rooms));
  }

  it('gives the match winner the 1st-place points and the tie-break from the totals', () => {
    const state = qualified();
    const sizes = state.rounds[0].rooms;
    const standings = computeQualificationStandings(state);
    const winner = standings.find((entry) => entry.name === 'P1');
    expect(winner?.rounds?.[0]).toMatchObject({ rank: 1, points: roomPointsByPlace(state, sizes[0])[0] });
    const runnerUp = standings.find((entry) => entry.name === 'P2');
    expect(runnerUp?.rounds?.[0]).toMatchObject({ rank: 2 });
    expect(winner?.roomShare).toBeCloseTo(totalShares(rooms(sizes)[0])[0], 9);
    expect(runnerUp?.roomShare).toBeCloseTo(totalShares(rooms(sizes)[0])[1], 9);
  });
});

describe('1v1 at 31, a Best of 3 elimination round: units out of different rooms at the same place', () => {
  const setup = {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'single-elimination',
    poolingPhase: 'none',
  } as const;

  /** The first elimination round played and advanced as a Best of 3; rooms 1 and 2 as given, every other room 2-0 by a wide margin. */
  function afterRound(first: GameScores): TournamentState {
    let state = generate('1v1-31', 31, setup);
    while (state.rounds[state.curRound].isNoElim) {
      const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
      if (advanced.status !== 'advanced') throw new Error('could not advance a warm-up');
      state = advanced.state;
    }
    const index = state.curRound;
    state = asBestOf(state, index, 3);
    const rooms: GameScores = state.rounds[index].rooms.map(
      (_, room) =>
        first[room] ?? [
          [100, 100],
          [10, 10],
        ],
    );
    const advanced = advanceTournamentRound(scoreGames(state, index, rooms));
    if (advanced.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(advanced)}`);
    return advanced.state;
  }

  it('orders them by the relative total: a 0-2 loser with a close total ranks above a 1-2 loser with a poor one', () => {
    const state = afterRound([
      [
        [100, 10, 100],
        [10, 90, 10],
      ],
      [
        [100, 100],
        [99, 99],
      ],
    ]);
    const index = state.rounds.findIndex((round, at) => at < state.curRound && !round.isNoElim);
    const out = (room: number) => {
      const loser = state.assignments[index].filter((entry) => entry.room === room)[1].name;
      return computeRankings(state)?.eliminatedList.find((entry) => entry.name === loser);
    };
    expect(out(1)?.place).toBe(2);
    expect(out(2)?.place).toBe(2);
    expect(out(2)?.rank).toBeLessThan(out(1)?.rank ?? 0);
  });
});

describe('a Best of 3 room where every game was drawn, in the fair cut and the earlier cut', () => {
  const setup = { ...SE_FFA, gameFormat: 'individual-1v1', semisOverride: '6', semisBestOf: '3' } as const;

  // Room 1 scored 0 in every game, room 2 drew every game for 60, room 3 was won 2-0 by a wide margin.
  const rooms: GameScores = [
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
    [
      [60, 60, 60],
      [60, 60, 60],
    ],
    [
      [100, 100],
      [10, 10],
    ],
  ];

  function semis() {
    const base = generate('1v1-31', 31, setup);
    const index = base.rounds.findIndex((round) => round.isSemis);
    return { index, state: played(base, index, rooms) };
  }

  const luckyRooms = (names: string[] | null) => (names ?? []).map((name) => name.slice(0, 2)).sort();

  it('counts as scored under the fair cut: its units get a real relative, so it beats a room nobody scored in', () => {
    const { index, state } = semis();
    const room = fairCutAdvancement(state, index).groups.flatMap((group) => group.ranked);
    expect(room.filter((unit) => unit.room === 2).every((unit) => unit.roomScored)).toBe(true);
    expect(room.filter((unit) => unit.room === 1).some((unit) => unit.roomScored)).toBe(false);
    expect(luckyRooms(roomBasedComputeAdvancement(state, index).luckyNames)).toEqual(['R2', 'R3']);
  });

  it('is a candidate under the earlier cut too: the all-zero check reads the totals', () => {
    const { index, state } = semis();
    const result = roomBasedComputeAdvancement(withEarlierCutRule(state), index);
    expect(luckyRooms(result.luckyNames)).toEqual(['R2', 'R3']);
  });
});

describe('a summed round reads its score, as before', () => {
  it('measures a unit against its room average on the plain scores', () => {
    const room = [{ score: 30 }, { score: 10 }];
    expect(relativeRoomShare(room[0], room)).toBe(1.5);
    expect(relativeRoomShare(room[1], room)).toBe(0.5);
    expect(relativeRoomShare({ score: 0 }, [{ score: 0 }, { score: 0 }])).toBe(1);
  });

  it('keeps per-player scores for a team playing short', () => {
    const room = [
      { score: 30, players: 3 },
      { score: 20, players: 2 },
    ];
    expect(relativeRoomShare(room[0], room)).toBeCloseTo(1, 12);
  });

  it('reads the total of a Best-of unit, not its wins', () => {
    const room = [
      { score: 2, tiebreak: 150 },
      { score: 0, tiebreak: 50 },
    ];
    expect(relativeRoomShare(room[0], room)).toBe(1.5);
    expect(relativeRoomShare(room[1], room)).toBe(0.5);
  });
});
