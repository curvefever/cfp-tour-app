import type { TournamentState } from '../types';
import { pressed, scoreRound } from './dependency-play-fixtures';
import { swiss, toSwissExit } from './swiss-source-fixtures';

/**
 * The organiser's 13-team Custom bracket of 2026-11-21, head to head: a Swiss of 5 rounds, then Qual 7-10 play Round 6
 * (2 rooms of 2), Qual 1-6 go straight to the Quarter-finals (4 rooms of 2), Round 6's winners join them and its losers
 * play for 9th-10th. QF 1st go to the Semi-finals, 2nd to Ranking 5-8; SF 1st to the Final, 2nd to Ranking 3-4.
 */
export const SEED_LINES_GRAPH = `
ROUNDS:
R6 = 2x2
QF = 4x2
SF = 2x2
R910 = 2 RANKING
R58 = 2x2
R56 = 2 RANKING
R78 = 2 RANKING
R34 = 2 RANKING
Final = 2 FINAL

ROUTES:
Qual: 1-6->QF, 7-10->R6
R6.A: 1->QF, 2->R910
R6.B: 1->QF, 2->R910
QF.A: 1->SF, 2->R58
QF.B: 1->SF, 2->R58
QF.C: 1->SF, 2->R58
QF.D: 1->SF, 2->R58
SF.A: 1->Final, 2->R34
SF.B: 1->Final, 2->R34
R58.A: 1->R56, 2->R78
R58.B: 1->R56, 2->R78
`;

/** The tournament as the Swiss is over and its last round scored, not advanced: the table the exit routes. */
export function atSwissExit(): TournamentState {
  return toSwissExit(swiss(13, { swissRoundsOverride: '5' }, SEED_LINES_GRAPH));
}

/** The names of the table in exit order: `[0]` is Q1. */
export function exitOrder(state: TournamentState): string[] {
  const swissRound = state.rounds.find((round) => round.standingsRoutes);
  return (swissRound?.standingsExitOrder ?? []).map((entry) => entry.name);
}

export const indexOfLabel = (state: TournamentState, label: string): number =>
  state.rounds.findIndex((round) => round.customLabel === label);

/** The names of one room of a round as seated: `room` is 1-based. */
export function roomNames(state: TournamentState, label: string, room: number): string[] {
  return (state.assignments[indexOfLabel(state, label)] ?? [])
    .filter((entry) => entry.room === room)
    .map((entry) => entry.name);
}

/** Scores a round by name: a unit not named gets 100. Higher wins its room. */
export function scoreWith(
  state: TournamentState,
  label: string,
  scoresByName: Record<string, number>,
): TournamentState {
  const roundIndex = indexOfLabel(state, label);
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    scores[`r${roundIndex}-rm${entry.room}-p${position}`] = scoresByName[entry.name] ?? 100;
  }
  return { ...state, scores };
}

/** Scores a round so that the better seed of every room wins it (the units the round drew carry their seed). */
export function favouritesWin(state: TournamentState, label: string): TournamentState {
  const entries = state.assignments[indexOfLabel(state, label)] ?? [];
  return scoreWith(
    state,
    label,
    Object.fromEntries(entries.map((entry) => [entry.name, 1000 - 10 * (entry.seed ?? 50)])),
  );
}

export { pressed, scoreRound };
