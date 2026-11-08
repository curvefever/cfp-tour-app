import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { computeRankings } from '../rankings';
import { rosterKeys } from '../roster';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import {
  drawsOf,
  playColumns,
  playDependency,
  resolveEveryTie,
  STRATEGIES,
  type Scorer,
} from './dependency-play-fixtures';
import { scoreCurrentRound } from './play-through';
import { withoutDependencyPlay } from './qual-waterfall';

/**
 * Dependency play from real generation on the setups the other walks don't use (they start from a qualification
 * table in FFA): no pooling phase, a group stage and a team format. Every press order gives column play's draws, and
 * Rankings lists every unit exactly once after every press.
 */

const ROOMS_OF_8 = `
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
const TWO_BANDS = `
ROUNDS:
R1 = 2x2
R1C = 2x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
Groups: 1-4->R1, 5-8->R1C
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1C.A: 1->R2, 2->eliminated
R1C.B: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;
const TEAMS_UPPER_LOWER = `
ROUNDS:
U = 2x4
L = 2x4
SemiA = 4
L2 = 2x4
SemiB = 4
Final = 4 FINAL

ROUTES:
Qual: 1-8->U, 9-16->L
U.A: 1-2->SemiA, 3-4->L2
U.B: 1-2->SemiA, 3-4->L2
L.A: 1-2->L2, 3-4->eliminated
L.B: 1-2->L2, 3-4->eliminated
SemiA: 1-2->Final, 3-4->SemiB
L2.A: 1->SemiB, 2-4->eliminated
L2.B: 1->SemiB, 2-4->eliminated
SemiB: 1-2->Final, 3-4->eliminated
`;

const teamsOf = (count: number, size: number): TournamentTeam[] =>
  Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: Array.from({ length: size }, (_unused, slot) => ({ name: `p${index}-${slot}` })),
  }));

function generated(players: unknown[], count: number, setup: Record<string, unknown>): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: players as string[] }),
    createDefaultSetup({ scheduleLogic: 'waterfall-bracket', ...setup }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  expect(result.state.gamemodeConfig.dependencyPlayVersion).toBe(1);
  return { ...result.state, started: true };
}

const scorerFor =
  (teamSize: number): Scorer =>
  (state, roundIndex) => ({
    ...state,
    scores: scoreCurrentRound({ ...state, curRound: roundIndex }, teamSize).scores,
  });

/** Plays the pooling rounds and presses into the bracket. */
function toBracket(start: TournamentState, teamSize: number): TournamentState {
  let state = start;
  for (let guard = 0; guard < 30 && !state.rounds[state.curRound].isWaterfall; guard += 1) {
    state = resolveEveryTie(scoreCurrentRound(state, teamSize), state.curRound);
    let result = advanceTournamentRound(state);
    for (let retry = 0; retry < 5 && result.status === 'blocked'; retry += 1) {
      state = resolveEveryTie(result.state, state.curRound);
      result = advanceTournamentRound(state);
    }
    if (result.status !== 'advanced') throw new Error(`stuck in pooling: ${JSON.stringify(result.status)}`);
    state = result.state;
  }
  return state;
}

function everyUnitOnce(state: TournamentState): TournamentState {
  const rankings = computeRankings(state);
  if (!rankings) return state;
  const names = [
    ...rankings.stillActive.map((entry) => entry.name),
    ...rankings.finalists.map((entry) => entry.name),
    ...rankings.eliminatedList.map((entry) => entry.name),
  ];
  expect([...names].sort()).toEqual([...new Set(names)].sort());
  expect(new Set(names)).toEqual(new Set(rosterKeys(state.players)));
  return state;
}

const CASES: Array<{ label: string; start: () => TournamentState; teamSize: number }> = [
  ...[16].map((count) => ({
    label: `no pooling, FFA, rooms of 8, ${count}`,
    teamSize: 0,
    start: () =>
      generated(
        Array.from({ length: count }, (_, index) => `P${index + 1}`),
        count,
        { gameFormat: 'ffa-individual', poolingPhase: 'none', waterfallGraph: ROOMS_OF_8 },
      ),
  })),
  ...WATERFALL_EXAMPLES.map((example) => ({
    label: `no pooling, FFA, ${example.id}`,
    teamSize: 0,
    start: () =>
      generated(
        Array.from({ length: example.entrants }, (_, index) => `P${index + 1}`),
        example.entrants,
        { gameFormat: 'ffa-individual', poolingPhase: 'none', waterfallGraph: example.text },
      ),
  })),
  ...[11, 13, 15, 16].map((count) => ({
    label: `group stage, 4v4, ${count}`,
    teamSize: 4,
    start: () =>
      toBracket(
        generated(teamsOf(count, 4), count, {
          gameFormat: 'team-4v4',
          poolingPhase: 'group-stage',
          groupSize: '4',
          oddCountStrategy: 'bye',
          groupExit: 'fair-cut',
          waterfallGraph: TWO_BANDS,
        }),
        4,
      ),
  })),
  ...[17, 19, 23].map((count) => ({
    label: `qualification, 2v2v2v2, ${count}`,
    teamSize: 2,
    start: () =>
      toBracket(
        generated(teamsOf(count, 2), count, {
          gameFormat: 'team-2v2v2v2',
          poolingPhase: 'qual-table',
          qualAdv: '16',
          waterfallGraph: TEAMS_UPPER_LOWER,
        }),
        2,
      ),
  })),
];

describe.each(CASES)('$label', ({ start, teamSize }) => {
  const entry = start();
  const score = scorerFor(teamSize);
  const column = playColumns(withoutDependencyPlay(entry), (state) => state, score);

  it.each(Object.entries(STRATEGIES))('%s: same draws as column play, every unit once', (_name, strategy) => {
    expect(column.rounds[column.curRound].isFinal).toBe(true);
    const played = playDependency(entry, strategy, everyUnitOnce, score);
    expect(drawsOf(played)).toEqual(drawsOf(column));
  });
});
