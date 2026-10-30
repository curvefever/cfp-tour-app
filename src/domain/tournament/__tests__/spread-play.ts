import { buildAdvancementTiers } from '../advancement';
import { getGameFormat } from '../formats';
import { addWalkUpIndividual, addWalkUpTeam } from '../mutations';
import { scoredTeamSize, scoreKeysForPosition } from '../scoring';
import { recordRoomHistory } from '../seeding';
import { advanceTournamentRound } from '../transitions';
import type { RoundAssignment, TournamentState } from '../types';
import { buildState, type SweepConfig } from './play-through';
import { ONE_SCORE_PER_TEAM } from '../formats';

/**
 * Helpers for the smaller-room-seat tests: a qualification table played with scores that don't follow the
 * seating order (so who finishes last varies), recording each unit's place in its room.
 */

export type SpreadKind = '2v2v2v2' | '3v3v3' | 'ffa';

const GAME_FORMAT = { '2v2v2v2': 'team-2v2v2v2', '3v3v3': 'team-3v3v3', ffa: 'ffa-individual' } as const;
const QUAL_ADV = { '2v2v2v2': '16', '3v3v3': '8', ffa: '16' } as const;

export interface SpreadOptions {
  fixed?: boolean;
  nonCounting?: number;
  pooling?: 'qual-table' | 'none';
}

export function spreadConfig(kind: SpreadKind, count: number, options: SpreadOptions = {}): SweepConfig {
  const teams = kind !== 'ffa';
  return {
    label: `${kind} ${count}`,
    count,
    teams,
    setup: {
      gameFormat: GAME_FORMAT[kind],
      ...(teams ? { teamScoringRule: ONE_SCORE_PER_TEAM } : {}),
      scheduleLogic: 'single-elimination',
      poolingPhase: options.pooling ?? 'qual-table',
      qualAdv: QUAL_ADV[kind],
      qualRoundsOverride: '4',
      nonCountingRounds: String(options.nonCounting ?? 1),
      drawPublication: options.fixed ? 'fixed' : 'adaptive',
    },
  };
}

/** The started tournament; an adaptive draw's shuffled round 1 is replaced by the roster cut into rooms in order, so every run is the same. */
export function startSpread(config: SweepConfig): TournamentState {
  const state = buildState(config);
  if (!state) throw new Error(`generation refused: ${config.label}`);
  if (state.rounds[0].fixedRoomAssignments) return state;
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
  for (const name of names.slice(cursor)) lineUp.push({ name, room: null, isLucky: false });
  return {
    ...state,
    assignments: [lineUp, ...state.assignments.slice(1)],
    roomHistory: recordRoomHistory({}, lineUp, 0),
  };
}

export function teamSizeOf(state: TournamentState): number {
  return getGameFormat(state.gameFormat)?.teamSize ?? 0;
}

function hash(input: string): number {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Each unit's place (0 = best) in its room, as the engine ranks it (the tier it is seeded by). */
export type Places = Record<string, number>;

/** Scores every occupied room of the current round: the order within a room comes from a hash of round and name, not from the seating. */
export function scoreByHash(state: TournamentState): { state: TournamentState; places: Places } {
  const roundIndex = state.curRound;
  const round = state.rounds[roundIndex];
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room !== null);
  const byHash = [...seated].sort(
    (first, second) => hash(`${roundIndex}|${first.name}`) - hash(`${roundIndex}|${second.name}`),
  );
  const value = new Map(byHash.map((entry, index) => [entry.name, 10_000 - 10 * index]));
  const scores = { ...state.scores };
  const position = new Map<number, number>();
  for (const entry of seated) {
    const slot = position.get(entry.room as number) ?? 0;
    position.set(entry.room as number, slot + 1);
    const keys = scoreKeysForPosition({
      roundIndex,
      room: entry.room as number,
      position: slot,
      numGames: round.numGames ?? 1,
      teamSize: scoredTeamSize(state),
    });
    keys.forEach((key, index) => {
      scores[key] = index === 0 ? (value.get(entry.name) as number) : 1;
    });
  }
  const scored = { ...state, scores };
  const places: Places = {};
  const tiers = buildAdvancementTiers(
    scored,
    roundIndex,
    seated.map((entry) => entry.name),
  );
  for (const tier of tiers) for (const member of tier.members) places[member.name] = tier.rank;
  return { state: scored, places };
}

export function advanceScored(state: TournamentState): { state: TournamentState; places: Places } {
  const scored = scoreByHash(state);
  const result = advanceTournamentRound(scored.state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return { state: result.state, places: scored.places };
}

/** Plays until `curRound` is `lastRound` (drawn, unscored); `places[i]` holds round i's places. */
export function playToRound(
  start: TournamentState,
  lastRound: number,
  places: Places[] = [],
): { state: TournamentState; places: Places[] } {
  let state = start;
  while (state.curRound < lastRound) {
    const step = advanceScored(state);
    places[state.curRound] = step.places;
    state = step.state;
  }
  return { state, places };
}

/** The late joiner's key. */
export const JOINER = 'tJOIN';

export function addLateJoiner(state: TournamentState): TournamentState {
  const teamSize = teamSizeOf(state);
  const result = teamSize
    ? addWalkUpTeam(
        state,
        {
          teamId: JOINER,
          teamName: 'Joiner',
          members: Array.from({ length: teamSize }, (_, slot) => ({ name: `joiner-${slot}` })),
        },
        { allowLateJoin: true },
      )
    : addWalkUpIndividual(state, JOINER, { allowLateJoin: true });
  if (result.status !== 'added') throw new Error(`joiner refused: ${JSON.stringify(result)}`);
  return result.state;
}

/** The units of each room, in line-up order. */
export function roomsOf(lineUp: RoundAssignment[]): string[][] {
  const rooms: string[][] = [];
  for (const { name, room } of lineUp) {
    if (room === null) continue;
    (rooms[room - 1] ??= []).push(name);
  }
  return rooms;
}
