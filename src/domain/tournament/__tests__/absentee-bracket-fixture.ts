import { answerAbsence } from '../absences';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { scoreCurrentRound } from './play-through';

/** Two rooms of 8 into a top Semi A and a Lower round: 1-4 of each room go to Semi A, 5-8 to Lower. */
export const ABSENTEE_GRAPH = `
ROUNDS:
R1 = 2x8
Semi A = 8
Lower = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Semi A, 5-8->Lower
R1.B: 1-4->Semi A, 5-8->Lower
Semi A: 1-4->Final, 5-8->eliminated
Lower: 1-4->Final, 5-8->eliminated
`;

/** 16 FFA players, no pooling, advanced to R1; room A of R1 has 5 absent (seats 4-8), room B all present. */
export function r1WithFiveAbsent(): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: 16,
      players: Array.from({ length: 16 }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: ABSENTEE_GRAPH,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error('generation failed');
  let state: TournamentState = { ...result.state, started: true };
  while (state.rounds[state.curRound].customLabel !== 'R1') {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach R1: ${advanced.status}`);
    state = advanced.state;
  }
  const keys = [3, 4, 5, 6, 7].map((seat) => `r${state.curRound}-rm1-p${seat}`);
  const scored = scoreCurrentRound(state, 0);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  return answerAbsence(zeroed, keys, 'absent');
}
