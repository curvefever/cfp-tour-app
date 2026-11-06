import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { moveUnitToRoom } from '../lineup-edit';
import { markBack } from '../likely-absentees';
import { clickConfirmationAndSeat, seatReturningUnit } from '../returning-unit';
import { recordRoomHistory, roomPairKey } from '../seeding';
import { createDefaultTournamentState } from '../state-defaults';
import type { RoundAssignment, TournamentRound, TournamentState } from '../types';
import { afterRound1 } from './absentee-bracket-fixture';
import { buildAssignments, buildRound, teamOf } from './test-fixtures';

/**
 * Round 1 plays in one room of every player, the `absent` of them answered absent; round 2 (in play, drawn, no score)
 * seats `rooms` as given. Version 3, rooms of 3 to 8.
 */
function drawn(
  rooms: string[][],
  absent: string[],
  roundTwo: Partial<TournamentRound> = {},
  patch: Partial<TournamentState> = {},
): TournamentState {
  const players = rooms.flat();
  const keyOf = (name: string) => `r0-rm1-p${players.indexOf(name)}`;
  const state = createDefaultTournamentState({
    players,
    gamemodeConfig: { absenceVersion: 3, roomSize: { min: 3, max: 8, ideal: 6 } },
    rounds: [
      buildRound({ roundNum: 1, rooms: [players.length], players: players.length, isNoElim: true }),
      buildRound({
        roundNum: 2,
        rooms: rooms.map((room) => room.length),
        players: players.length,
        isNoElim: true,
        ...roundTwo,
      }),
    ],
    assignments: [
      buildAssignments(players, [players.length]),
      rooms.flatMap((room, index) =>
        room.map((name): RoundAssignment => ({ name, room: index + 1, isLucky: false })),
      ),
    ],
    scores: Object.fromEntries(players.map((name) => [keyOf(name), absent.includes(name) ? 0 : 50])),
    started: true,
    curRound: 1,
    ...patch,
  });
  return answerAbsence({ ...state, curRound: 0 }, absent.map(keyOf), 'absent');
}

const roomOf = (state: TournamentState, name: string) =>
  state.assignments[1].find((entry) => entry.name === name)?.room;
/** The state with the unit waiting for a later round: it has no room in the round in play. */
const notSeated = (state: TournamentState, name: string): TournamentState => ({
  ...state,
  curRound: 1,
  assignments: [state.assignments[0], state.assignments[1].filter((entry) => entry.name !== name)],
});
const back = (state: TournamentState, name: string) => markBack({ ...state, curRound: 1 }, name);

describe('seatReturningUnit: the unit moves to the room expected to have the fewest players', () => {
  // Room 1 holds Ann and four more, room 2 holds Bea (still absent) and three more.
  const rooms = [
    ['Ann', 'P2', 'P3', 'P4', 'P5'],
    ['Bea', 'P7', 'P8', 'P9'],
  ];

  it('a room expected to be smaller (another likely absentee in it) takes the returning unit', () => {
    const state = back(drawn(rooms, ['Ann', 'Bea']), 'Ann');
    const result = seatReturningUnit(state, 'Ann');
    expect(result.outcome).toBe('moved');
    expect(result.room).toBe(2);
    expect(roomOf(result.state, 'Ann')).toBe(2);
  });

  it('rooms expected to be equal keep it where it is, also when that is not the first room', () => {
    const state = back(drawn([rooms[1], rooms[0]], ['Ann']), 'Ann');
    expect(seatReturningUnit(state, 'Ann')).toMatchObject({ outcome: 'stays', room: 2 });
  });

  it('rooms expected to be equal keep it where it is', () => {
    const state = back(drawn(rooms, ['Ann']), 'Ann');
    const result = seatReturningUnit(state, 'Ann');
    expect(result).toMatchObject({ outcome: 'stays', room: 1 });
    expect(result.state).toBe(state);
  });

  it('moves nobody else: every other unit keeps its room and its position, and the unit is marked as placed by hand', () => {
    const state = back(drawn(rooms, ['Ann', 'Bea']), 'Ann');
    const after = seatReturningUnit(state, 'Ann').state;
    const others = (lineUp: RoundAssignment[]) =>
      lineUp.filter((entry) => entry.name !== 'Ann').map(({ name, room }) => [name, room]);
    expect(others(after.assignments[1])).toEqual(others(state.assignments[1]));
    expect(after.assignments[1].find((entry) => entry.name === 'Ann')?.manual).toBe(true);
    expect(after.rounds[1].rooms).toEqual([4, 5]);
  });

  it('the room history follows: Ann meets room 2 in round 2 now, and room 1 no longer', () => {
    const state = back(drawn(rooms, ['Ann', 'Bea']), 'Ann');
    const before = { ...state, roomHistory: recordRoomHistory({}, state.assignments[1], 1) };
    const after = seatReturningUnit(before, 'Ann').state;
    expect(after.roomHistory[roomPairKey('Ann', 'P8')]).toBe(1);
    // Ann and P3 shared the one room of round 1: that is their latest meeting again, not round 2.
    expect(after.roomHistory[roomPairKey('Ann', 'P3')]).toBe(0);
  });

  it('with several rooms equally small, the room it has not met goes first', () => {
    const three = [
      ['Ann', 'P2', 'P3', 'P4', 'P5'],
      ['Bea', 'P7', 'P8', 'P9'],
      ['Cy', 'P11', 'P12', 'P13'],
    ];
    const state = back(drawn(three, ['Ann', 'Bea', 'Cy']), 'Ann');
    const met = { ...state, roomHistory: { [roomPairKey('Ann', 'P7')]: 0, [roomPairKey('Ann', 'P11')]: -1 } };
    expect(seatReturningUnit(met, 'Ann')).toMatchObject({ outcome: 'moved', room: 3 });
  });
});

describe('seatReturningUnit: where it may not move', () => {
  const rooms = [
    ['Ann', 'P2', 'P3', 'P4', 'P5'],
    ['Bea', 'P7', 'P8', 'P9'],
  ];

  it('a room with a score is never used', () => {
    const scored = drawn(rooms, ['Ann', 'Bea'], {}, { scores: { 'r1-rm2-p1': 20 } });
    const state = back({ ...scored, scores: { ...scored.scores, 'r1-rm2-p1': 20 } }, 'Ann');
    expect(seatReturningUnit(state, 'Ann')).toMatchObject({ outcome: 'stays', room: 1 });
  });

  it('a unit whose own room has a score stays there', () => {
    const base = drawn(rooms, ['Ann', 'Bea']);
    const state = back({ ...base, scores: { ...base.scores, 'r1-rm1-p1': 20 } }, 'Ann');
    expect(seatReturningUnit(state, 'Ann')).toMatchObject({ outcome: 'scored', room: 1 });
  });

  it('a room at the format’s largest size is not used, though it is expected to be the smallest', () => {
    const full = [
      ['Ann', 'P2', 'P3', 'P4'],
      ['Bea', 'Cy', 'P7', 'P8'],
    ];
    const base = drawn(full, ['Ann', 'Bea', 'Cy']);
    const state = back(
      { ...base, gamemodeConfig: { ...base.gamemodeConfig, roomSize: { min: 3, max: 4, ideal: 4 } } },
      'Ann',
    );
    expect(seatReturningUnit(state, 'Ann')).toMatchObject({ outcome: 'stays', room: 1 });
    const roomy = back(drawn(full, ['Ann', 'Bea', 'Cy']), 'Ann');
    expect(seatReturningUnit(roomy, 'Ann')).toMatchObject({ outcome: 'moved', room: 2 });
  });

  it('a room already at the format’s smallest size cannot lose the unit, though another room is expected to be smaller', () => {
    const small = [
      ['Ann', 'P2', 'P3', 'P4'],
      ['Bea', 'Cy', 'Dee', 'P8', 'P9'],
    ];
    const base = drawn(small, ['Ann', 'Bea', 'Cy', 'Dee']);
    const state = back(
      { ...base, gamemodeConfig: { ...base.gamemodeConfig, roomSize: { min: 4, max: 8, ideal: 6 } } },
      'Ann',
    );
    expect(seatReturningUnit(state, 'Ann')).toMatchObject({ outcome: 'stays', room: 1 });
    expect(seatReturningUnit(back(drawn(small, ['Ann', 'Bea', 'Cy', 'Dee']), 'Ann'), 'Ann').outcome).toBe(
      'moved',
    );
  });

  it('rooms of 2 keep today’s draw', () => {
    const pairs = [
      ['Ann', 'P2'],
      ['Bea', 'P4'],
    ];
    expect(seatReturningUnit(back(drawn(pairs, ['Ann', 'Bea']), 'Ann'), 'Ann').outcome).toBe('stays');
  });

  it('a unit not drawn into a round yet has no room to move from', () => {
    const state = back(drawn(rooms, ['Ann', 'Bea']), 'Ann');
    const undrawn = notSeated(state, 'Ann');
    const result = seatReturningUnit(undrawn, 'Ann');
    expect(result).toMatchObject({ outcome: 'undrawn', room: null });
    expect(result.state).toBe(undrawn);
  });

  it('a double elimination round keeps its draw', () => {
    const state = back(drawn(rooms, ['Ann', 'Bea'], { bracket: 'winners' }), 'Ann');
    expect(seatReturningUnit(state, 'Ann').outcome).toBe('stays');
  });
});

describe('seatReturningUnit: the other rooms keep their scores and decisions', () => {
  it('only the two rooms of the move lose their answers and tie decisions', () => {
    const three = [
      ['Ann', 'P2', 'P3', 'P4', 'P5'],
      ['Bea', 'P7', 'P8', 'P9'],
      ['P11', 'P12', 'P13', 'P14'],
    ];
    const base = drawn(three, ['Ann', 'Bea']);
    const state = back(
      {
        ...base,
        scores: { ...base.scores, 'r1-rm3-p0': 0, 'r1-rm3-p1': 40 },
        absences: { ...base.absences, 'r1-rm3-p0': 'played' as const },
        tieResolutions: { 'r1-rm3-s1-t5': 'P11', 'r1-rm2-s1-t5': 'P8' },
      },
      'Ann',
    );
    const after = seatReturningUnit(state, 'Ann').state;
    expect(roomOf(after, 'Ann')).toBe(2);
    expect(after.scores['r1-rm3-p1']).toBe(40);
    expect(after.absences['r1-rm3-p0']).toBe('played');
    expect(after.tieResolutions).toEqual({ 'r1-rm3-s1-t5': 'P11' });
  });
});

describe('seatReturningUnit in a Custom bracket round', () => {
  const routes = [1, 1, 1, 1, 'eliminated', 'eliminated', 'eliminated', 'eliminated'] as const;
  const secondRoom = [1, 1, 1, 1, 1, 1, 1, 'eliminated'] as const;
  const bracket = (rooms: string[][], declared: number[]) =>
    drawn(rooms, ['Ann', 'Bea'], {
      isWaterfall: true,
      isNoElim: false,
      waterfallRoutes: [[...routes], [...secondRoom]],
      declaredRooms: declared,
      advTotal: 10,
    });

  it('moves into a room that is below its declared size, and the round’s advancement follows the new room sizes', () => {
    const rooms = [
      ['Ann', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
      ['Bea', 'P9', 'P10', 'P11', 'P12', 'P13'],
    ];
    const result = seatReturningUnit(back(bracket(rooms, [8, 8]), 'Ann'), 'Ann');
    expect(result).toMatchObject({ outcome: 'moved', room: 2 });
    expect(result.state.rounds[1].rooms).toEqual([6, 7]);
    // Room 1 sends its top 4, room 2 its top 7: [7, 6] sent 10 on, [6, 7] sends 11.
    expect(result.state.rounds[1].advTotal).toBe(11);
  });

  it('never above the declared size of a room', () => {
    const rooms = [
      ['Ann', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
      ['Bea', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15'],
    ];
    expect(seatReturningUnit(back(bracket(rooms, [8, 8]), 'Ann'), 'Ann')).toMatchObject({
      outcome: 'stays',
      room: 1,
    });
  });

  it('finds the unit in the round of the column in play that holds it, not only the current round', () => {
    const rooms = [
      ['Ann', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'],
      ['Bea', 'P9', 'P10', 'P11', 'P12', 'P13'],
    ];
    const state = bracket(rooms, [8, 8]);
    // Round 2 and a side round of the same column are played together; Ann sits in the side round, the current one is another.
    const [main, side] = [
      { ...state.rounds[1], waterfallColumn: 2 },
      { ...state.rounds[1], waterfallColumn: 2 },
    ];
    const sideBySide: TournamentState = {
      ...state,
      curRound: 1,
      rounds: [state.rounds[0], main, side],
      assignments: [
        state.assignments[0],
        buildAssignments(['X1', 'X2', 'X3', 'X4', 'X5'], [3, 2]),
        state.assignments[1],
      ],
      scores: { ...state.scores },
    };
    const marked = back({ ...sideBySide, assignments: sideBySide.assignments }, 'Ann');
    const result = seatReturningUnit(marked, 'Ann');
    expect(result).toMatchObject({ outcome: 'moved', room: 2 });
    expect(result.state.assignments[2].find((entry) => entry.name === 'Ann')?.room).toBe(2);
    expect(result.state.assignments[1].map((entry) => entry.room)).toEqual(
      sideBySide.assignments[1].map((entry) => entry.room),
    );
  });
});

describe('a team is moved as one unit', () => {
  it('the team of the member marked back moves to the room expected to be smaller', () => {
    const red = teamOf('Red', ['a', 'b']);
    const players = ['Red', 'T2', 'T3', 'T4', 'T5', 'Blue', 'T7', 'T8', 'T9'];
    const base = drawn(
      [
        ['Red', 'T2', 'T3', 'T4', 'T5'],
        ['Blue', 'T7', 'T8', 'T9'],
      ],
      ['Red', 'Blue'],
    );
    const teams = players.map((id) => (id === 'Red' ? red : teamOf(id, [`${id}a`, `${id}b`])));
    const state = markBack(
      {
        ...base,
        gameFormat: 'team-2v2v2v2',
        players: teams,
        gamemodeConfig: { ...base.gamemodeConfig, teamScoringRule: ONE_SCORE_PER_TEAM },
        curRound: 1,
      },
      'b',
    );
    expect(seatReturningUnit(state, 'b')).toMatchObject({ outcome: 'moved', room: 2 });
  });
});

describe('clickConfirmationAndSeat', () => {
  const rooms = [
    ['Ann', 'P2', 'P3', 'P4', 'P5'],
    ['Bea', 'P7', 'P8', 'P9'],
  ];

  it('says where the unit went, by room letter', () => {
    const result = clickConfirmationAndSeat({ ...drawn(rooms, ['Ann', 'Bea']), curRound: 1 }, 'Ann');
    expect(result.notice).toBe('Ann is back: moved to Room B.');
    expect(roomOf(result.state, 'Ann')).toBe(2);
    expect(result.state.backFromAbsence).toEqual({ Ann: 0 });
  });

  it('says it stays when the rooms are equal, and why when its room has scores', () => {
    const equal = clickConfirmationAndSeat({ ...drawn(rooms, ['Ann']), curRound: 1 }, 'Ann');
    expect(equal.notice).toBe('Ann is back and stays in Room A.');
    const base = drawn(rooms, ['Ann']);
    const scored = clickConfirmationAndSeat(
      { ...base, curRound: 1, scores: { ...base.scores, 'r1-rm1-p1': 20 } },
      'Ann',
    );
    expect(scored.notice).toBe('Ann is back. Room A already has scores, so Ann stays there.');
  });

  it('says nothing before the draw, nor for a click that does not mark a unit back', () => {
    const state = drawn(rooms, ['Ann', 'Bea']);
    expect(clickConfirmationAndSeat(notSeated(state, 'Ann'), 'Ann').notice).toBeNull();
    expect(clickConfirmationAndSeat({ ...state, curRound: 1 }, 'P2').notice).toBeNull();
  });

  it('says nothing when the absence is of the round in play itself: there was no draw to move in', () => {
    const state = drawn(rooms, ['Ann', 'Bea']);
    const inRoundOne = {
      ...state,
      curRound: 0,
      assignments: [state.assignments[0], []],
    };
    const result = clickConfirmationAndSeat(inRoundOne, 'Ann');
    expect(result.notice).toBeNull();
    expect(result.state.backFromAbsence).toEqual({ Ann: 0 });
  });
});

describe('a generated tournament of 31 with six units absent from round 1', () => {
  const state = afterRound1(
    [1, 2].flatMap((room) => [0, 1, 2].map((position) => [room, position] as [number, number])),
    3,
  );
  const lineUp = (room: number) =>
    state.assignments[1].filter((entry) => entry.room === room).map((e) => e.name);
  const absentSeats = [1, 2].flatMap((room) =>
    [0, 1, 2].map((position) => state.assignments[0].filter((entry) => entry.room === room)[position].name),
  );
  const absentIn = (room: number) => lineUp(room).filter((name) => absentSeats.includes(name));

  it('an absentee of a full room moves to the room of 7, the only room under the largest size', () => {
    const sevenRoom = state.rounds[1].rooms.indexOf(7) + 1;
    const fullWithOne = [1, 2, 3, 4].find((room) => room !== sevenRoom && absentIn(room).length === 1);
    if (fullWithOne === undefined) throw new Error('no room of 8 with one absentee');
    const name = absentIn(fullWithOne)[0];
    const result = clickConfirmationAndSeat(state, name);
    expect(result.notice).toBe(`${name} is back: moved to Room ${'ABCD'[sevenRoom - 1]}.`);
    expect(result.state.rounds[1].rooms[sevenRoom - 1]).toBe(8);
    expect(result.state.rounds[1].rooms[fullWithOne - 1]).toBe(7);
  });
});

describe('moveUnitToRoom refuses what would disturb a played room', () => {
  const rooms = [
    ['Ann', 'P2', 'P3', 'P4', 'P5'],
    ['Bea', 'P7', 'P8', 'P9'],
  ];
  const base = drawn(rooms, ['Ann', 'Bea']);

  it('moves one unit when both rooms are unscored', () => {
    const moved = moveUnitToRoom(base, 1, 'P2', 2);
    expect(moved.ok && moved.state.rounds[1].rooms).toEqual([4, 5]);
  });

  it('a score in the unit’s own room, or in the room it would join, refuses the move', () => {
    const ownScored = { ...base, scores: { ...base.scores, 'r1-rm1-p0': 10 } };
    expect(moveUnitToRoom(ownScored, 1, 'P2', 2)).toEqual({ ok: false, error: 'Room 1 already has scores.' });
    const targetScored = { ...base, scores: { ...base.scores, 'r1-rm2-p0': 10 } };
    expect(moveUnitToRoom(targetScored, 1, 'P2', 2)).toEqual({
      ok: false,
      error: 'Room 2 already has scores.',
    });
  });

  it('refuses the room it is in, a room that is not there and a unit without a room', () => {
    expect(moveUnitToRoom(base, 1, 'P2', 1).ok).toBe(false);
    expect(moveUnitToRoom(base, 1, 'P2', 3).ok).toBe(false);
    expect(moveUnitToRoom(base, 1, 'Nobody', 2).ok).toBe(false);
  });
});
