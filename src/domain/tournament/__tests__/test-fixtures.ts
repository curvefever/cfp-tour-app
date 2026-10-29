import { getGameFormat } from '../formats';
import { generateTournament } from '../generation';
import { createTournamentRuntime, type IdSource, type RandomSource } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type {
  GameFormatDefinition,
  GameFormatKey,
  RoundAssignment,
  TeamScoringRuleKey,
  TournamentRound,
  TournamentRoster,
  TournamentState,
  TournamentTeam,
} from '../types';

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

/** The definition of a format the test expects to exist. */
export function requireGameFormat(key: GameFormatKey): Readonly<GameFormatDefinition> {
  const format = getGameFormat(key);
  if (!format) throw new Error(`No game format ${key}.`);
  return format;
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

export type Setup = Parameters<typeof createDefaultSetup>[0];

/** A deterministic runtime: fixed ids and a seeded generator, so a redraw is repeatable. */
export function testRuntime() {
  let seed = 12345;
  return createTournamentRuntime({
    ids: fixedIdSource(),
    random: {
      next: () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      },
    },
  });
}

/** Generated but not started: the state the organiser sees on Setup before Confirm & Start. */
export function generated(count: number, setup: Setup = {}): TournamentState {
  const gameFormat = setup.gameFormat ?? 'ffa-individual';
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(gameFormat, count) }),
    createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '16', ...setup }),
    testRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return result.state;
}

export const TEAM_QUAL_GRAPH = `
ROUNDS:
R1 = 2x4
R1C = 4
R2 = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->R1, 9-12->R1C
R1.A: 1-2->R2, 3-4->eliminated
R1.B: 1-2->R2, 3-4->eliminated
R1C: 1->Final, 2-4->eliminated
R2: 1-3->Final, 4->eliminated
`;

export const EXACT_COUNT_GRAPH = `
ROUNDS:
R1 = 2x8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Final, 5-8->eliminated
R1.B: 1-4->Final, 5-8->eliminated
`;

const DEFAULT_ROOM_NAMES = ['Ann', 'Bob', 'Cy', 'Di'];

export function teamOf(id: string, members: Array<string | null>): TournamentTeam {
  return {
    teamId: id,
    teamName: id,
    members: members.map((name) => (name ? { name } : null)),
  };
}

export interface OneRoomOptions {
  gameFormat?: GameFormatKey;
  rule?: TeamScoringRuleKey;
  players?: TournamentRoster;
  rounds?: Array<Partial<TournamentRound>>;
  scores?: TournamentState['scores'];
  absences?: TournamentState['absences'];
  version?: boolean;
}

/** Round 1 (index 0) and Round 2 (index 1), each one room of `players`, round 1 in play. */
export function oneRoomState(options: OneRoomOptions = {}): TournamentState {
  const players = options.players ?? DEFAULT_ROOM_NAMES;
  const names = (players as Array<string | TournamentTeam>).map((player) =>
    typeof player === 'string' ? player : player.teamId,
  );
  const rounds = options.rounds ?? [{}, {}];
  return createDefaultTournamentState({
    gameFormat: options.gameFormat ?? 'ffa-individual',
    players,
    rounds: rounds.map((overrides, index) =>
      buildRound({ roundNum: index + 1, rooms: [names.length], players: names.length, ...overrides }),
    ),
    assignments: rounds.map(() => buildAssignments(names, [names.length])),
    scores: options.scores ?? {},
    absences: options.absences ?? {},
    gamemodeConfig: {
      ...(options.version === false ? {} : { absenceVersion: 1 as const }),
      ...(options.rule ? { teamScoringRule: options.rule } : {}),
    },
    started: true,
  });
}
