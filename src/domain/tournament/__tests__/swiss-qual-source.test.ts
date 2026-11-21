import { describe, expect, it } from 'vitest';
import { swissRoutesItsStandings } from '../pooling';
import { standingsKindOfSetup } from '../waterfall-numbering';
import { SEED_LINES_GRAPH } from './seed-lines-fixtures';
import { firstBracketIndex, swiss } from './swiss-source-fixtures';

/**
 * After a Swiss a Custom bracket graph always has the Qual source, as after a qualification table: a graph without the
 * line is read as the top N into its entry round, and a graph with it routes the Swiss standings by rank.
 */

/** Four units play Round 6 (2 rooms of 2), their winners the Quarter-finals, then the Final: no Qual line. */
const LINELESS_13 = `
ROUNDS:
R6 = 2x2
QF = 2x2
Final = 2 FINAL

ROUTES:
R6.A: 1-2->QF
R6.B: 1-2->QF
QF.A: 1->Final
QF.B: 1->Final
`;

describe('a Swiss of 13 players into a Custom bracket graph with no Qual line', () => {
  const state = swiss(13, {}, LINELESS_13);
  const entry = firstBracketIndex(state);

  it('stores the routing on the last Swiss round: ranks 1-4 go to the entry round', () => {
    expect(state.rounds[entry - 1].standingsRoutes).toEqual([entry, entry, entry, entry]);
    expect(state.rounds[entry].rooms).toEqual([2, 2]);
  });

  it('derives "Advance to bracket" from the graph, whatever the form said', () => {
    expect(state.cfg.qualAdv).toBe(4);
    expect(swiss(13, { qualAdv: '9' }, LINELESS_13).cfg.qualAdv).toBe(4);
    expect(swissRoutesItsStandings(state)).toBe(true);
  });
});

describe("the organiser's shape: Qual 1-6 to the Quarter-finals, 7-10 to Round 6, after a Swiss of 13", () => {
  const state = swiss(13, { swissRoundsOverride: '5' }, SEED_LINES_GRAPH);

  it('is generated under a Swiss, routing the standings by rank', () => {
    const last = firstBracketIndex(state) - 1;
    const quarter = state.rounds.findIndex((round) => round.customLabel === 'QF');
    const round6 = state.rounds.findIndex((round) => round.customLabel === 'R6');
    expect(state.rounds[last].standingsRoutes).toEqual([...Array(6).fill(quarter), ...Array(4).fill(round6)]);
    expect(state.cfg.qualAdv).toBe(10);
  });

  it('is a Qual source in the Setup editor, with or without the line in the text', () => {
    const setup = { scheduleLogic: 'waterfall-bracket' as const, poolingPhase: 'swiss' as const };
    expect(standingsKindOfSetup(setup)).toBe('qual');
  });
});
