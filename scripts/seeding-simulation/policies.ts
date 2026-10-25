import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { isCountedPoolingRound } from '../../src/domain/tournament/pooling';
import {
  assignWaveToRooms,
  recordRoomHistory,
  rewindRoomHistory,
  type WaveMember,
} from '../../src/domain/tournament/seeding';
import { smallerRoomSeatsBefore, splitForSmallerRooms } from '../../src/domain/tournament/smaller-room-seats';
import type { RoundAssignment, TournamentState } from '../../src/domain/tournament/types';
import { drawAroundCuts, profileOf, type Kind, type ProfileKey } from './cuts';
import { byeDraw, engineLikeDraw, stakeDraw } from './q-draws';
import { shuffled } from './random';

/**
 * The draws the tool tries in place of the engine's. After the engine has drawn round `next`, a policy may
 * return its own line-up for it (null keeps the engine's); `applyPolicy` swaps it in and keeps `roomHistory` right.
 */

export const POLICIES = [
  'current',
  'neutral-first',
  'last-by-standings',
  'neutral-first+last-by-standings',
  'standings-every-round',
  'random-rooms',
] as const;
/** Part 2: the last counted round drawn around the cuts of a stake profile, without and with the smaller-room spread. */
export const PART2_POLICIES = [
  'current',
  'last-by-standings',
  'cuts-P1',
  'cuts-P2',
  'cuts-P3',
  'cuts-spread-P1',
  'cuts-spread-P2',
  'cuts-spread-P3',
  'random-rooms',
] as const;
/** Shape Q's own draws: the engine's draw rebuilt without a change (a check), a neutral bye, seats by stake. */
export type QPolicy = 'engine-like' | 'QB' | 'QK';
export type Policy = (typeof POLICIES)[number] | (typeof PART2_POLICIES)[number] | QPolicy;

interface DrawContext {
  kind: Kind;
  state: TournamentState;
  next: number;
  firstCounted: number;
  lastRound: number;
  random: () => number;
}

function lineUp(rooms: Array<string[]>): RoundAssignment[] {
  return rooms.flatMap((names, index) => names.map((name) => ({ name, room: index + 1, isLucky: false })));
}

function chunkInto(names: string[], roomSizes: number[]): RoundAssignment[] {
  let cursor = 0;
  return lineUp(
    roomSizes.map((size) => {
      const room = names.slice(cursor, cursor + size);
      cursor += size;
      return room;
    }),
  );
}

function seatedNames(state: TournamentState, next: number): string[] {
  return state.assignments[next].filter((entry) => entry.room !== null).map((entry) => entry.name);
}

/** One wave at a time with every tier equal and rematch avoidance only: the fixed draw's way of filling rooms. */
function fillNeutral(
  members: WaveMember[],
  roomNumbers: number[],
  roomSizes: number[],
  state: TournamentState,
  next: number,
): RoundAssignment[] {
  const maxWave = Math.max(0, ...roomNumbers.map((room) => roomSizes[room - 1]));
  const soFar = new Map<number, string[]>(roomNumbers.map((room) => [room, []]));
  const balance = new Map<number, number>(roomNumbers.map((room) => [room, 0]));
  const placed: RoundAssignment[] = [];
  let cursor = 0;
  for (let wave = 0; wave < maxWave; wave += 1) {
    const waveRooms = roomNumbers.filter((room) => roomSizes[room - 1] > wave);
    const waveMembers = members.slice(cursor, cursor + waveRooms.length);
    cursor += waveRooms.length;
    if (waveMembers.length === 0) continue;
    const assigned = assignWaveToRooms(waveMembers, waveRooms, soFar, balance, {
      roomHistory: state.roomHistory,
      targetRoundIndex: next,
      allRoomNumbers: roomNumbers,
      diversityWeight: 1,
      balanceWeight: 0,
    });
    for (const { name, room } of assigned) {
      soFar.set(room, [...(soFar.get(room) ?? []), name]);
      placed.push({ name, room, isLucky: false });
    }
  }
  return placed;
}

/** The round drawn with every tier equal, from a random order, spreading smaller-room seats as a fixed draw does. */
function neutralDraw({ state, next, random }: DrawContext): RoundAssignment[] {
  const sizes = state.rounds[next].rooms;
  const members = shuffled(seatedNames(state, next), random).map((name) => ({ name, tierRank: 0 }));
  const allRooms = sizes.map((_, index) => index + 1);
  const split = isCountedPoolingRound(state.rounds[next])
    ? splitForSmallerRooms(members, sizes, smallerRoomSeatsBefore(state, next), new Set())
    : null;
  if (!split) return fillNeutral(members, allRooms, sizes, state, next);
  const largeRooms = allRooms.filter((room) => !split.smallRooms.includes(room));
  return [
    ...fillNeutral(split.small, split.smallRooms, sizes, state, next),
    ...fillNeutral(split.large, largeRooms, sizes, state, next),
  ];
}

/** The current standings cut into the round's rooms, best room first. */
function standingsDraw({ state, next }: DrawContext): RoundAssignment[] {
  const seated = new Set(seatedNames(state, next));
  const order = computeQualificationStandings(state)
    .map((entry) => entry.name)
    .filter((name) => seated.has(name));
  return chunkInto(order, state.rounds[next].rooms);
}

function randomDraw({ state, next, random }: DrawContext): RoundAssignment[] {
  return chunkInto(shuffled(seatedNames(state, next), random), state.rounds[next].rooms);
}

function aroundCutsDraw(policy: Policy, { state, next, kind }: DrawContext): RoundAssignment[] | null {
  const match = /^cuts(-spread)?-(P[123])$/.exec(policy);
  if (!match) return null;
  return drawAroundCuts(state, next, profileOf(match[2] as ProfileKey, kind), match[1] !== undefined);
}

function qDraw(policy: QPolicy, { state, next, firstCounted, kind }: DrawContext): RoundAssignment[] | null {
  const context = { state, next, firstCounted, kind };
  if (policy === 'engine-like') return engineLikeDraw(context);
  if (next < firstCounted) return null;
  return policy === 'QB' ? byeDraw(context) : stakeDraw(context);
}

function draw(policy: Policy, context: DrawContext): RoundAssignment[] | null {
  const { next, firstCounted, lastRound } = context;
  if (policy === 'engine-like' || policy === 'QB' || policy === 'QK') return qDraw(policy, context);
  if (next === lastRound && policy.startsWith('cuts')) return aroundCutsDraw(policy, context);
  const neutralFirst = policy === 'neutral-first' || policy === 'neutral-first+last-by-standings';
  const lastByStandings = policy === 'last-by-standings' || policy === 'neutral-first+last-by-standings';
  if (neutralFirst && next === firstCounted) return neutralDraw(context);
  if (lastByStandings && next === lastRound) return standingsDraw(context);
  if (policy === 'standings-every-round' && next > firstCounted) return standingsDraw(context);
  if (policy === 'random-rooms') return randomDraw(context);
  return null;
}

/** Replaces the engine's draw of `next` with the policy's, if it has one, and re-records the pairings. */
export function applyPolicy(
  state: TournamentState,
  next: number,
  policy: Policy,
  options: { firstCounted: number; lastRound: number; random: () => number; kind: Kind },
): TournamentState {
  const own = draw(policy, { state, next, ...options });
  if (!own) return state;
  const rewound = rewindRoomHistory(state.roomHistory, state.assignments, next);
  const assignments = [...state.assignments];
  assignments[next] = own;
  return { ...state, assignments, roomHistory: recordRoomHistory(rewound, own, next) };
}
