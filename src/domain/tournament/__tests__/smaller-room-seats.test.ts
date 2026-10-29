import { describe, expect, it } from 'vitest';
import {
  NO_POINTS_SEAT_WEIGHT,
  countSmallerRoomSeats,
  smallerRoomSeatWeight,
  smallerRoomSeatsBefore,
  splitForSmallerRooms,
  spreadsSmallerRoomSeats,
} from '../smaller-room-seats';
import type { RoundAssignment, TournamentRound, TournamentState } from '../types';
import {
  JOINER,
  addLateJoiner,
  advanceScored,
  playToRound,
  roomsOf,
  spreadConfig,
  startSpread,
  type Places,
  type SpreadKind,
} from './spread-play';

const repeat = (size: number, times: number) => Array.from({ length: times }, () => size);

function members(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    name: `U${index}`,
    tierRank: Math.floor(index / 5),
  }));
}

function lineUp(rooms: string[][]): RoundAssignment[] {
  return rooms.flatMap((names, index) => names.map((name) => ({ name, room: index + 1 })));
}

describe('countSmallerRoomSeats', () => {
  it('weighs each line-up by its own weight, 1 where none is given', () => {
    const first = lineUp([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    const second = lineUp([
      ['a', 'd'],
      ['b', 'c', 'e'],
    ]);
    expect(countSmallerRoomSeats([first, second], [0.5])).toEqual({ d: 1.5, e: 0.5, a: 1 });
  });

  it('counts a seat in any room below the largest room of that line-up, per round', () => {
    const first = lineUp([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    const second = lineUp([
      ['a', 'd'],
      ['b', 'c', 'e'],
    ]);
    expect(countSmallerRoomSeats([first, second])).toEqual({ d: 2, e: 1, a: 1 });
  });

  it('skips byes and counts nothing when every room is the same size', () => {
    const even = [
      ...lineUp([
        ['a', 'b'],
        ['c', 'd'],
      ]),
      { name: 'e', room: null },
    ];
    expect(countSmallerRoomSeats([even])).toEqual({});
  });

  it('gives the units present in a room with absentees a smaller-room seat, and the absentees none', () => {
    const level = lineUp([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h'],
    ]);
    expect(countSmallerRoomSeats([level], [], [new Set(['c', 'd'])])).toEqual({ a: 1, b: 1 });
  });
});

describe('smallerRoomSeatsBefore', () => {
  it('weighs the seats of every spreading round before the round being drawn: 0.5 where no points are earned', () => {
    const uneven = lineUp([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
    const state = {
      rounds: [
        { isQual: true, isNoElim: true, excludeFromStandings: true },
        { isQual: true, isNoElim: true },
        { isNoElim: true },
        { isNoElim: false },
        { isSemis: true, isNoElim: false },
        { isQual: true, isNoElim: true },
      ],
      assignments: [uneven, uneven, uneven, uneven, uneven, uneven],
      gamemodeConfig: {},
    } as unknown as TournamentState;
    // Uncounted round 0 and warm-up 2 weigh 0.5 each, counted round 1 and elimination round 3 weigh 1; the Semis
    // keep their own draw and add nothing; round 5 is the one being drawn.
    expect(smallerRoomSeatsBefore(state, 5)).toEqual({ d: 3, e: 3 });
    expect(smallerRoomSeatsBefore(state, 1)).toEqual({ d: 0.5, e: 0.5 });
    expect(smallerRoomSeatsBefore(state, 0)).toEqual({});
  });
});

describe('which rounds spread their smaller-room seats, and what a seat weighs', () => {
  const round = (flags: Partial<TournamentRound>) => flags as TournamentRound;

  it.each<[string, Partial<TournamentRound>, boolean]>([
    ['a warm-up', { isNoElim: true }, true],
    ['a counted qualification round', { isQual: true, isNoElim: true }, true],
    ['an uncounted qualification round', { isQual: true, isNoElim: true, excludeFromStandings: true }, true],
    ['a Swiss round', { isSwiss: true, isNoElim: true }, true],
    ['an ordinary elimination round', { isNoElim: false }, true],
    ['a group-stage round', { isGroupStage: true, isNoElim: true }, false],
    ['a Semis round', { isSemis: true }, false],
    ['the Final', { isFinal: true }, false],
    ['a waterfall round', { isWaterfall: true }, false],
    ['a Kings Valley round', { isKingsValley: true }, false],
    ['a double-elimination round', { bracket: 'winners' }, false],
  ])('%s: spreads %s', (_name, flags, spreads) => {
    expect(spreadsSmallerRoomSeats(round(flags))).toBe(spreads);
  });

  it.each<[string, Partial<TournamentRound>, number]>([
    ['a warm-up', { isNoElim: true }, NO_POINTS_SEAT_WEIGHT],
    ['an uncounted qualification round', { isQual: true, isNoElim: true, excludeFromStandings: true }, 0.5],
    ['a counted qualification round', { isQual: true, isNoElim: true }, 1],
    ['an elimination round', { isNoElim: false }, 1],
  ])('%s weighs %s', (_name, flags, weight) => {
    expect(smallerRoomSeatWeight(round(flags))).toBe(weight);
  });
});

describe('splitForSmallerRooms', () => {
  const sizes25 = [4, 4, 4, 4, 3, 3, 3];
  const names = (group: Array<{ name: string }> | undefined) => group?.map((member) => member.name);

  it('does not split when every room is the same size', () => {
    expect(splitForSmallerRooms(members(24), [4, 4, 4, 4, 4, 4], {}, new Set())).toBeNull();
  });

  it('strides the picks over the order when everyone is level: 9 seats among 25 candidates', () => {
    const split = splitForSmallerRooms(members(25), sizes25, {}, new Set());
    expect(split?.smallRooms).toEqual([5, 6, 7]);
    expect(names(split?.small)).toEqual([1, 4, 6, 9, 12, 15, 18, 20, 23].map((index) => `U${index}`));
    expect(split?.large).toHaveLength(16);
  });

  it('keeps both groups in the order given', () => {
    const split = splitForSmallerRooms(members(25), sizes25, {}, new Set());
    for (const group of [split?.small ?? [], split?.large ?? []]) {
      const indices = group.map((member) => Number(member.name.slice(1)));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it('seats the units with the fewest smaller-room seats first, striding only among the tied ones', () => {
    const seats = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`U${index}`, 1]));
    const split = splitForSmallerRooms(members(25), sizes25, seats, new Set());
    // U10..U24 have none: 9 of those 15 are picked, evenly.
    expect(names(split?.small)).toEqual([10, 12, 14, 15, 17, 19, 20, 22, 24].map((index) => `U${index}`));
  });

  it('takes everyone below the boundary count in and strides the rest', () => {
    const seats = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`U${index}`, 1]));
    const split = splitForSmallerRooms(members(25), sizes25, seats, new Set());
    // U21..U24 have none and are all in; 5 of the 21 others fill the rest.
    expect(names(split?.small)).toEqual(['U2', 'U6', 'U10', 'U14', 'U18', 'U21', 'U22', 'U23', 'U24']);
  });

  it('puts a late joiner after every other unit, whatever its count', () => {
    const order = [...members(25), { name: 'Joiner', tierRank: 2 }];
    const split = splitForSmallerRooms(order, [7, 6, 6, 6], {}, new Set(['Joiner']));
    expect(split?.small).toHaveLength(18);
    expect(names(split?.small)).not.toContain('Joiner');
  });

  it('seats a late joiner in a smaller room only when every other unit already has one', () => {
    const level = splitForSmallerRooms(members(4), [3, 2, 2], {}, new Set(['U1']));
    expect(names(level?.small)?.sort()).toEqual(['U0', 'U1', 'U2', 'U3']);
    const crowded = splitForSmallerRooms(members(5), [3, 2, 2], {}, new Set(['U1']));
    expect(names(crowded?.small)).not.toContain('U1');
  });
});

describe('the spread of smaller-room seats over the counted pooling rounds', () => {
  const SHAPES: Array<[SpreadKind, number, number[]]> = [
    ['2v2v2v2', 25, [...repeat(4, 4), ...repeat(3, 3)]],
    ['2v2v2v2', 37, [...repeat(4, 7), ...repeat(3, 3)]],
    ['2v2v2v2', 53, [...repeat(4, 11), ...repeat(3, 3)]],
    ['ffa', 37, [8, 8, 7, 7, 7]],
    ['ffa', 43, [8, ...repeat(7, 5)]],
    ['ffa', 25, [7, 6, 6, 6]],
    ['3v3v3', 31, [...repeat(3, 9), 2, 2]],
  ];

  /** The line-ups of rounds 1-3 (the counted ones), drawn as a fixed schedule or played out. */
  function countedLineUps(state: TournamentState, fixed: boolean): RoundAssignment[][] {
    const played = fixed ? state : playToRound(state, 3).state;
    return [1, 2, 3].map((index) =>
      fixed ? (played.rounds[index].fixedRoomAssignments ?? []) : played.assignments[index],
    );
  }

  function countsOf(state: TournamentState, fixed: boolean): number[] {
    const counts = countSmallerRoomSeats(countedLineUps(state, fixed));
    return state.assignments[0].map((entry) => counts[entry.name] ?? 0);
  }

  function startOf(kind: SpreadKind, count: number, fixed: boolean): TournamentState {
    const state = startSpread(spreadConfig(kind, count, { fixed }));
    return fixed
      ? { ...state, assignments: [state.rounds[0].fixedRoomAssignments ?? [], ...state.assignments.slice(1)] }
      : state;
  }

  describe.each([false, true])('fixed draw: %s', (fixed) => {
    it.each(SHAPES)('%s at %i: seat counts differ by at most 1', (kind, count, shape) => {
      const state = startOf(kind, count, fixed);
      expect(state.rounds[1].rooms).toEqual(shape);
      const spread = countsOf(state, fixed);
      expect(Math.max(...spread) - Math.min(...spread)).toBeLessThanOrEqual(1);
    });

    it('2v2v2v2 at 25: every team has a smaller room at least once and at most two have it twice', () => {
      const counts = countsOf(startOf('2v2v2v2', 25, fixed), fixed);
      expect(counts.filter((value) => value === 0)).toHaveLength(0);
      expect(counts.filter((value) => value === 2).length).toBeLessThanOrEqual(2);
    });
  });

  describe('adaptive draws follow the results', () => {
    function smallRoomsOf(state: TournamentState, roundIndex: number): Set<number> {
      const rooms = state.rounds[roundIndex].rooms;
      const largest = Math.max(...rooms);
      return new Set(rooms.flatMap((size, index) => (size < largest ? [index + 1] : [])));
    }

    function lastPlacers(places: Places, previous: RoundAssignment[]): string[] {
      const sizeOf = new Map<number, number>();
      for (const entry of previous) {
        if (entry.room !== null) sizeOf.set(entry.room, (sizeOf.get(entry.room) ?? 0) + 1);
      }
      return previous
        .filter((entry) => entry.room !== null && places[entry.name] === (sizeOf.get(entry.room) ?? 0) - 1)
        .map((entry) => entry.name);
    }

    it.each(SHAPES)(
      '%s at %i: units that finished last in their room still get smaller rooms',
      (kind, count) => {
        const { state, places } = playToRound(startSpread(spreadConfig(kind, count)), 3);
        for (const round of [1, 2, 3]) {
          const small = smallRoomsOf(state, round);
          const seatedSmall = new Set(
            state.assignments[round]
              .filter((entry) => small.has(entry.room as number))
              .map((entry) => entry.name),
          );
          const last = lastPlacers(places[round - 1], state.assignments[round - 1]);
          expect(last.filter((name) => seatedSmall.has(name)).length).toBeGreaterThan(0);
        }
      },
    );

    it.each(SHAPES)(
      '%s at %i: every smaller room of 3 or more seats mixes at least two tiers',
      (kind, count) => {
        const { state, places } = playToRound(startSpread(spreadConfig(kind, count)), 3);
        for (const round of [1, 2, 3]) {
          const rooms = roomsOf(state.assignments[round]);
          // A 2-seat room (3v3v3) can come out as two units of one tier: the balance term allows "1+1" next to "0+2".
          for (const room of smallRoomsOf(state, round)) {
            if (rooms[room - 1].length < 3) continue;
            const tiers = new Set(rooms[room - 1].map((name) => places[round - 1][name]));
            expect(tiers.size).toBeGreaterThanOrEqual(2);
          }
        }
      },
    );
  });
});

describe('rounds the spread does not touch are drawn as before', () => {
  it('a counted round whose rooms are all one size (12 teams, 3 rooms of 4)', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 12)), 3);
    expect(state.assignments.slice(1).map(roomsOf)).toEqual([
      [
        ['t12', 't3', 't5', 't1'],
        ['t7', 't10', 't2', 't8'],
        ['t4', 't6', 't11', 't9'],
      ],
      [
        ['t8', 't1', 't6', 't12'],
        ['t5', 't4', 't2', 't10'],
        ['t9', 't7', 't3', 't11'],
      ],
      [
        ['t10', 't9', 't6', 't1'],
        ['t11', 't8', 't4', 't3'],
        ['t12', 't5', 't7', 't2'],
      ],
    ]);
  });
});

describe('rounds that earn no points spread their smaller-room seats too (11 teams, rooms of 4, 4 and 3)', () => {
  const smallRoom = (state: TournamentState, roundIndex: number) => roomsOf(state.assignments[roundIndex])[2];

  it('a round that does not count toward the standings', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 11, { nonCounting: 2 })), 1);
    expect(smallRoom(state, 0)).toEqual(['t9', 't10', 't11']);
    expect(roomsOf(state.assignments[1])).toEqual([
      ['t10', 't6', 't3', 't8'],
      ['t7', 't11', 't2', 't9'],
      ['t4', 't5', 't1'],
    ]);
  });

  it('a warm-up with no pooling phase', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 11, { pooling: 'none' })), 1);
    expect(smallRoom(state, 0)).toEqual(['t9', 't10', 't11']);
    expect(smallRoom(state, 1)).toEqual(['t4', 't5', 't1']);
  });
});

describe('a late joiner gets no smaller-room advantage', () => {
  it.each<[SpreadKind, number]>([
    ['2v2v2v2', 25],
    ['ffa', 37],
  ])(
    '%s at %i + 1: seated in a larger room the round they enter, level with the others at the end',
    (kind, count) => {
      const atRound2 = playToRound(startSpread(spreadConfig(kind, count)), 1).state;
      const afterRound2 = advanceScored(addLateJoiner(atRound2)).state;
      const sizes = roomsOf(afterRound2.assignments[2]).map((room) => room.length);
      const entry = afterRound2.assignments[2].find((seat) => seat.name === JOINER);
      expect(entry?.room).toBeTruthy();
      expect(sizes[(entry?.room as number) - 1]).toBe(Math.max(...sizes));

      // From the next round on their real count applies, like everyone's.
      const final = playToRound(afterRound2, 3).state;
      const counts = countSmallerRoomSeats([1, 2, 3].map((index) => final.assignments[index]));
      const spread = final.assignments[2].map((seat) => counts[seat.name] ?? 0);
      expect(final.assignments[2].map((seat) => seat.name)).toContain(JOINER);
      expect(Math.max(...spread) - Math.min(...spread)).toBeLessThanOrEqual(1);
    },
  );
});
