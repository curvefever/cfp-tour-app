/**
 * An upper and lower bracket as a Custom bracket graph, shaped like the live tournament 1793555835749: Round 6's
 * two rounds are fed only by the lower half of Round 5 (R5L), while Semi-Final A, played in the same column, feeds
 * Semi-Final B. It generates at 37, 43 and 53 players. Plain text with no test-runner import, so the screenshot
 * fixtures can use it too.
 */
export const UPPER_LOWER_GRAPH = `
ROUNDS:
R4U = 2x8
R4L = 2x8
SemiA = 8
R5L = 2x8
R5R = 8 RANKING
R6L = 8
R6R = 8 RANKING
SemiB = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R4U, 17-32->R4L
R4U.A: 1-4->SemiA, 5-8->R5L
R4U.B: 1-4->SemiA, 5-8->R5L
R4L.A: 1-4->R5L, 5-8->R5R
R4L.B: 1-4->R5L, 5-8->R5R
SemiA: 1-4->Final, 5-8->SemiB
R5L.A: 1-4->R6L, 5-8->R6R
R5L.B: 1-4->R6L, 5-8->R6R
R5R: 1-8->eliminated
R6L: 1-4->SemiB, 5-8->eliminated
R6R: 1-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;
