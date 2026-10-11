import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { fixedIdSource } from './test-fixtures';
import { scoreCurrentRound } from './play-through';

/**
 * Fixtures for a waterfall bracket fed by the qualification table (the Qual
 * source): ranks 1-16 to R1 (2 rooms of 8), ranks 17-24 to R1C, everyone
 * else eliminated. R1 and R1C feed R2 and the Final without sending anyone
 * back to R1C, so R1C holds exactly qualification ranks 17-24.
 */
export const QUAL_GRAPH = `
ROUNDS:
R1 = 2x8
R1C = 8
R2 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R1C: 1-4->Final, 5-8->eliminated
R2: 1-4->Final, 5-8->eliminated
`;

export function playerNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

/** A started qualification-table + waterfall tournament, at the first qualification round. */
export function buildQualWaterfall(
  registered: number,
  waterfallGraph = QUAL_GRAPH,
  setup: Parameters<typeof createDefaultSetup>[0] = {},
): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: registered, players: playerNames(registered) }),
    createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '99',
      waterfallGraph,
      ...setup,
    }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return { ...result.state, started: true };
}

/** Scores and advances every qualification round but the last, then scores the last one (not advanced yet). */
export function playToQualificationExit(start: TournamentState): TournamentState {
  let state = start;
  for (let guard = 0; guard < 20; guard += 1) {
    state = scoreCurrentRound(state, 0);
    if (!state.rounds[state.curRound + 1]?.isQual) return state;
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
    state = result.state;
  }
  throw new Error('qualification did not end');
}

/**
 * 1 qualification round, 32 units in 4 rooms of 8, every room scored the same way: every place ties
 * across the 4 rooms, so the standings come in clusters of 4. With this graph (Qual: 1-14 -> R1,
 * 15-22 -> R1C) the clusters 13-16 and 21-24 straddle its two band boundaries.
 */
export const TIE_GRAPH = `
ROUNDS:
R1 = 2x7
R1C = 8
R2 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-14->R1, 15-22->R1C
R1.A: 1-4->R2, 5-7->eliminated
R1.B: 1-4->R2, 5-7->eliminated
R1C: 1-4->Final, 5-8->eliminated
R2: 1-4->Final, 5-8->eliminated
`;

/** Scores the current round so that every room gets the same scores by seat, tying each place across rooms. */
export function scoredAlike(state: TournamentState): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    const [key] = scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: undefined,
    });
    scores[key] = 1000 - 100 * position;
  }
  return { ...state, scores };
}

/** The TIE_GRAPH tournament with its one qualification round scored alike: Next Round is blocked on two ties. */
export function tiedQualExit(): TournamentState {
  const start = buildQualWaterfall(32, TIE_GRAPH, { qualRoundsOverride: '1', nonCountingRounds: '0' });
  return scoredAlike(start);
}

/**
 * Qual-source waterfalls that route every registered unit, so nobody is eliminated at the pooling exit and the
 * swap window is still open while the later bands wait in a pool: 37 = R1 (ranks 1-16) + R1C (21 waiting),
 * 43 = R1 (ranks 1-35, 5 rooms of 7) + R1C (8 waiting).
 */
export const ALL_ROUTED_GRAPHS = {
  37: `
ROUNDS:
R1 = 2x8
R1C = 3x7
R2 = 2x7
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-37->R1C
R1.A: 1-4->R2, 5-8->eliminated
R1.B: 1-4->R2, 5-8->eliminated
R1C.A: 1-2->R2, 3-7->eliminated
R1C.B: 1-2->R2, 3-7->eliminated
R1C.C: 1-2->R2, 3-7->eliminated
R2.A: 1-4->Final, 5-7->eliminated
R2.B: 1-4->Final, 5-7->eliminated
`,
  43: `
ROUNDS:
R1 = 5x7
R1C = 8
R2 = 2x7
Final = 8 FINAL

ROUTES:
Qual: 1-35->R1, 36-43->R1C
R1.A: 1-2->R2, 3-7->eliminated
R1.B: 1-2->R2, 3-7->eliminated
R1.C: 1-2->R2, 3-7->eliminated
R1.D: 1-2->R2, 3-7->eliminated
R1.E: 1-2->R2, 3-7->eliminated
R1C: 1-4->R2, 5-8->eliminated
R2.A: 1-4->Final, 5-7->eliminated
R2.B: 1-4->Final, 5-7->eliminated
`,
};
