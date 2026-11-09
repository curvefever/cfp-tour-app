import type { TournamentState } from '../types';
import { pressed, scoreRound } from './dependency-play-fixtures';
import { withoutDependencyPlay } from './qual-waterfall';
import { generated } from './test-fixtures';

/**
 * Head-to-head Swiss tournaments feeding a Custom bracket, for the tests of a `Qual` line after a Swiss (domain and
 * screens): ranks 1-4 go to the Upper round and 5-8 to the Lower one, everyone else is out.
 */

export const SWISS_QUAL_GRAPH = `
ROUNDS:
U = 2x2
L = 2x2
S = 2x2
T = 2
Final = 2 FINAL

ROUTES:
Qual: 1-4->U, 5-8->L
U.A: 1->Final, 2->S
U.B: 1->S, 2->eliminated
L.A: 1->S, 2->eliminated
L.B: 1->S, 2->eliminated
S.A: 1->T, 2->eliminated
S.B: 1->T, 2->eliminated
T: 1->Final, 2->eliminated
`;

/** A Custom bracket under a Swiss with no Qual line: one entry round of 8 teams, as before. */
export const SWISS_LINELESS_GRAPH = `
ROUNDS:
R1 = 4x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1.C: 1->R2, 2->eliminated
R1.D: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

/** A started Swiss tournament with the graph, in column play, at its first Swiss round. */
export function swiss(
  count: number,
  setup: Parameters<typeof generated>[1] = {},
  graph = SWISS_QUAL_GRAPH,
): TournamentState {
  const state = generated(count, {
    gameFormat: 'individual-1v1',
    scheduleLogic: 'waterfall-bracket',
    poolingPhase: 'swiss',
    oddCountStrategy: 'bye',
    waterfallGraph: graph,
    ...setup,
  });
  return withoutDependencyPlay({ ...state, started: true });
}

export const firstBracketIndex = (state: TournamentState) =>
  state.rounds.findIndex((round) => round.isWaterfall);

/** Every Swiss round scored (distinct scores unless `score` says otherwise) and advanced, the last one scored but not advanced. */
export function toSwissExit(start: TournamentState, score = scoreRound): TournamentState {
  let state = start;
  const last = firstBracketIndex(state) - 1;
  for (let guard = 0; guard < 20 && state.curRound < last; guard += 1) {
    state = pressed(score(state, state.curRound));
  }
  return score(state, last);
}

/** The first bracket round drawn, nothing of it scored. */
export const atEntry = (start: TournamentState) => pressed(toSwissExit(start));
