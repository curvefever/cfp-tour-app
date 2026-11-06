import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import {
  placeLikelyAbsentees,
  roomPairKey,
  seedFromPoolingExit,
  seedPoolByStanding,
  tieredBracketSeed,
} from '../seeding';
import { smallerRoomSeatsBefore } from '../smaller-room-seats';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { PendingBracketSeed, TournamentState } from '../types';
import { scoreCurrentRound } from './play-through';
import { buildRound, oneRoomState } from './test-fixtures';

const weights = { roomHistory: {}, targetRoundIndex: 1, diversityWeight: 0, balanceWeight: 0 };
const named = (count: number) => Array.from({ length: count }, (_, index) => `U${index + 1}`);
const tiered = (names: string[]) => names.map((name, index) => ({ name, tierRank: index }));
const perRoom = (placed: Array<{ room: number }>, rooms: number) =>
  Array.from({ length: rooms }, (_, index) => placed.filter(({ room }) => room === index + 1).length);

describe('placeLikelyAbsentees', () => {
  const place = (sizes: number[], absentees: string[], count = sizes.reduce((a, b) => a + b, 0)) =>
    placeLikelyAbsentees(tiered(named(count)), sizes, new Set(absentees), weights);

  it('the organiser’s example: 15 teams in 4, 4, 4, 3 with two absentees go to two different rooms of 4', () => {
    const { placed, seatsLeft } = place([4, 4, 4, 3], ['U5', 'U9']);
    expect(perRoom(placed, 4)).toEqual([1, 1, 0, 0]);
    expect(seatsLeft).toEqual([3, 3, 4, 3]);
  });

  it('31 players (8, 8, 8, 7), two absentees: two different rooms of 8', () => {
    const { placed } = place([8, 8, 8, 7], ['U3', 'U20']);
    expect(placed.map(({ room }) => room).sort()).toEqual([1, 2]);
  });

  it('37 players (8, 8, 7, 7, 7), three absentees: both 8s, then one 7', () => {
    const { placed } = place([8, 8, 7, 7, 7], ['U1', 'U2', 'U3']);
    expect(perRoom(placed, 5)).toEqual([1, 1, 1, 0, 0]);
  });

  it('43 players (8, 7, 7, 7, 7, 7), seven absentees: one in every room, the extra one in the room with most seats left', () => {
    const { placed } = place([8, 7, 7, 7, 7, 7], named(7));
    expect(perRoom(placed, 6)).toEqual([2, 1, 1, 1, 1, 1]);
  });

  it('53 players (8, 8, 8, 8, 7, 7, 7), eight absentees: one in every room, the extra one in a room of 8', () => {
    const counts = perRoom(place([8, 8, 8, 8, 7, 7, 7], named(8)).placed, 7);
    expect(counts.every((count) => count >= 1)).toBe(true);
    expect(counts.indexOf(2)).toBeLessThan(4);
  });

  it('never two in one room while another has fewer, even when the rooms differ by more than a seat', () => {
    expect(perRoom(place([8, 6], ['U1', 'U2']).placed, 2)).toEqual([1, 1]);
    expect(perRoom(place([8, 6], ['U1', 'U2', 'U3']).placed, 2)).toEqual([2, 1]);
  });

  it('places in tier order, and leaves the others in their order', () => {
    const { placed, rest } = place([4, 4], ['U6', 'U2']);
    expect(placed.map(({ name }) => name)).toEqual(['U2', 'U6']);
    expect(rest.map(({ name }) => name)).toEqual(['U1', 'U3', 'U4', 'U5', 'U7', 'U8']);
  });

  it('takes no more units than there are seats', () => {
    const { placed, seatsLeft, rest } = place([3, 3], named(7), 7);
    expect(placed).toHaveLength(6);
    expect(seatsLeft).toEqual([0, 0]);
    expect(rest.map(({ name }) => name)).toEqual(['U7']);
  });

  it('places nobody in rooms of 2 (head to head), or when nobody is likely absent', () => {
    expect(place([2, 2, 2], ['U1', 'U2']).placed).toEqual([]);
    expect(place([8, 8], []).placed).toEqual([]);
    expect(place([8, 8], ['Nobody']).placed).toEqual([]);
  });
});

describe('the draw of a round fed from a pool (tieredBracketSeed)', () => {
  const poolOf = (count: number): PendingBracketSeed[] =>
    named(count).map((name, index) => ({ name, isLucky: false, tierRank: index, pct: 1 }));
  const rounds = [buildRound({ roundNum: 1 }), buildRound({ roundNum: 2 })];
  const draw = (sizes: number[], count: number, options: object = {}) =>
    tieredBracketSeed({
      pool: poolOf(count),
      roomSizes: sizes,
      roomHistory: {},
      rounds,
      targetRoundIndex: 1,
      ...options,
    }).seeded;

  it('spreads the likely absentees and keeps every room’s size', () => {
    const seeded = draw([4, 4, 4, 3], 15, { likelyAbsent: new Set(['U13', 'U14']) });
    expect(perRoom(seeded as Array<{ room: number }>, 4)).toEqual([4, 4, 4, 3]);
    const rooms = ['U13', 'U14'].map((name) => seeded.find((entry) => entry.name === name)?.room);
    expect(new Set(rooms).size).toBe(2);
    expect(rooms.every((room) => room !== 4)).toBe(true);
  });

  it('draws the others as usual into the seats left, and returns the assignments in pool order', () => {
    const seeded = draw([4, 4], 8, { likelyAbsent: new Set(['U8']) });
    expect(seeded.map((entry) => entry.name)).toEqual(named(8));
    expect(seeded.find((entry) => entry.name === 'U8')?.room).toBe(1);
    expect(perRoom(seeded as Array<{ room: number }>, 2)).toEqual([4, 4]);
  });

  it('keeps rematch avoidance for the present units', () => {
    const roomHistory = { [roomPairKey('U1', 'U2')]: 0 };
    const seeded = draw([4, 4], 8, {
      roomHistory,
      seedingOverride: 'diversity',
      likelyAbsent: new Set(['U8']),
    });
    const room = (name: string) => seeded.find((entry) => entry.name === name)?.room;
    expect(room('U1')).not.toBe(room('U2'));
  });

  it('a "random" override also places the likely absentees first, one to a room', () => {
    const seeded = draw([4, 4, 4], 12, {
      seedingOverride: 'random',
      likelyAbsent: new Set(['U1', 'U2', 'U3']),
    });
    const rooms = ['U1', 'U2', 'U3'].map((name) => seeded.find((entry) => entry.name === name)?.room);
    expect(new Set(rooms).size).toBe(3);
    expect(perRoom(seeded as Array<{ room: number }>, 3)).toEqual([4, 4, 4]);
  });

  it('is the same draw without a likely absentee, and in rooms of 2', () => {
    expect(draw([4, 4, 4], 12, { likelyAbsent: new Set() })).toEqual(draw([4, 4, 4], 12));
    expect(draw([2, 2, 2], 6, { likelyAbsent: new Set(['U1', 'U2']) })).toEqual(draw([2, 2, 2], 6));
  });
});

describe('a Custom bracket round fed only by the Qual or Groups line (seedPoolByStanding)', () => {
  const pool: PendingBracketSeed[] = named(15).map((name, index) => ({
    name,
    isLucky: false,
    tierRank: index,
    pct: 1,
  }));
  const state = createDefaultTournamentState();
  const seed = (likelyAbsent?: Set<string>) =>
    seedPoolByStanding({ pool, roomSizes: [4, 4, 4, 3], state, targetRoundIndex: 3, likelyAbsent });

  it('places the likely absentees in different rooms of 4, then snakes the others over the seats left', () => {
    const seeded = seed(new Set(['U1', 'U2']));
    const room = (name: string) => seeded.find((entry) => entry.name === name)?.room;
    expect(room('U1')).not.toBe(room('U2'));
    expect(perRoom(seeded as Array<{ room: number }>, 4)).toEqual([4, 4, 4, 3]);
    expect(seeded.map((entry) => entry.name)).toEqual(named(15));
  });

  it('is the plain snake without a likely absentee', () => {
    expect(seed(new Set())).toEqual(seed());
    expect(seed()[0].room).toBe(1);
  });
});

/** A started FFA tournament of 31 (rooms 8, 8, 8, 7), round 1 scored with the given seats answered absent, advanced to round 2. */
function afterRound1(
  absentSeats: Array<[room: number, position: number]>,
  version: 2 | 3,
  count = 31,
): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({ gameFormat: 'ffa-individual' }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error('generation failed');
  const started: TournamentState = {
    ...result.state,
    started: true,
    gamemodeConfig: { ...result.state.gamemodeConfig, absenceVersion: version },
  };
  const keys = absentSeats.map(([room, position]) => `r0-rm${room}-p${position}`);
  const scored = scoreCurrentRound(started, 0);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  const advanced = advanceTournamentRound(answerAbsence(zeroed, keys, 'absent'));
  if (advanced.status !== 'advanced') throw new Error(`could not advance: ${advanced.status}`);
  return advanced.state;
}

const SIX_ABSENT: Array<[number, number]> = [1, 2].flatMap((room) =>
  [0, 1, 2].map((p) => [room, p] as [number, number]),
);

/** How many of the units absent from round 1 sit in each room of round 2. */
function absenteesPerRoom(state: TournamentState): number[] {
  const roomOf = (name: string) => state.assignments[1].find((entry) => entry.name === name)?.room;
  const absent = SIX_ABSENT.map(([room, position]) => {
    const seated = state.assignments[0].filter((entry) => entry.room === room);
    return roomOf(seated[position].name);
  });
  return state.rounds[1].rooms.map((_, index) => absent.filter((room) => room === index + 1).length);
}

describe('round 2 of a generated tournament of 31 with six units absent from round 1', () => {
  it('spreads them: one in the room of 7, the others two at most in a room of 8', () => {
    const state = afterRound1(SIX_ABSENT, 3);
    const sizes = state.rounds[1].rooms;
    expect(sizes).toEqual([8, 8, 8, 7]);
    const counts = absenteesPerRoom(state);
    expect(counts).toEqual([2, 2, 1, 1]);
  });

  it('a version 2 tournament is drawn as before, three of them landing in one room', () => {
    expect(Math.max(...absenteesPerRoom(afterRound1(SIX_ABSENT, 2)))).toBeGreaterThanOrEqual(3);
  });

  it('counts a room holding a likely absentee as the smaller room: units that already held a smaller room’s seat get the full rooms', () => {
    const state = afterRound1(
      [
        [1, 0],
        [1, 1],
      ],
      3,
      32,
    );
    expect(state.rounds[1].rooms).toEqual([8, 8, 8, 8]);
    const held = smallerRoomSeatsBefore(state, 1);
    const holders = Object.keys(held);
    expect(holders).toHaveLength(6);
    const roomOf = (name: string) => state.assignments[1].find((entry) => entry.name === name)?.room;
    const absentees = state.assignments[0].filter((entry) => entry.room === 1).slice(0, 2);
    const absentRooms = absentees.map((entry) => roomOf(entry.name));
    expect(new Set(absentRooms).size).toBe(2);
    expect(holders.map(roomOf).every((room) => !absentRooms.includes(room))).toBe(true);
  });
});

const BRACKET = `
ROUNDS:
R1 = 3x8
R2 = 3x8
Final = 6 FINAL

ROUTES:
R1.A: 1-8->R2
R1.B: 1-8->R2
R1.C: 1-8->R2
R2.A: 1-2->Final, 3-8->eliminated
R2.B: 1-2->Final, 3-8->eliminated
R2.C: 1-2->Final, 3-8->eliminated
`;

/** 24 FFA players in a Custom bracket of three rooms of 8 into three rooms of 8; the last four seats of R1's room A are absent; advanced to R2. */
function bracketAfterR1(version: 2 | 3): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: 24,
      players: Array.from({ length: 24 }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: BRACKET,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  let state: TournamentState = {
    ...result.state,
    started: true,
    gamemodeConfig: { ...result.state.gamemodeConfig, absenceVersion: version },
  };
  while (state.rounds[state.curRound].customLabel !== 'R1') {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach R1: ${advanced.status}`);
    state = advanced.state;
  }
  const keys = [4, 5, 6, 7].map((seat) => `r${state.curRound}-rm1-p${seat}`);
  const scored = scoreCurrentRound(state, 0);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  const advanced = advanceTournamentRound(answerAbsence(zeroed, keys, 'absent'));
  if (advanced.status !== 'advanced') throw new Error(`could not advance: ${advanced.status}`);
  return advanced.state;
}

describe('a Custom bracket round drawn from the units that came from other rounds', () => {
  const absenteesPerRoomOfR2 = (state: TournamentState) => {
    const r1 = state.rounds.findIndex((round) => round.customLabel === 'R1');
    const r2 = state.rounds.findIndex((round) => round.customLabel === 'R2');
    const absent = state.assignments[r1]
      .filter((entry) => entry.room === 1)
      .slice(4)
      .map((entry) => entry.name);
    return [1, 2, 3].map(
      (room) =>
        state.assignments[r2].filter((entry) => entry.room === room && absent.includes(entry.name)).length,
    );
  };

  it('spreads the four absentees of one room over the three rooms', () => {
    expect(absenteesPerRoomOfR2(bracketAfterR1(3))).toEqual([2, 1, 1]);
  });

  it('a version 2 tournament keeps its draw', () => {
    expect(absenteesPerRoomOfR2(bracketAfterR1(2))).toEqual([1, 1, 2]);
  });
});

describe('the first round after a pooling exit', () => {
  const exitState = (version: 2 | 3): TournamentState => {
    const state = oneRoomState({
      players: named(8),
      rounds: [{}, { rooms: [4, 4], players: 8 }],
      scores: Object.fromEntries(
        named(8).map((_, index) => [`r0-rm1-p${index}`, index === 0 || index === 7 ? 0 : 50 - index]),
      ),
    });
    const config = { ...state.gamemodeConfig, absenceVersion: version };
    return answerAbsence({ ...state, gamemodeConfig: config }, ['r0-rm1-p0', 'r0-rm1-p7'], 'absent');
  };
  const roomsOf = (version: 2 | 3) => {
    const advancing = named(8).map((name) => ({ name }));
    const seeded = seedFromPoolingExit({ state: exitState(version), roundIndex: 0, advancing });
    return ['U1', 'U8'].map((name) => seeded.find((entry) => entry.name === name)?.room);
  };

  it('places the units that were absent from the last qualification round in different rooms', () => {
    expect(new Set(roomsOf(3)).size).toBe(2);
  });

  it('a version 2 tournament keeps the plain snake: the first and last of the exit order share room 1', () => {
    expect(roomsOf(2)).toEqual([1, 1]);
  });
});
