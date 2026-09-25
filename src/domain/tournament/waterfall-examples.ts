/**
 * Ready-made waterfall graphs the Setup editor can load as a starting point.
 * Each one is plain ROUNDS:/ROUTES: text sized for exactly `entrants` players.
 */

export interface WaterfallExample {
  id: string;
  label: string;
  entrants: number;
  text: string;
}

/** The structure traced from the real organiser spreadsheet ("Matches 40p" tab), trimmed to a 32-player field. */
const SPREADSHEET_32 = `ROUNDS:
R5 = 4x8
SemiA = 8
R6B = 8
R6C = 8
R7A = 8
SemiB = 8
Final = 8 FINAL

ROUTES:
R5.A: 1-4->SemiA, 5,8->R6B, 6-7->R6C
R5.B: 1-4->SemiA, 5,8->R6C, 6-7->R6B
R5.C: 1,4->R6C, 2-3->R6B, 5-8->eliminated
R5.D: 1,4->R6B, 2-3->R6C, 5-8->eliminated
SemiA: 1-4->Final, 5-8->SemiB
R6B: 1-4->R7A, 5-8->eliminated
R6C: 1-4->R7A, 5-8->eliminated
R7A: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated`;

/** Two rooms of 8: ranks 1-3 go straight to the Final, 4-7 get a second-chance room, 8th is out. */
const SECOND_CHANCE_16 = `ROUNDS:
R1 = 2x8
SemiB = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-3->Final, 4-7->SemiB, 8->eliminated
R1.B: 1-3->Final, 4-7->SemiB, 8->eliminated
SemiB: 1-2->Final, 3-8->eliminated`;

export const WATERFALL_EXAMPLES: readonly WaterfallExample[] = [
  { id: 'second-chance-16', label: '16 players, second chance', entrants: 16, text: SECOND_CHANCE_16 },
  { id: 'spreadsheet-32', label: '32 players, spreadsheet layout', entrants: 32, text: SPREADSHEET_32 },
];
