import { beforeEach, describe } from 'vitest';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
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

/**
 * The shape of a waterfall tournament generated before columns existed: no round has a stored column, so
 * every round is played on its own, as it still is for any such tournament that is running.
 */
export function withoutColumns(state: TournamentState): TournamentState {
  return {
    ...state,
    rounds: state.rounds.map((round) => {
      const { waterfallColumn: _column, waterfallColumnSet: _set, ...single } = round;
      return single;
    }),
  };
}

/**
 * A started qualification-table + waterfall tournament, at the first qualification round. Its waterfall
 * rounds are played one at a time (the pre-columns shape, `withoutColumns`) unless `columns` is true, which
 * keeps the columns generation stores.
 */
export function buildQualWaterfall(
  registered: number,
  waterfallGraph = QUAL_GRAPH,
  setup: Parameters<typeof createDefaultSetup>[0] = {},
  options: { columns?: boolean } = {},
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
  const started = { ...result.state, started: true };
  return options.columns ? started : withoutColumns(started);
}

let columnsStored = false;

/** `buildQualWaterfall` in the shape the enclosing `describeInBothShapes` is running. */
export function buildShapedQualWaterfall(
  registered: number,
  waterfallGraph = QUAL_GRAPH,
  setup: Parameters<typeof createDefaultSetup>[0] = {},
): TournamentState {
  const graph = columnsStored ? inColumnsOfTheirOwn(waterfallGraph) : waterfallGraph;
  return buildQualWaterfall(registered, graph, setup, { columns: columnsStored });
}

/**
 * The Qual fixtures wait with R1C while R1 plays and play R2 after R1C. With stored columns their automatic
 * layout is [R1, R1C], [R2], [Final], which draws R1C with R1: the column shape of these fixtures numbers R1C
 * and R2 so each round keeps its own column and the same flows run. The default grouping has its own tests.
 */
function inColumnsOfTheirOwn(graph: string): string {
  return graph.replace(/^(R1C = \S+)$/m, '$1 COLUMN 2').replace(/^(R2 = \S+)$/m, '$1 COLUMN 3');
}

/**
 * Runs a describe block once for a tournament generated before columns existed (every round played on its
 * own) and once for one with its columns stored, so the same flows are covered in both shapes. Inside it,
 * build with `buildShapedQualWaterfall`. Where a result differs by design, assert on `columnsStored`'s shape
 * through the test's own name.
 */
export function describeInBothShapes(name: string, body: (shape: { stored: boolean }) => void): void {
  describe.each([
    { stored: false, label: 'one round at a time (no stored columns)' },
    { stored: true, label: 'columns stored' },
  ])(`${name} -- $label`, ({ stored }) => {
    beforeEach(() => {
      columnsStored = stored;
    });
    body({ stored });
  });
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
  const start = buildShapedQualWaterfall(32, TIE_GRAPH, { qualRoundsOverride: '1', nonCountingRounds: '0' });
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

/** The live tournament's graph: 2v2v2v2 Survival Teams, two rooms of 4 each at the start, spaced names. */
export const LIVE_GRAPH = `
ROUNDS:
Round 5 Upper = 2x4
Round 5 Lower = 2x4
Semi A = 4
Round 6 = 2x4
Round 7 = 4
Semi-B = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->Round 5 Upper, 9-16->Round 5 Lower
Round 5 Upper.A: 1-2->Semi A, 3-4->Round 6
Round 5 Upper.B: 1-2->Semi A, 3-4->Round 6
Round 5 Lower.A: 1-2->Round 6
Round 5 Lower.B: 1-2->Round 6
Semi A: 1-2->Final, 3-4->Semi-B
Round 6.A: 1-2->Round 7
Round 6.B: 1-2->Round 7
Round 7: 1-2->Semi-B
Semi-B: 1-2->Final
`;

/** Teams of two, for the live tournament's 2v2v2v2 format. */
export function teams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `a${index}` }, { name: `b${index}` }],
  }));
}

/** The live tournament's shape: 2v2v2v2 teams, three qualification rounds, the live graph. */
export function liveTournament(teamCount: number): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: teamCount, players: teams(teamCount) }),
    createDefaultSetup({
      gameFormat: 'team-2v2v2v2',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '99',
      waterfallGraph: LIVE_GRAPH,
    }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
  return { ...result.state, started: true };
}

/** The 32-player spreadsheet layout: [5], [SemiA, 6B, 6C], [7A], [SemiB], [Final]. */
export const SPREADSHEET_GRAPH = `
ROUNDS:
5 = 4x8
6B = 8
6C = 8
7A = 8
SemiA = 8
SemiB = 8
Final = 8 FINAL

ROUTES:
5.A: 1-4->SemiA, 5,8->6B, 6,7->6C
5.B: 1-4->SemiA, 6,7->6B, 5,8->6C
5.C: 1,4->6C, 2,3->6B, 5-8->eliminated
5.D: 1,4->6B, 2,3->6C, 5-8->eliminated
SemiA: 1-4->Final, 5-8->SemiB
6B: 1-4->7A, 5-8->eliminated
6C: 1-4->7A, 5-8->eliminated
7A: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;
