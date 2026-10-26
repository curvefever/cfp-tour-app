import { scoredTeamSize, scoreKeysForPosition } from '../scoring';
import { splitAdvancement } from '../room-distribution';
import type { TournamentState } from '../types';
import { buildState, type SweepConfig } from './play-through';

/**
 * Shared by the fair-cut tests: a round seated synthetically (unit `R{room}P{position}` in each room of the round's
 * planned shape) and scored from a list per room, on tournaments the real schedule generators built.
 */

export type Setup = SweepConfig['setup'];

export const SE_2V2V2V2: Setup = {
  gameFormat: 'team-2v2v2v2',
  teamScoringRule: 'survival-teams',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'none',
};
export const SE_FFA: Setup = {
  gameFormat: 'ffa-individual',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'none',
};

export function config(label: string, count: number, setup: Setup): SweepConfig {
  return { label, count, setup, teams: setup?.gameFormat?.startsWith('team-') ?? false };
}

export function generate(label: string, count: number, setup: Setup): TournamentState {
  const state = buildState(config(label, count, setup));
  if (!state) throw new Error(`generation refused: ${label}`);
  return state;
}

export function firstEliminationIndex(state: TournamentState): number {
  return state.rounds.findIndex((round) => !round.isNoElim && !round.isQual && !round.isFinal);
}

/** Puts unit `R{room}P{position}` in every seat of a round's planned rooms, with `rooms` overriding the shape when given. */
export function seatRound(state: TournamentState, roundIndex: number, rooms?: number[]): TournamentState {
  const shape = rooms ?? state.rounds[roundIndex].rooms;
  const lineUp = shape.flatMap((size, index) =>
    Array.from({ length: size }, (_, position) => ({
      name: `R${index + 1}P${position + 1}`,
      room: index + 1,
      isLucky: false,
    })),
  );
  const assignments = [...state.assignments];
  assignments[roundIndex] = lineUp;
  return { ...state, assignments };
}

/** Scores a seated round: `scores[room - 1][position]` is that seat's score. Extra keys (games, team members) hold 0. */
export function scoreRooms(state: TournamentState, roundIndex: number, scores: number[][]): TournamentState {
  const round = state.rounds[roundIndex];
  const next = { ...state.scores };
  scores.forEach((roomScores, roomIndex) => {
    roomScores.forEach((score, position) => {
      const keys = scoreKeysForPosition({
        roundIndex,
        room: roomIndex + 1,
        position,
        numGames: round.numGames ?? 1,
        teamSize: scoredTeamSize(state),
      });
      keys.forEach((key, index) => {
        next[key] = index === 0 ? score : 0;
      });
    });
  });
  return { ...state, scores: next };
}

export function seatedAndScored(
  state: TournamentState,
  roundIndex: number,
  scores: number[][],
): TournamentState {
  return scoreRooms(
    seatRound(
      state,
      roundIndex,
      scores.map((room) => room.length),
    ),
    roundIndex,
    scores,
  );
}

export function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomScores(rooms: number[], seed: number): number[][] {
  const random = mulberry32(seed);
  return rooms.map((size) => Array.from({ length: size }, () => 1 + Math.floor(random() * 60)));
}

/** A placeholder round on a generated state: `rooms` and `advTotal` replaced, nothing else. */
export function withRoundShape(
  state: TournamentState,
  roundIndex: number,
  shape: { rooms: number[]; advTotal: number; isSemis?: boolean; numGames?: number },
): TournamentState {
  const rounds = [...state.rounds];
  const { isSemis, ...rest } = shape;
  rounds[roundIndex] = {
    ...rounds[roundIndex],
    ...rest,
    ...splitAdvancement(shape.advTotal, 0, shape.rooms.length),
    players: shape.rooms.reduce((sum, size) => sum + size, 0),
    byeCount: 0,
    ...(isSemis ? { isSemis: true } : {}),
  };
  return { ...state, rounds };
}
