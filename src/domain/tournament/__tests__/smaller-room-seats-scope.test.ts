import { describe, expect, it } from 'vitest';
import { buildFixedRoomSchedule } from '../fixed-draws';
import { countSmallerRoomSeats, smallerRoomSeatsBefore, splitForSmallerRooms } from '../smaller-room-seats';
import type { TournamentState } from '../types';
import {
  advanceScored,
  playToRound,
  roomsOf,
  spreadConfig,
  startSpread,
  type SpreadKind,
} from './spread-play';

/** Every mixed-size room round spreads its smaller-room seats: warm-ups, uncounted rounds, elimination rounds. */

/** Per unit, its smaller-room seats over the given rounds (unweighted), in roster order. */
function seatsOver(state: TournamentState, rounds: number[]): number[] {
  const counts = countSmallerRoomSeats(rounds.map((index) => state.assignments[index]));
  return state.assignments[0].map((entry) => counts[entry.name] ?? 0);
}

/** The names that held a smaller-room seat in one round. */
function seatHoldersIn(state: TournamentState, roundIndex: number): Set<string> {
  return new Set(Object.keys(countSmallerRoomSeats([state.assignments[roundIndex]])));
}

const histogram = (counts: number[]) =>
  counts.reduce<Record<number, number>>(
    (tally, count) => ({ ...tally, [count]: (tally[count] ?? 0) + 1 }),
    {},
  );

const spreadOf = (counts: number[]) => Math.max(...counts) - Math.min(...counts);

const WARM_UPS_THEN_ELIMINATION: Array<[SpreadKind, number]> = [
  ['2v2v2v2', 17],
  ['2v2v2v2', 25],
  ['2v2v2v2', 31],
  ['ffa', 37],
  ['ffa', 43],
  ['ffa', 53],
];

describe('warm-ups and the first elimination round (pooling none)', () => {
  it.each(WARM_UPS_THEN_ELIMINATION)(
    '%s at %i: seat counts over rounds 1-3 differ by at most 1',
    (kind, count) => {
      const { state } = playToRound(startSpread(spreadConfig(kind, count, { pooling: 'none' })), 2);
      for (const index of [0, 1, 2]) expect(new Set(state.rounds[index].rooms).size).toBeGreaterThan(1);
      expect(spreadOf(seatsOver(state, [0, 1, 2]))).toBeLessThanOrEqual(1);
    },
  );

  it('2v2v2v2 at 17 (rooms of 4, 4, 3, 3, 3): 10 teams sit in a room of 3 twice and 7 once, none never or three times', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 17, { pooling: 'none' })), 2);
    expect(state.rounds.slice(0, 3).map((round) => round.rooms)).toEqual([
      [4, 4, 3, 3, 3],
      [4, 4, 3, 3, 3],
      [4, 4, 3, 3, 3],
    ]);
    expect(histogram(seatsOver(state, [0, 1, 2]))).toEqual({ 1: 7, 2: 10 });
  });

  it('2v2v2v2 at 17: a seat in round 1 and a seat in round 2 weigh the same in the round 3 draw', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 17, { pooling: 'none' })), 2);
    const tally = smallerRoomSeatsBefore(state, 2);
    const first = seatHoldersIn(state, 0);
    const second = seatHoldersIn(state, 1);
    const roster = state.assignments[0].map((entry) => entry.name);
    const onlyFirst = roster.filter((name) => first.has(name) && !second.has(name));
    const onlySecond = roster.filter((name) => second.has(name) && !first.has(name));
    expect(onlyFirst.length).toBeGreaterThan(0);
    expect(onlySecond.length).toBeGreaterThan(0);
    for (const name of [...onlyFirst, ...onlySecond]) expect(tally[name]).toBe(0.5);
  });
});

describe('a qualification table with round 1 uncounted (three rounds)', () => {
  function playedTable(kind: SpreadKind, count: number): TournamentState {
    const base = spreadConfig(kind, count);
    const config = { ...base, setup: { ...base.setup, qualRoundsOverride: '3' } };
    return playToRound(startSpread(config), 2).state;
  }

  it.each<[SpreadKind, number]>([
    ['2v2v2v2', 17],
    ['2v2v2v2', 25],
    ['2v2v2v2', 37],
  ])('%s at %i: over the counted rounds the seat counts differ by at most 1', (kind, count) => {
    const state = playedTable(kind, count);
    expect(state.rounds[0].excludeFromStandings).toBe(true);
    expect(spreadOf(seatsOver(state, [1, 2]))).toBeLessThanOrEqual(1);
  });

  it('2v2v2v2 at 17: 16 teams get one counted smaller-room seat and one gets two; round 1 only breaks ties', () => {
    const state = playedTable('2v2v2v2', 17);
    expect(histogram(seatsOver(state, [1, 2]))).toEqual({ 1: 16, 2: 1 });
  });

  it('a seat in the uncounted round breaks ties: behind a unit with none, ahead of a unit with a counted seat', () => {
    const members = ['none', 'uncounted', 'counted'].map((name) => ({ name, tierRank: 0 }));
    const seats = { uncounted: 0.5, counted: 1 };
    const split = splitForSmallerRooms(members, [2, 1, 1], seats, new Set());
    expect(split?.small.map((member) => member.name)).toEqual(['none', 'uncounted']);
  });
});

describe('fixed draws spread the smaller-room seats of every round', () => {
  const roster = Array.from({ length: 17 }, (_, index) => `P${index + 1}`);
  const round = (excludeFromStandings: boolean) => ({
    rooms: [4, 4, 3, 3, 3],
    byeCount: 0,
    ...(excludeFromStandings ? { excludeFromStandings } : {}),
  });

  it('rounds that do not count: 10 teams get two seats and 7 get one', () => {
    const { rounds } = buildFixedRoomSchedule(roster, [round(true), round(true), round(true)]);
    const counts = countSmallerRoomSeats(rounds);
    expect(histogram(roster.map((name) => counts[name] ?? 0))).toEqual({ 1: 7, 2: 10 });
  });

  it('an uncounted round followed by two counted ones: the counted rounds are level within 1', () => {
    const { rounds } = buildFixedRoomSchedule(roster, [round(true), round(false), round(false)]);
    const counts = countSmallerRoomSeats(rounds.slice(1));
    expect(histogram(roster.map((name) => counts[name] ?? 0))).toEqual({ 1: 16, 2: 1 });
  });
});

describe('rounds with their own mechanism are drawn as before (captured from b56d7d1)', () => {
  function drawsOf(kind: SpreadKind, count: number, scheduleLogic: string): string[] {
    const base = spreadConfig(kind, count, { pooling: 'none' });
    const config = { ...base, setup: { ...base.setup, scheduleLogic } } as typeof base;
    let state = startSpread(config);
    const lines: string[] = [];
    for (let guard = 0; guard < 30; guard += 1) {
      const round = state.rounds[state.curRound];
      const rooms = roomsOf(state.assignments[state.curRound]).map((room) => room.join(','));
      lines.push(`R${state.curRound + 1} ${round.rooms.join(',')} :: ${rooms.join(' | ')}`);
      if (round.isFinal) break;
      state = advanceScored(state).state;
    }
    return lines;
  }

  it('Kings Valley, 24 teams of 2v2v2v2', () => {
    expect(drawsOf('2v2v2v2', 24, 'kings-valley')).toEqual(KINGS_VALLEY_24);
  });

  it('double elimination with a shared Final, 24 teams of 2v2v2v2', () => {
    expect(drawsOf('2v2v2v2', 24, 'double-elimination-shared-final')).toEqual(DOUBLE_ELIMINATION_24);
  });

  it('Kings Valley, 40 FFA players', () => {
    expect(drawsOf('ffa', 40, 'kings-valley')).toEqual(KINGS_VALLEY_FFA_40);
  });
});

const KINGS_VALLEY_24 = [
  'R1 4,4,4,4,4,4 :: t1,t2,t3,t4 | t5,t6,t7,t8 | t9,t10,t11,t12 | t13,t14,t15,t16 | t17,t18,t19,t20 | t21,t22,t23,t24',
  'R2 4,4,4,4,4,4 :: t17,t10,t5,t21 | t12,t6,t19,t1 | t13,t18,t11,t8 | t7,t23,t2,t15 | t4,t16,t22,t20 | t24,t3,t14,t9',
  'R3 4,4,4,4,4,4 :: t5,t21,t17,t10 | t6,t1,t12,t19 | t8,t13,t11,t18 | t7,t2,t23,t15 | t4,t22,t20,t16 | t9,t3,t24,t14',
  'R4 4,4,4,4,3,3 :: t17,t10,t5,t12 | t21,t19,t6,t11 | t1,t13,t18,t15 | t8,t7,t2,t16 | t23,t4,t14 | t20,t22,t9',
  'R5 4,4,4,4,4 :: t5,t10,t12,t6 | t17,t21,t11,t1 | t19,t13,t15,t8 | t18,t2,t7,t4 | t16,t23,t14,t9',
  'R6 4,4,4,3,3 :: t6,t5,t12,t1 | t10,t21,t17,t8 | t11,t19,t15,t2 | t13,t7,t9 | t4,t18,t23',
  'R7 4,4,4,4 :: t1,t5,t6,t8 | t12,t10,t17,t2 | t21,t11,t15,t7 | t19,t9,t13,t4',
  'R8 4,4,3,3 :: t1,t5,t6,t10 | t8,t12,t17,t21 | t2,t11,t13 | t15,t7,t19',
  'R9 4,4,4 :: t6,t5,t1,t21 | t10,t8,t17,t2 | t12,t11,t13,t7',
  'R10 4,3,3 :: t21,t6,t5,t10 | t1,t17,t12 | t8,t2,t13',
  'R11 4,4 :: t5,t6,t21,t1 | t10,t17,t12,t2',
  'R12 3,3 :: t5,t6,t17 | t1,t21,t12',
  'R13 4 :: t6,t5,t17,t1',
];

const DOUBLE_ELIMINATION_24 = [
  'R1 4,4,4,4,4,4 :: t1,t2,t3,t4 | t5,t6,t7,t8 | t9,t10,t11,t12 | t13,t14,t15,t16 | t17,t18,t19,t20 | t21,t22,t23,t24',
  'R2 4,4,4,4,4,4 :: t17,t10,t5,t21 | t12,t6,t19,t1 | t13,t18,t11,t8 | t7,t23,t2,t15 | t4,t16,t22,t20 | t24,t3,t14,t9',
  'R3 4,4,4,4,4,4 :: t8,t1,t23,t14 | t5,t2,t24,t18 | t6,t3,t17,t16 | t9,t21,t20,t15 | t4,t13,t12,t10 | t7,t22,t11,t19',
  'R4 4,4,4,3,3 :: t14,t10,t7,t6 | t15,t17,t12,t2 | t11,t5,t13,t21 | t16,t19,t8 | t18,t9,t1',
  'R5 4,4,3 :: t19,t24,t4,t23 | t18,t14,t3,t22 | t13,t17,t20',
  'R6 4,3,3,3 :: t8,t5,t12,t15 | t9,t7,t21 | t2,t16,t10 | t6,t1,t11',
  'R7 4,3,3,3 :: t20,t23,t11,t15 | t3,t13,t19 | t4,t16,t18 | t17,t22,t21',
  'R8 3,3,3 :: t2,t9,t8 | t1,t5,t10 | t7,t6,t12',
  'R9 4,4,4 :: t13,t22,t23,t2 | t21,t18,t19,t12 | t16,t20,t3,t11',
  'R10 4,3 :: t6,t5,t9,t10 | t8,t7,t1',
  'R11 3,3,3 :: t23,t21,t16 | t20,t22,t10 | t18,t11,t19',
  'R12 3,3 :: t7,t6,t8 | t5,t1,t9',
  'R13 4,4 :: t16,t22,t18,t1 | t10,t19,t23,t6',
  'R14 4 :: t9,t8,t7,t5',
  'R15 4,3 :: t22,t6,t18,t8 | t23,t1,t19',
  'R16 3 :: t5,t7,t9',
  'R17 3,3 :: t1,t6,t18 | t8,t19,t9',
  'R18 4 :: t18,t7,t8,t5',
];

const KINGS_VALLEY_FFA_40 = [
  'R1 8,8,8,8,8 :: P1,P2,P3,P4,P5,P6,P7,P8 | P9,P10,P11,P12,P13,P14,P15,P16 | P17,P18,P19,P20,P21,P22,P23,P24 | P25,P26,P27,P28,P29,P30,P31,P32 | P33,P34,P35,P36,P37,P38,P39,P40',
  'R2 8,8,8,8,8 :: P38,P28,P2,P21,P13,P20,P5,P25 | P16,P39,P30,P1,P19,P6,P11,P40 | P29,P22,P33,P12,P7,P10,P17,P4 | P23,P3,P15,P31,P35,P36,P26,P9 | P8,P14,P18,P34,P32,P27,P37,P24',
  'R3 8,8,8,8,8 :: P13,P2,P5,P25,P38,P20,P21,P28 | P11,P16,P19,P1,P6,P39,P30,P40 | P12,P10,P17,P4,P7,P22,P33,P29 | P15,P3,P9,P26,P23,P31,P35,P36 | P14,P18,P8,P27,P24,P32,P34,P37',
  'R4 8,7,7,7,7 :: P2,P5,P28,P21,P20,P25,P1,P6 | P13,P38,P40,P11,P16,P4,P7 | P19,P30,P39,P29,P22,P3,P9 | P10,P12,P17,P33,P23,P8,P24 | P26,P15,P36,P35,P31,P27,P14',
  'R5 8,8,8,8 :: P6,P5,P2,P1,P25,P20,P16,P11 | P21,P28,P13,P40,P7,P4,P19,P9 | P38,P3,P22,P30,P29,P39,P17,P10 | P12,P8,P24,P23,P33,P15,P14,P26',
  'R6 7,7,7,7 :: P6,P5,P2,P1,P11,P40,P7 | P16,P25,P20,P4,P9,P38,P39 | P13,P19,P28,P21,P30,P33,P8 | P3,P10,P17,P29,P22,P12,P14',
  'R7 8,8,8 :: P40,P5,P6,P7,P1,P2,P39,P38 | P11,P20,P25,P9,P4,P16,P28,P21 | P30,P33,P8,P13,P19,P29,P22,P3',
  'R8 7,7,6 :: P5,P7,P6,P1,P2,P9,P4 | P40,P38,P39,P28,P25,P8,P3 | P21,P20,P16,P11,P29,P22',
  'R9 6,6,6 :: P9,P2,P1,P6,P40,P8 | P7,P4,P5,P3,P11,P16 | P28,P39,P38,P25,P29,P20',
  'R10 8,7 :: P40,P2,P1,P6,P9,P8,P16,P11 | P3,P7,P5,P4,P39,P20,P25',
  'R11 6,6 :: P40,P11,P16,P8,P39,P25 | P9,P1,P2,P6,P20,P3',
  'R12 8 :: P40,P39,P8,P11,P16,P25,P9,P1',
];
