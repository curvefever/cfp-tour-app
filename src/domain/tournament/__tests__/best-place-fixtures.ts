import type { TournamentState } from '../types';
import { scoreKeysForPosition } from '../scoring';
import { indexOf } from './dependency-play-fixtures';

/** The example of `plans/2026-11-13-best-of-a-place.md` on generated tournaments, and the scores that play it. */

/** Three rooms' scores, best first by seat. The 6th places' shares of their rooms' averages: A .67, B .76, C .79. */
export const A = [80, 70, 60, 50, 40, 30, 20, 10];
export const B = [80, 70, 60, 50, 40, 35, 20, 15];
export const C = [85, 70, 60, 50, 40, 36, 15, 8];
export const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];

/** The example on a generated tournament: a qualification table at `count` entrants sends 24 into R4 = 3x8. */
export const rooms = (...labels: string[]) => labels.map((label) => `R4.${label}: 1-5->R5, 6-8->eliminated`);
export const graphText = (roundLines: string[], routeLines: string[]) =>
  `ROUNDS:\n${roundLines.join('\n')}\n\nROUTES:\n${routeLines.join('\n')}`;
export const EXAMPLE = graphText(
  ['R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'],
  [
    'Qual: 1-24->R4',
    ...rooms('A', 'B', 'C'),
    'R4.BEST: 1 OF 6->R5',
    'R5.A: 1-4->Final, 5-8->eliminated',
    'R5.B: 1-4->Final, 5-8->eliminated',
  ],
);
export const WITH_LOWER = graphText(
  ['R4 = 3x8', 'R5 = 2x8', 'R5L = 6', 'Final = 8 FINAL'],
  [
    'Qual: 1-24->R4',
    'R4.A: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.B: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.C: 1-5->R5, 6->R5L, 7-8->eliminated',
    'R4.BEST: 1 OF 6->R5',
    'R5.A: 1-3->Final, 4-5->R5L, 6-8->eliminated',
    'R5.B: 1-3->Final, 4-5->R5L, 6-8->eliminated',
    'R5L: 1-2->Final',
  ],
);

/** The scores of each room of a round, best first by seat. */
export function scoreRooms(state: TournamentState, roundIndex: number, perRoom: number[][]): TournamentState {
  const scores = { ...state.scores };
  perRoom.forEach((roomScores, index) => {
    roomScores.forEach((score, position) => {
      scores[scoreKeysForPosition({ roundIndex, room: index + 1, position })[0]] = score;
    });
  });
  return { ...state, scores };
}

export const namesIn = (state: TournamentState, label: string) =>
  (state.assignments[indexOf(state, label)] ?? []).map((entry) => entry.name);

/** The unit sitting at a seat of R4 as drawn. */
export function seatOf(state: TournamentState, room: number, position: number): string {
  const seats = (state.assignments[indexOf(state, 'R4')] ?? []).filter((entry) => entry.room === room);
  return seats[position].name;
}
