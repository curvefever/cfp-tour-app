import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
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
