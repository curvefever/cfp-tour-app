import { describe, expect, it } from 'vitest';
import { recordRoomHistory } from '../seeding';
import type { RoundAssignment, TournamentState } from '../types';
import { buildQualWaterfall } from './qual-waterfall';
import { advanceScored, roomsOf, spreadConfig, startSpread, type SpreadKind } from './spread-play';

/**
 * Units are ordered inside a finishing place by their score relative to the room average, which is the old raw
 * share times a constant when every room of the source round is the same size: those draws do not change. The
 * literals were captured from 4fc0129 (raw share) and cover the draws made from rounds with rooms of one size.
 * The rounds drawn with rooms of mixed sizes after eliminations are left out: their tied smaller-room seats go
 * best first (smaller-room-seats-places.test.ts).
 */

/** Every round's room sizes and line-up as drawn, from the first round to the Final. */
function drawsOf(start: TournamentState): string[] {
  let state = start;
  const lines: string[] = [];
  for (let guard = 0; guard < 40; guard += 1) {
    const round = state.rounds[state.curRound];
    const rooms = roomsOf(state.assignments[state.curRound]).map((room) => room.join(','));
    lines.push(`R${state.curRound + 1} ${round.rooms.join(',')} :: ${rooms.join(' | ')}`);
    if (round.isFinal || state.curRound >= state.rounds.length - 1) break;
    state = advanceScored(state).state;
  }
  return lines;
}

function config(kind: SpreadKind, count: number, pooling: 'none' | 'qual-table', scheduleLogic?: string) {
  const base = spreadConfig(kind, count, { pooling });
  return scheduleLogic ? ({ ...base, setup: { ...base.setup, scheduleLogic } } as typeof base) : base;
}

/** Round 1 replaced by the roster cut into rooms in order, so every run is the same. */
function inOrder(state: TournamentState): TournamentState {
  const names = state.assignments[0]
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const lineUp: RoundAssignment[] = [];
  let cursor = 0;
  for (const [index, size] of state.rounds[0].rooms.entries()) {
    for (const name of names.slice(cursor, cursor + size))
      lineUp.push({ name, room: index + 1, isLucky: false });
    cursor += size;
  }
  return {
    ...state,
    assignments: [lineUp, ...state.assignments.slice(1)],
    roomHistory: recordRoomHistory({}, lineUp, 0),
  };
}

describe('rooms of one size are drawn as before the relative order (captured from 4fc0129)', () => {
  it('FFA 32 (rooms of 8), pooling none, Rounds 1-3', () => {
    expect(drawsOf(startSpread(config('ffa', 32, 'none'))).slice(0, 3)).toEqual(FFA_32);
  });

  it('2v2v2v2 16 (rooms of 4), pooling none, Rounds 1-3', () => {
    expect(drawsOf(startSpread(config('2v2v2v2', 16, 'none'))).slice(0, 3)).toEqual(TEAMS_16);
  });

  it('2v2v2v2 24 qualification table (rooms of 4), Rounds 1-5', () => {
    expect(drawsOf(startSpread(config('2v2v2v2', 24, 'qual-table'))).slice(0, 5)).toEqual(QUAL_24);
  });

  it('double elimination with a shared Final, 16 teams of 2v2v2v2, to Round 5', () => {
    expect(
      drawsOf(startSpread(config('2v2v2v2', 16, 'none', 'double-elimination-shared-final'))).slice(0, 5),
    ).toEqual(DOUBLE_ELIMINATION_16);
  });

  it('waterfall fed by a 24-player FFA qualification table (every room of 8), all 7 rounds', () => {
    expect(drawsOf(inOrder(buildQualWaterfall(24))).slice(0, 7)).toEqual(WATERFALL_24);
  });
});

const FFA_32 = [
  'R1 8,8,8,8 :: P1,P2,P3,P4,P5,P6,P7,P8 | P9,P10,P11,P12,P13,P14,P15,P16 | P17,P18,P19,P20,P21,P22,P23,P24 | P25,P26,P27,P28,P29,P30,P31,P32',
  'R2 8,8,8,8 :: P16,P28,P18,P1,P32,P20,P5,P9 | P29,P14,P2,P21,P19,P6,P11,P25 | P23,P3,P30,P12,P7,P10,P26,P24 | P8,P22,P15,P31,P13,P27,P17,P4',
  'R3 8,8,8,8 :: P12,P17,P1,P2,P6,P27,P23,P32 | P13,P10,P19,P5,P8,P25,P28,P30 | P11,P18,P15,P7,P26,P20,P22,P29 | P16,P14,P3,P4,P9,P24,P21,P31',
];

const TEAMS_16 = [
  'R1 4,4,4,4 :: t1,t2,t3,t4 | t5,t6,t7,t8 | t9,t10,t11,t12 | t13,t14,t15,t16',
  'R2 4,4,4,4 :: t12,t6,t14,t1 | t13,t10,t2,t8 | t7,t3,t11,t15 | t4,t16,t5,t9',
  'R3 4,4,4,4 :: t8,t1,t5,t11 | t6,t4,t15,t10 | t7,t2,t14,t16 | t9,t3,t13,t12',
];

const QUAL_24 = [
  'R1 4,4,4,4,4,4 :: t1,t2,t3,t4 | t5,t6,t7,t8 | t9,t10,t11,t12 | t13,t14,t15,t16 | t17,t18,t19,t20 | t21,t22,t23,t24',
  'R2 4,4,4,4,4,4 :: t17,t10,t5,t21 | t12,t6,t19,t1 | t13,t18,t11,t8 | t7,t23,t2,t15 | t4,t16,t22,t20 | t24,t3,t14,t9',
  'R3 4,4,4,4,4,4 :: t8,t1,t23,t14 | t5,t2,t24,t18 | t6,t3,t17,t16 | t9,t21,t20,t15 | t4,t13,t12,t10 | t7,t22,t11,t19',
  'R4 4,4,4,4,4,4 :: t14,t17,t7,t4 | t15,t19,t13,t24 | t11,t5,t1,t20 | t16,t9,t2,t23 | t18,t12,t21,t3 | t10,t8,t6,t22',
  'R5 4,4,4,4 :: t3,t1,t13,t11 | t9,t4,t5,t15 | t8,t2,t21,t14 | t7,t24,t6,t12',
];

const DOUBLE_ELIMINATION_16 = [
  'R1 4,4,4,4 :: t1,t2,t3,t4 | t5,t6,t7,t8 | t9,t10,t11,t12 | t13,t14,t15,t16',
  'R2 4,4,4,4 :: t12,t6,t14,t1 | t13,t10,t2,t8 | t7,t3,t11,t15 | t4,t16,t5,t9',
  'R3 4,4,4,4 :: t8,t1,t5,t11 | t6,t4,t15,t10 | t7,t2,t14,t16 | t9,t3,t13,t12',
  'R4 4,4,4 :: t14,t10,t9,t7 | t15,t12,t8,t5 | t11,t16,t13,t4',
  'R5 4,3 :: t15,t14,t3,t2 | t16,t1,t6',
];

const WATERFALL_24 = [
  'R1 8,8,8 :: P1,P2,P3,P4,P5,P6,P7,P8 | P9,P10,P11,P12,P13,P14,P15,P16 | P17,P18,P19,P20,P21,P22,P23,P24',
  'R2 8,8,8 :: P16,P3,P18,P21,P13,P6,P5,P9 | P23,P14,P2,P1,P19,P10,P17,P4 | P8,P22,P15,P12,P7,P20,P11,P24',
  'R3 8,8,8 :: P13,P11,P14,P19,P5,P24,P4,P20 | P12,P17,P15,P3,P1,P6,P22,P23 | P10,P16,P18,P7,P8,P2,P9,P21',
  'R4 8,8 :: P3,P16,P8,P13,P14,P15,P23,P18 | P1,P2,P12,P7,P5,P10,P11,P22',
  'R5 8 :: P6,P4,P20,P17,P21,P19,P9,P24',
  'R6 8 :: P18,P11,P15,P10,P14,P12,P16,P7',
  'R7 8 :: P6,P7,P16,P4,P15,P9,P14,P17',
];
