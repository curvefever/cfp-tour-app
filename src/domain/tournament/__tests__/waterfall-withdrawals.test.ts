import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentRound, TournamentState } from '../types';
import { fitWaterfallRound } from '../waterfall-bracket';
import { playWithRemovals, scoreCurrentRound } from './play-through';
import { buildQualWaterfall, playToQualificationExit, playerNames } from './qual-waterfall';
import { fixedIdSource } from './test-fixtures';

/** The graph's bottom bands route on: R1's ranks 5-8 go to R3 instead of out. */
const BOTTOM_ROUTES_ON = `
ROUNDS:
R1 = 2x8
R2 = 8
R3 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1
R1.A: 1-4->R2, 5-8->R3
R1.B: 1-4->R2, 5-8->R3
R2: 1-4->Final, 5-8->eliminated
R3: 1-4->Final, 5-8->eliminated
`;

/** R3 has two rooms of 7, fed by R1's bottom bands (8) and by Qual ranks 17-22 (6). */
const TWO_ROOM_DESTINATION = `
ROUNDS:
R1 = 2x8
R2 = 8
R3 = 2x7
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-22->R3
R1.A: 1-4->R2, 5-8->R3
R1.B: 1-4->R2, 5-8->R3
R2: 1-4->Final, 5-8->eliminated
R3.A: 1-2->Final, 3-7->eliminated
R3.B: 1-2->Final, 3-7->eliminated
`;

function indexOfRound(state: TournamentState, label: string): number {
  return state.rounds.findIndex((round) => round.customLabel === label);
}

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
  return result.state;
}

/** The unit in the room that currently holds the most units, so repeated picks land in different rooms. */
function fromFullestRoom(state: TournamentState): string | undefined {
  const seated = (state.assignments[state.curRound] ?? []).filter((entry) => entry.room !== null);
  const sizes = new Map<number, number>();
  for (const entry of seated) sizes.set(entry.room as number, (sizes.get(entry.room as number) ?? 0) + 1);
  const fullest = [...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return seated.find((entry) => entry.room === fullest)?.name;
}

/** Plays to the Final, removing `removals` units on arrival at R1. */
function playRemovingFromR1(start: TournamentState, removals: number) {
  const r1 = indexOfRound(start, 'R1');
  return playWithRemovals(
    start,
    0,
    Array.from({ length: removals }, () => r1),
    fromFullestRoom,
  );
}

function roomSizes(state: TournamentState, roundIndex: number): number[] {
  const rooms = state.assignments[roundIndex].filter((entry) => entry.room !== null);
  return [...new Set(rooms.map((entry) => entry.room))]
    .map((room) => rooms.filter((entry) => entry.room === room).length)
    .sort((a, b) => a - b);
}

function drawnRounds(state: TournamentState) {
  return state.rounds.filter((_, index) => (state.assignments[index]?.length ?? 0) > 0);
}

const sum = (sizes: number[]) => sizes.reduce((total, size) => total + size, 0);

describe.each([31, 37, 43, 53])('withdrawals in a running waterfall at %i registered', (registered) => {
  it('absorbs a seated withdrawal in the eliminated band: R1 sends 4 on from its short room, R2 is drawn full', () => {
    const played = playRemovingFromR1(buildQualWaterfall(registered), 1);
    expect(played.outcome).toEqual({ kind: 'ok' });
    const end = played.state;
    const r1 = indexOfRound(end, 'R1');
    expect(roomSizes(end, r1)).toEqual([7, 8]);
    const r2 = indexOfRound(end, 'R2');
    expect(end.rounds[r2]).toMatchObject({ rooms: [8], players: 8 });
    expect(end.rounds[r2].declaredRooms).toBeUndefined();
    expect(end.rounds[indexOfRound(end, 'R1C')]).toMatchObject({ rooms: [8], players: 8 });
  });

  it('draws the destination of a bottom band that routes on one seat short (7), and plays to the Final', () => {
    const played = playRemovingFromR1(buildQualWaterfall(registered, BOTTOM_ROUTES_ON), 1);
    expect(played.outcome).toEqual({ kind: 'ok' });
    const end = played.state;
    expect(end.rounds[indexOfRound(end, 'R3')]).toMatchObject({ rooms: [7], players: 7, declaredRooms: [8] });
    for (const round of drawnRounds(end)) expect(sum(round.rooms)).toBe(round.players);
    expect(end.assignments[indexOfRound(end, 'R3')]).toHaveLength(7);
  });

  it('draws it as one room of 6 after two seated withdrawals from different R1 rooms', () => {
    const played = playRemovingFromR1(buildQualWaterfall(registered, BOTTOM_ROUTES_ON), 2);
    expect(played.outcome).toEqual({ kind: 'ok' });
    const end = played.state;
    const r1 = indexOfRound(end, 'R1');
    expect(roomSizes(end, r1)).toEqual([7, 7]);
    expect(end.rounds[indexOfRound(end, 'R3')]).toMatchObject({ rooms: [6], players: 6 });
  });

  it.each([
    [0, [7, 7]],
    [1, [7, 6]],
    [2, [6, 6]],
  ])('a 2-room destination with %i withdrawals is drawn %j, never [7, 5]', (removals, rooms) => {
    const played = playRemovingFromR1(buildQualWaterfall(registered, TWO_ROOM_DESTINATION), removals);
    expect(played.outcome).toEqual({ kind: 'ok' });
    const index = indexOfRound(played.state, 'R3');
    expect(played.state.rounds[index].rooms).toEqual(rooms);
    expect(played.state.rounds[index].players).toBe(sum(rooms));
    expect(played.state.assignments[index]).toHaveLength(sum(rooms));
  });
});

describe('a waterfall round never accepts more than it declares', () => {
  it('blocks with "malformed-waterfall-round" when an extra unit is waiting for R1C', () => {
    const atR1 = advance(playToQualificationExit(buildQualWaterfall(37)));
    const r1c = indexOfRound(atR1, 'R1C');
    const extra = { name: 'Extra', tierRank: 0, pct: 1 };
    const pools = atR1.pendingBracketSeeds;
    const stuffed = { ...atR1, pendingBracketSeeds: { ...pools, [r1c]: [...pools[r1c], extra] } };
    const result = advanceTournamentRound(scoreCurrentRound(stuffed, 0));
    expect(result.status === 'blocked' && result.reason).toBe('malformed-waterfall-round');
    if (result.status === 'blocked') expect(result.message).toContain('9 entrant');
  });
});

describe('fitWaterfallRound', () => {
  const round = (rooms: number[], isFinal = false): TournamentRound => ({
    roundNum: 3,
    players: sum(rooms),
    rooms,
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal,
    advPerRoom: null,
    advTotal: isFinal ? 1 : sum(rooms),
    luckyCount: 0,
    isWaterfall: true,
    customLabel: 'R3',
    waterfallRoutes: rooms.map((size) => Array.from({ length: size }, () => 'eliminated' as const)),
  });

  it.each([
    [[8, 8], 16, [8, 8]],
    [[8, 8], 15, [8, 7]],
    [[8, 8], 14, [7, 7]],
    [[8, 8], 13, [7, 6]],
    [[7, 7, 7], 19, [7, 6, 6]],
    [[8, 8, 8], 1, [1]],
  ])(
    'seats %j with %i units as %j (missing seats come out of the last rooms first)',
    (declared, pool, expected) => {
      const fitted = fitWaterfallRound(round(declared), pool);
      expect(fitted).toMatchObject({ rooms: expected, players: pool });
    },
  );

  it('keeps the declared rooms while short and restores them when the full count arrives again', () => {
    const short = fitWaterfallRound(round([8, 8]), 14) as TournamentRound;
    expect(short.declaredRooms).toEqual([8, 8]);
    const full = fitWaterfallRound(short, 16) as TournamentRound;
    expect(full).toMatchObject({ rooms: [8, 8], players: 16 });
    expect(full.declaredRooms).toBeUndefined();
  });

  it('refuses a round nobody reaches and a Final with fewer than 2', () => {
    expect(fitWaterfallRound(round([8]), 0)).toHaveProperty('error');
    expect(fitWaterfallRound(round([8], true), 1)).toHaveProperty('error');
    expect(fitWaterfallRound(round([8], true), 2)).toMatchObject({ rooms: [2], players: 2 });
  });
});

describe('Swiss into a waterfall without a Qual source', () => {
  /** 16 head-to-head entry seats (8 rooms of 2), halving down to a 2-unit Final. */
  function entry16Graph(): string {
    const letters = 'ABCDEFGH'.split('');
    const routes = (label: string, rooms: string[]) =>
      rooms.map((room) => `${label}.${room}: 1->NEXT, 2->eliminated`);
    return [
      'ROUNDS:',
      'R1 = 8x2',
      'R2 = 4x2',
      'R3 = 2x2',
      'Final = 2 FINAL',
      '',
      'ROUTES:',
      ...routes('R1', letters).map((line) => line.replace('NEXT', 'R2')),
      ...routes('R2', letters.slice(0, 4)).map((line) => line.replace('NEXT', 'R3')),
      ...routes('R3', letters.slice(0, 2)).map((line) => line.replace('NEXT', 'Final')),
    ].join(String.fromCharCode(10));
  }

  function swissStart(registered: number): TournamentState {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: registered, players: playerNames(registered) }),
      createDefaultSetup({
        gameFormat: 'individual-1v1',
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'swiss',
        qualAdv: '16',
        oddCountStrategy: 'bye',
        waterfallGraph: entry16Graph(),
      }),
      createTournamentRuntime({ ids: fixedIdSource() }),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
    return { ...result.state, started: true };
  }

  it('draws the 16-seat entry round with 15 after withdrawals leave the Swiss field below the cut, instead of blocking', () => {
    const start = swissStart(17);
    const firstBracket = start.rounds.findIndex((round) => round.isWaterfall);
    expect(start.rounds.slice(0, firstBracket).some((round) => round.isSwiss)).toBe(true);
    const played = playWithRemovals(start, 0, [0, 0], fromFullestRoom);
    expect(played.outcome).toEqual({ kind: 'ok' });
    const entry = played.state.rounds[firstBracket];
    expect(entry).toMatchObject({ players: 15, declaredRooms: Array(8).fill(2) });
    expect(entry.rooms).toEqual([2, 2, 2, 2, 2, 2, 2, 1]);
    expect(played.state.assignments[firstBracket]).toHaveLength(15);
  });
});
