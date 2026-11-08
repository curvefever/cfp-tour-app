import { describe, expect, it } from 'vitest';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { buildQualWaterfall } from '../../domain/tournament/__tests__/qual-waterfall';
import { removeRosterUnit } from '../../domain/tournament/mutations';
import { roundExitRule, type RoomExitBand, type RoundExitRule } from '../../domain/tournament/room-exits';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { WATERFALL_EXAMPLES } from '../../domain/tournament/waterfall-examples';
import { absenteeFate, roomRowResult, type RoomRowInput } from './room-row-result';

const perRoom = (bands: RoomExitBand[]): RoundExitRule => ({ kind: 'per-room', rooms: [bands] });

function row(overrides: Partial<RoomRowInput> & Pick<RoomRowInput, 'bands' | 'rank'>) {
  return roomRowResult({
    rule: perRoom(overrides.bands),
    lucky: false,
    pendingTie: false,
    roomComplete: true,
    roundDecided: false,
    ...overrides,
  });
}

describe('roomRowResult: which rows carry a result at all', () => {
  const bands: RoomExitBand[] = [{ kind: 'advance', fromRank: 1, toRank: 4, destination: 5 }];

  it.each<RoundExitRule>([
    { kind: 'standings', counted: true },
    { kind: 'standings', counted: false },
    { kind: 'standings-cutoff', advancing: 24, perGroup: false, destination: 3 },
    { kind: 'all-advance' },
    { kind: 'none' },
  ])('a pooling or final round (%j) has no stripe, scored or not', (rule) => {
    for (const roomComplete of [true, false]) {
      const input = {
        rule,
        bands: [],
        rank: 1,
        lucky: false,
        pendingTie: false,
        roomComplete,
        roundDecided: false,
      };
      expect(roomRowResult(input)).toEqual({ result: '', star: null });
    }
  });

  it('a room still being scored is undecided for everyone, even with a tie that is pending', () => {
    for (const rank of [1, 5]) {
      expect(row({ bands, rank, roomComplete: false })).toEqual({ result: 'undecided', star: null });
    }
    expect(row({ bands, rank: 1, roomComplete: false, pendingTie: true }).result).toBe('undecided');
  });

  it('a complete room with a tie nobody has resolved is pending', () => {
    expect(row({ bands, rank: 2, pendingTie: true })).toEqual({ result: 'pending', star: null });
  });

  it('a rank with no band is eliminated', () => {
    expect(row({ bands, rank: 5 })).toEqual({ result: 'eliminate', star: null });
  });
});

describe('roomRowResult: where an advancing row goes', () => {
  it('a single destination is green throughout', () => {
    const bands: RoomExitBand[] = [{ kind: 'advance', fromRank: 1, toRank: 4, destination: 5 }];
    expect([1, 4].map((rank) => row({ bands, rank }).result)).toEqual(['advance', 'advance']);
  });

  it('two destinations: the first is green, the second yellow (waterfall room)', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
      { kind: 'advance', fromRank: 5, toRank: 6, destination: 7, group: 1 },
      { kind: 'eliminate', fromRank: 7, toRank: 8 },
    ];
    expect([1, 4, 5, 6, 7].map((rank) => row({ bands, rank }).result)).toEqual([
      'advance',
      'advance',
      'advance-second',
      'advance-second',
      'eliminate',
    ]);
  });

  it('three destinations: green, yellow, then purple; a repeated destination keeps its colour', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 2, destination: 5 },
      { kind: 'advance', fromRank: 3, toRank: 3, destination: 7, group: 1 },
      { kind: 'advance', fromRank: 4, toRank: 5, destination: 9, group: 2 },
      { kind: 'advance', fromRank: 6, toRank: 6, destination: 7, group: 1 },
    ];
    expect([1, 2, 3, 4, 5, 6].map((rank) => row({ bands, rank }).result)).toEqual([
      'advance',
      'advance',
      'advance-second',
      'advance-third',
      'advance-third',
      'advance-second',
    ]);
  });

  it('a band without a group is the first group, whatever the room', () => {
    const bands: RoomExitBand[] = [{ kind: 'advance', fromRank: 1, toRank: 4, destination: 6 }];
    expect(row({ bands, rank: 1 }).result).toBe('advance');
  });

  it('a drop to the losers bracket reads as a drop, a rank past the bands as eliminate', () => {
    const bands: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 1, destination: 4 },
      { kind: 'drop', fromRank: 2, toRank: 2, destination: 5 },
    ];
    expect(row({ bands, rank: 2 }).result).toBe('drop');
    expect(row({ bands, rank: 3 }).result).toBe('eliminate');
  });
});

describe('roomRowResult: Kings Valley rooms', () => {
  const top: RoomExitBand[] = [
    { kind: 'stay', fromRank: 1, toRank: 4 },
    { kind: 'demote', fromRank: 5, toRank: 6, targetRoom: 2 },
  ];
  const middle: RoomExitBand[] = [
    { kind: 'promote', fromRank: 1, toRank: 2, targetRoom: 1 },
    { kind: 'stay', fromRank: 3, toRank: 4 },
    { kind: 'demote', fromRank: 5, toRank: 6, targetRoom: 3 },
  ];
  const bottom: RoomExitBand[] = [
    { kind: 'promote', fromRank: 1, toRank: 2, targetRoom: 2 },
    { kind: 'stay', fromRank: 3, toRank: 4 },
    { kind: 'eliminate', fromRank: 5, toRank: 6 },
  ];

  it.each([
    ['top room', top, ['stay', 'stay', 'stay', 'stay', 'demote', 'demote']],
    ['middle room', middle, ['promote', 'promote', 'stay', 'stay', 'demote', 'demote']],
    ['bottom room', bottom, ['promote', 'promote', 'stay', 'stay', 'eliminate', 'eliminate']],
  ])('%s: every row reads as its own band', (_name, bands, expected) => {
    expect([1, 2, 3, 4, 5, 6].map((rank) => row({ bands, rank }).result)).toEqual(expected);
  });
});

describe('roomRowResult: the lucky-loser chance', () => {
  const bands: RoomExitBand[] = [
    { kind: 'advance', fromRank: 1, toRank: 5, destination: 6 },
    { kind: 'lucky-chance', rank: 6, spots: 1, otherwise: 'eliminate' },
    { kind: 'eliminate', fromRank: 7, toRank: 8 },
  ];

  it('the chance rank is a candidate with a star until the round is advanced', () => {
    expect(row({ bands, rank: 6 })).toEqual({ result: 'candidate', star: 'candidate' });
    expect(row({ bands, rank: 5 })).toEqual({ result: 'advance', star: null });
  });

  it('once decided, the lucky unit is green with a star and the others are out', () => {
    expect(row({ bands, rank: 6, roundDecided: true, lucky: true })).toEqual({
      result: 'lucky',
      star: 'lucky',
    });
    expect(row({ bands, rank: 6, roundDecided: true, lucky: false })).toEqual({
      result: 'eliminate',
      star: null,
    });
  });

  it('a chance rank whose otherwise is a drop reads as a drop when not lucky', () => {
    const dropping: RoomExitBand[] = [{ kind: 'lucky-chance', rank: 3, spots: 1, otherwise: { drop: 9 } }];
    expect(row({ bands: dropping, rank: 3, roundDecided: true }).result).toBe('drop');
  });

  it('a room still being scored shows no candidate star (its ranks are not known)', () => {
    expect(row({ bands, rank: 6, roomComplete: false })).toEqual({ result: 'undecided', star: null });
  });
});

/** A started qualification-table tournament played to its first round with lucky-loser slots, which is scored but not advanced. */
function atFirstLuckyRound(count: number): { state: TournamentState; roundIndex: number } {
  const start = buildState({
    label: `ffa ${count}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
    },
  });
  if (!start) throw new Error('generation failed');
  let state = start;
  for (let guard = 0; guard < 20; guard += 1) {
    if (state.rounds[state.curRound].luckyCount > 0) {
      return { state: scoreCurrentRound(state, 0), roundIndex: state.curRound };
    }
    const result = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
    state = result.state;
  }
  throw new Error('no lucky-loser round');
}

describe.each([31, 37, 43, 53])('roomRowResult in the first lucky-loser round with %i players', (count) => {
  const { state, roundIndex } = atFirstLuckyRound(count);
  const rule = roundExitRule(state, roundIndex);
  const rooms = rule.kind === 'per-room' ? rule.rooms : [];
  const results = (input: Pick<RoomRowInput, 'lucky' | 'roundDecided'>) =>
    rooms.flatMap((bands, roomIndex) => {
      const size = (state.assignments[roundIndex] ?? []).filter(
        (entry) => entry.room === roomIndex + 1,
      ).length;
      return Array.from({ length: size }, (_, index) =>
        roomRowResult({ rule, bands, rank: index + 1, pendingTie: false, roomComplete: true, ...input }),
      );
    });
  const chanceRooms = rooms.filter((bands) => bands.some((band) => band.kind === 'lucky-chance')).length;

  it('has a per-room rule with rooms that give a lucky-loser chance', () => {
    expect(rule.kind).toBe('per-room');
    expect(chanceRooms).toBeGreaterThan(0);
  });

  it('before the round is advanced, shows one candidate (dashed, with a star) per chance room and nothing red for it', () => {
    const undecided = results({ lucky: false, roundDecided: false });
    expect(undecided.filter((entry) => entry.result === 'candidate')).toHaveLength(chanceRooms);
    expect(undecided.filter((entry) => entry.star === 'candidate')).toHaveLength(chanceRooms);
    expect(undecided.every((entry) => ['advance', 'eliminate', 'candidate'].includes(entry.result))).toBe(
      true,
    );
  });

  it('once decided, a lucky candidate is green with a star, and an unlucky one is out', () => {
    const lucky = results({ lucky: true, roundDecided: true });
    expect(lucky.filter((entry) => entry.result === 'lucky')).toHaveLength(chanceRooms);
    expect(lucky.some((entry) => entry.result === 'candidate')).toBe(false);
    const unlucky = results({ lucky: false, roundDecided: true });
    expect(unlucky.some((entry) => entry.result === 'lucky')).toBe(false);
    expect(unlucky.filter((entry) => entry.result === 'eliminate').length).toBe(
      lucky.filter((entry) => entry.result === 'eliminate').length + chanceRooms,
    );
  });
});

describe('roomRowResult: an absentee', () => {
  const bands: RoomExitBand[] = [
    { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
    { kind: 'eliminate', fromRank: 5, toRank: 8 },
  ];

  it.each([
    ['a single or double elimination cut', { isKingsValley: false }, 'eliminate'],
    ['a double elimination winners round', { bracket: 'winners' as const }, 'drop'],
    ['a custom bracket', { isWaterfall: true }, 'rank'],
    ['Kings Valley', { isKingsValley: true }, 'rank'],
  ])('%s: %s', (_label, round, fate) => {
    expect(absenteeFate(round)).toBe(fate);
  });

  it.each([
    [
      'a custom bracket cuts one whose seat does not lead where the last place goes',
      { isWaterfall: true },
      'eliminate',
    ],
    ['Kings Valley still routes by rank', { isKingsValley: true }, 'rank'],
    ['a winners round still drops it', { bracket: 'winners' as const, isWaterfall: true }, 'drop'],
  ])('%s', (_label, round, fate) => {
    expect(absenteeFate(round, true)).toBe(fate);
  });

  it('a custom bracket room of 8, 5 absent: the first absentee is red, the others read the second band’s colour', () => {
    const topFourThenLower: RoomExitBand[] = [
      { kind: 'advance', fromRank: 1, toRank: 4, destination: 5 },
      { kind: 'advance', fromRank: 5, toRank: 8, destination: 6, group: 1 },
    ];
    const fateOf = (rank: number) =>
      rank === 4 ? absenteeFate({ isWaterfall: true }, true) : absenteeFate({ isWaterfall: true });
    expect(row({ bands: topFourThenLower, rank: 4, absentee: fateOf(4) }).result).toBe('eliminate');
    for (const rank of [5, 6, 7, 8]) {
      expect(row({ bands: topFourThenLower, rank, absentee: fateOf(rank) }).result).toBe('advance-second');
    }
  });

  it('is cut in a cut round even where its rank would advance, and drops in a winners round', () => {
    expect(row({ bands, rank: 2, absentee: 'eliminate' }).result).toBe('eliminate');
    expect(row({ bands, rank: 2, absentee: 'drop' }).result).toBe('drop');
  });

  it('is routed by its rank when the round routes by rank', () => {
    expect(row({ bands, rank: 2, absentee: 'rank' }).result).toBe('advance');
    expect(row({ bands, rank: 7, absentee: 'rank' }).result).toBe('eliminate');
  });

  it('is undecided until the room is complete', () => {
    expect(row({ bands, rank: 7, absentee: 'eliminate', roomComplete: false }).result).toBe('undecided');
  });
});

/** The tournament played (rounds scored and advanced) up to the point where `roundIndex` is drawn. */
function drawnAt(start: TournamentState, roundIndex: number): TournamentState {
  let drawn = start;
  while (drawn.curRound < roundIndex) {
    const advanced = advanceTournamentRound(scoreCurrentRound(drawn, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach round ${roundIndex}`);
    drawn = advanced.state;
  }
  return drawn;
}

const roomsOf = (exitRule: RoundExitRule) => (exitRule.kind === 'per-room' ? exitRule.rooms : []);

describe('roomRowResult: one colour per destination in every room of a Custom bracket round', () => {
  const spreadsheet = WATERFALL_EXAMPLES.find((entry) => entry.id === 'spreadsheet-32')?.text ?? '';
  const state = buildQualWaterfall(32, spreadsheet, { poolingPhase: 'none' });
  const roundIndex = state.rounds.findIndex((round) => round.customLabel === 'R5');
  const rule = roundExitRule(state, roundIndex);
  const rooms = rule.kind === 'per-room' ? rule.rooms : [];
  const rowsOf = (roomBands: RoomExitBand[], ranks: number, absentee?: RoomRowInput['absentee']) =>
    Array.from({ length: ranks }, (_, index) => row({ bands: roomBands, rank: index + 1, absentee }).result);

  it('reads SemiA green and R6B and R6C yellow in all four rooms; rooms C and D show yellow and red', () => {
    const green = 'advance';
    const yellow = 'advance-second';
    expect(rooms.map((bands) => rowsOf(bands, 8))).toEqual([
      [green, green, green, green, yellow, yellow, yellow, yellow],
      [green, green, green, green, yellow, yellow, yellow, yellow],
      [yellow, yellow, yellow, yellow, 'eliminate', 'eliminate', 'eliminate', 'eliminate'],
      [yellow, yellow, yellow, yellow, 'eliminate', 'eliminate', 'eliminate', 'eliminate'],
    ]);
  });

  it('an absentee routed by its rank takes its rank’s colour', () => {
    expect(rowsOf(rooms[0], 8, 'rank')[4]).toBe('advance-second');
    expect(rowsOf(rooms[2], 8, 'rank')[0]).toBe('advance-second');
    expect(rowsOf(rooms[2], 8, 'rank')[6]).toBe('eliminate');
  });

  it('a removal that shrinks room A below rank 6 changes no colour of any remaining row', () => {
    const drawn = drawnAt(state, roundIndex);
    const before = roundExitRule(drawn, roundIndex);
    const roomAUnits = (drawn.assignments[roundIndex] ?? [])
      .filter((entry) => entry.room === 1)
      .map((entry) => entry.name);
    const shrunk = roomAUnits.slice(0, 3).reduce(removeRosterUnit, drawn);
    const after = roundExitRule(shrunk, roundIndex);
    expect(roomsOf(after)[0].at(-1)).toMatchObject({ toRank: 5 });
    const sizes = [5, 8, 8, 8];
    for (const index of [0, 1, 2, 3]) {
      expect(rowsOf(roomsOf(after)[index], sizes[index])).toEqual(
        rowsOf(roomsOf(before)[index], 8).slice(0, sizes[index]),
      );
    }
  });

  it('a removal that takes away the room holding the first reading of a destination changes no colour', () => {
    // Declared order reads P (group 0), Q (1) in room A, then R (2) in room B. Q is read first in room A's ranks 7-8,
    // so a colour worked out from the seats left would give R group 1 and Q group 2.
    const graph = `
ROUNDS:
R1 = 4x8
P = 6
Q = 8
R = 6
Final = 8 FINAL

ROUTES:
R1.A: 1-6->P, 7-8->Q
R1.B: 1-6->R, 7-8->eliminated
R1.C: 1-3->Q, 4-8->eliminated
R1.D: 1-3->Q, 4-8->eliminated
P: 1-3->Final, 4-6->eliminated
Q: 1-3->Final, 4-8->eliminated
R: 1-2->Final, 3-6->eliminated
`;
    const start = buildQualWaterfall(32, graph, { poolingPhase: 'none' });
    const first = start.rounds.findIndex((round) => round.customLabel === 'R1');
    const drawn = drawnAt(start, first);
    const before = roomsOf(roundExitRule(drawn, first));
    const roomAUnits = (drawn.assignments[first] ?? [])
      .filter((entry) => entry.room === 1)
      .map((entry) => entry.name);
    const shrunk = roomAUnits.slice(0, 2).reduce(removeRosterUnit, drawn);
    const after = roomsOf(roundExitRule(shrunk, first));
    expect(after[0].at(-1)).toMatchObject({ toRank: 6 });
    const colours = (rooms: RoomExitBand[][], index: number, ranks: number) => rowsOf(rooms[index], ranks);
    expect(colours(before, 1, 8).slice(0, 6)).toEqual(Array(6).fill('advance-third'));
    expect(colours(before, 2, 8).slice(0, 3)).toEqual(Array(3).fill('advance-second'));
    const sizes = [6, 8, 8, 8];
    for (const index of [0, 1, 2, 3]) {
      expect(colours(after, index, sizes[index])).toEqual(colours(before, index, 8).slice(0, sizes[index]));
    }
  });
});
