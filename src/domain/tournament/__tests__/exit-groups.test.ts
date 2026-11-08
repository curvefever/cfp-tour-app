import { describe, expect, it } from 'vitest';
import { exitGroups, roundExitGroups } from '../exit-groups';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { THREE_CHAIN_GRAPH } from './dependency-play-fixtures';
import { ALL_ROUTED_GRAPHS, QUAL_GRAPH, TIE_GRAPH, buildQualWaterfall } from './qual-waterfall';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

const example = (id: string) => WATERFALL_EXAMPLES.find((entry) => entry.id === id)?.text ?? '';
const SPREADSHEET = example('spreadsheet-32');
const SECOND_CHANCE = example('second-chance-16');

const indexOfLabel = (state: TournamentState, label: string) => {
  const index = state.rounds.findIndex((round) => round.customLabel === label);
  if (index < 0) throw new Error(`no round ${label}`);
  return index;
};

/** The groups of one round's exits, by the destination's label. */
function groupsOf(state: TournamentState, label: string): Record<string, number> {
  const groups = roundExitGroups(state, indexOfLabel(state, label));
  return Object.fromEntries([...groups].map(([index, group]) => [state.rounds[index].customLabel, group]));
}

/** The groups of the Qual source's standings routes, in the order of their destinations. */
function standingsGroups(state: TournamentState): number[] {
  const index = state.rounds.findIndex((round) => round.standingsRoutes);
  return [...roundExitGroups(state, index).values()];
}

/** A graph with no Qual line. */
const buildPlain = (players: number, graph: string) =>
  buildQualWaterfall(players, graph, { poolingPhase: 'none' });

describe('exit groups of the built-in and fixture graphs', () => {
  it('spreadsheet-32: SemiA is the first group, R6B and R6C share the second', () => {
    const state = buildPlain(32, SPREADSHEET);
    expect(groupsOf(state, 'R5')).toEqual({ SemiA: 0, R6B: 1, R6C: 1 });
  });

  it('the same graph with R6B of 7 and R6C of 8 keeps R6B and R6C together', () => {
    const graph = SPREADSHEET.replace('R6B = 8', 'R6B = 7')
      .replace('R5.A: 1-4->SemiA, 5,8->R6B, 6-7->R6C', 'R5.A: 1-4->SemiA, 5->R6B, 6-7->R6C, 8->eliminated')
      .replace('R6B: 1-4->R7A, 5-8->eliminated', 'R6B: 1-4->R7A, 5-7->eliminated');
    const state = buildPlain(32, graph);
    expect(groupsOf(state, 'R5')).toEqual({ SemiA: 0, R6B: 1, R6C: 1 });
  });

  it('upper and lower: every round reads green then yellow, the Final never joins', () => {
    const state = buildQualWaterfall(37, UPPER_LOWER_GRAPH);
    expect(groupsOf(state, 'R4U')).toEqual({ SemiA: 0, R5L: 1 });
    expect(groupsOf(state, 'R4L')).toEqual({ R5L: 0, R5R: 1 });
    expect(groupsOf(state, 'R5L')).toEqual({ R6L: 0, R6R: 1 });
    expect(groupsOf(state, 'SemiA')).toEqual({ Final: 0, SemiB: 1 });
  });

  it('three chains: X2 and Y2 have the same exits but another intake, so they stay apart', () => {
    const state = buildQualWaterfall(31, THREE_CHAIN_GRAPH, { qualAdv: '24' });
    expect(groupsOf(state, 'Y1')).toEqual({ Y2: 0, X2: 1 });
  });

  it('second chance: the Final first, the second chance room next', () => {
    const state = buildPlain(16, SECOND_CHANCE);
    expect(groupsOf(state, 'R1')).toEqual({ Final: 0, SemiB: 1 });
  });

  it('Qual graphs: one group per destination of the standings, as before', () => {
    expect(standingsGroups(buildQualWaterfall(31, QUAL_GRAPH))).toEqual([0, 1]);
    expect(
      standingsGroups(buildQualWaterfall(32, TIE_GRAPH, { qualRoundsOverride: '1', nonCountingRounds: '0' })),
    ).toEqual([0, 1]);
    for (const count of [37, 43] as const) {
      expect(standingsGroups(buildQualWaterfall(count, ALL_ROUTED_GRAPHS[count]))).toEqual([0, 1]);
    }
  });
});

describe('exit groups of a Qual source', () => {
  const qualGraph = (qualLine: string) => `
ROUNDS:
RA = 8
RB = 8
Final = 8 FINAL

ROUTES:
Qual: ${qualLine}
RA: 1-4->Final, 5-8->eliminated
RB: 1-4->Final, 5-8->eliminated
`;

  it('a snake split of the standings puts both destinations in one group', () => {
    const state = buildQualWaterfall(16, qualGraph('1,4,5,8,9,12,13,16->RA, 2,3,6,7,10,11,14,15->RB'));
    expect(standingsGroups(state)).toEqual([0, 0]);
  });

  it('a top and bottom split keeps them apart: average places 4.5 and 12.5', () => {
    const state = buildQualWaterfall(16, qualGraph('1-8->RA, 9-16->RB'));
    expect(standingsGroups(state)).toEqual([0, 1]);
  });
});

describe('exit groups of one round', () => {
  it('top and bottom of a round with the same exits stay apart', () => {
    const graph = `
ROUNDS:
R1 = 2x8
X = 8
Y = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->X, 5-8->Y
R1.B: 1-4->X, 5-8->Y
X: 1-4->Final, 5-8->eliminated
Y: 1-4->Final, 5-8->eliminated
`;
    expect(groupsOf(buildPlain(16, graph), 'R1')).toEqual({ X: 0, Y: 1 });
  });

  it('three different destinations read 0, 1 and 2', () => {
    const graph = `
ROUNDS:
R1 = 4x8
Upper = 8
Lower = 2x8
Ranking = 8 RANKING
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Upper, 5-8->Lower
R1.B: 1-4->Upper, 5-8->Lower
R1.C: 1-4->Lower, 5-8->Ranking
R1.D: 1-4->Lower, 5-8->Ranking
Upper: 1-4->Final, 5-8->eliminated
Lower.A: 1-2->Final, 3-8->eliminated
Lower.B: 1-2->Final, 3-8->eliminated
Ranking: 1-8->eliminated
`;
    expect(groupsOf(buildPlain(32, graph), 'R1')).toEqual({ Upper: 0, Lower: 1, Ranking: 2 });
  });

  it('only room A reaching the Final: the Final is 0, the semi 1', () => {
    const graph = `
ROUNDS:
R1 = 3x8
SemiB = 2x6
Final = 8 FINAL

ROUTES:
R1.A: 1-2->Final, 3-6->SemiB, 7-8->eliminated
R1.B: 1-4->SemiB, 5-8->eliminated
R1.C: 1-4->SemiB, 5-8->eliminated
SemiB.A: 1-3->Final, 4-6->eliminated
SemiB.B: 1-3->Final, 4-6->eliminated
`;
    expect(groupsOf(buildPlain(24, graph), 'R1')).toEqual({ Final: 0, SemiB: 1 });
  });

  it('a destination never joins the Final, whatever its routes', () => {
    // The Final is given the same routes as Semi, so rooms, exits (none) and intake (average places 4 and 5) are alike.
    const graph = `
ROUNDS:
R1 = 2x8
Semi = 8 RANKING
Final = 8 FINAL

ROUTES:
R1.A: 1,3,5,7->Final, 2,4,6,8->Semi
R1.B: 1,3,5,7->Final, 2,4,6,8->Semi
Semi: 1-8->eliminated
`;
    const built = buildPlain(16, graph);
    const semi = built.rounds[indexOfLabel(built, 'Semi')];
    const state = {
      ...built,
      rounds: built.rounds.map((round) =>
        round.customLabel === 'Final' ? { ...round, waterfallRoutes: semi.waterfallRoutes } : round,
      ),
    };
    expect(groupsOf(state, 'R1')).toEqual({ Final: 0, Semi: 1 });
  });

  it('a round with no routes gives an empty map', () => {
    const state = buildPlain(16, SECOND_CHANCE);
    expect(roundExitGroups(state, indexOfLabel(state, 'Final')).size).toBe(0);
    expect(exitGroups(state, []).size).toBe(0);
  });
});

describe('what counts as similar', () => {
  /** Two rooms of 8 send places to X and Y alike; X and Y are alike in size and exits. */
  const sendingTo = (xPlaces: string, yPlaces: string) => `
ROUNDS:
R1 = 2x8
X = 8
Y = 8
Final = 8 FINAL

ROUTES:
R1.A: ${xPlaces}->X, ${yPlaces}->Y
R1.B: ${xPlaces}->X, ${yPlaces}->Y
X: 1-4->Final, 5-8->eliminated
Y: 1-4->Final, 5-8->eliminated
`;

  it('average places exactly 1 apart join', () => {
    // X takes 1,3,5,7 (average 4), Y takes 2,4,6,8 (average 5).
    expect(groupsOf(buildPlain(16, sendingTo('1,3,5,7', '2,4,6,8')), 'R1')).toEqual({ X: 0, Y: 0 });
  });

  it('average places just over 1 apart stay separate', () => {
    // X takes 1,2,5,7 (average 3.75), Y takes 3,4,6,8 (average 5.25).
    expect(groupsOf(buildPlain(16, sendingTo('1,2,5,7', '3,4,6,8')), 'R1')).toEqual({ X: 0, Y: 1 });
  });

  it('room sizes 1 apart join', () => {
    const graph = `
ROUNDS:
R1 = 2x8
X = 8
Y = 7
Final = 8 FINAL

ROUTES:
R1.A: 1,3,5,7->X, 2,4,6->Y, 8->eliminated
R1.B: 1,3,5,7->X, 2,4,6,8->Y
X: 1-4->Final, 5-8->eliminated
Y: 1-4->Final, 5-7->eliminated
`;
    expect(groupsOf(buildPlain(16, graph), 'R1')).toEqual({ X: 0, Y: 0 });
  });

  it('room sizes 2 apart stay separate', () => {
    const graph = `
ROUNDS:
R1 = 2x7
X = 8
Y = 6
Final = 8 FINAL

ROUTES:
R1.A: 1,3,5,7->X, 2,4,6->Y
R1.B: 1,3,5,7->X, 2,4,6->Y
X: 1-4->Final, 5-8->eliminated
Y: 1-4->Final, 5-6->eliminated
`;
    expect(groupsOf(buildPlain(14, graph), 'R1')).toEqual({ X: 0, Y: 1 });
  });

  it('exits that differ keep alike rooms and alike intake apart', () => {
    // A snake split gives X and Y the average place 4.5 and 8 seats each; only the order of their exits differs.
    const graph = `
ROUNDS:
R1 = 2x8
X = 8
Y = 8
Semi = 8 RANKING
Final = 8 FINAL

ROUTES:
R1.A: 1,4,5,8->X, 2,3,6,7->Y
R1.B: 1,4,5,8->X, 2,3,6,7->Y
X: 1-4->Final, 5-8->Semi
Y: 1-4->Semi, 5-8->Final
Semi: 1-8->eliminated
`;
    expect(groupsOf(buildPlain(16, graph), 'R1')).toEqual({ X: 0, Y: 1 });
  });

  it('a destination with an extra source stays apart from one read first with fewer', () => {
    // X takes only from R1; Y takes from R1 (average place 4.5, like X) and from Extra.
    const graph = `
ROUNDS:
R1 = 2x8
Extra = 8
X = 8
Y = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->Extra
R1.A: 1,4,5,8->X, 2,3,6,7->Y
R1.B: 1,4,5,8->X, 2,3,6,7->eliminated
Extra: 1-4->Y, 5-8->eliminated
X: 1-4->Final, 5-8->eliminated
Y: 1-4->Final, 5-8->eliminated
`;
    expect(groupsOf(buildQualWaterfall(24, graph), 'R1')).toEqual({ X: 0, Y: 1 });
  });
});
