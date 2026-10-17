import { getGameFormat } from '../formats';
import type { IdSource, RandomSource } from '../runtime';
import type { GameFormatKey, RoundAssignment, TournamentRound, TournamentRoster } from '../types';

/** Deterministic RandomSource yielding a fixed sequence, cycling if exhausted. */
export function sequenceRandom(values: number[]): RandomSource {
  let index = 0;
  return {
    next: () => {
      const value = values[index % values.length];
      index += 1;
      return value;
    },
  };
}

/** Builds a bare TournamentRound with sane defaults; override anything. */
export function buildRound(
  overrides: Partial<TournamentRound> & Pick<TournamentRound, 'roundNum'>,
): TournamentRound {
  return {
    players: 0,
    rooms: [],
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: false,
    advPerRoom: null,
    advTotal: 0,
    luckyCount: 0,
    ...overrides,
  };
}

/** Deterministic IdSource for generation tests that need a stable tournamentId. */
export function fixedIdSource(overrides: Partial<IdSource> = {}): IdSource {
  return {
    tournamentId: () => 'test-tournament-id',
    rosterUnitId: (prefix, index) => `${prefix}_${index}`,
    ...overrides,
  };
}

/** Builds RoundAssignment[] for the given names, distributed into `rooms` sequentially. */
export function buildAssignments(names: string[], rooms: number[]): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let nameIndex = 0;
  for (const [roomIndex, roomSize] of rooms.entries()) {
    for (let position = 0; position < roomSize; position += 1) {
      const name = names[nameIndex];
      nameIndex += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: false });
    }
  }
  return assignments;
}

/** A roster of `count` units that fits the format: teams of its team size, or plain names for an individual format. */
export function rosterFor(gameFormat: GameFormatKey, count: number): TournamentRoster {
  const teamSize = getGameFormat(gameFormat)?.teamSize;
  const indexes = Array.from({ length: count }, (_, index) => index);
  if (!teamSize) return indexes.map((index) => `P${index + 1}`);
  return indexes.map((index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: teamSize }, (_unused, slot) => ({ name: `${'abcdef'[slot]}${index}` })),
  }));
}
