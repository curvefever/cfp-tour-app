import { expect } from 'vitest';
import { getAllTies } from '../advancement';
import { computeRankings } from '../rankings';
import { resolveTournamentTie } from '../mutations';
import { scoreKeysForPosition } from '../scoring';
import { roundsInPlay } from '../round-columns';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { isRoundScored } from '../waterfall-steps';
import { buildQualWaterfall, playToQualificationExit, withDependencyPlay } from './qual-waterfall';
import { scoreByHash } from './spread-play';
import { UPPER_LOWER_GRAPH } from './upper-lower-graph';

/**
 * Shared by the dependency play tests: the graphs, scoring helpers, and walks to the Final in column play and in
 * dependency play (`playColumns`, `playDependency`), whose draws must agree.
 */

export const SPREADSHEET = WATERFALL_EXAMPLES.find((example) => example.id === 'spreadsheet-32')?.text ?? '';

/** Three chains X, Y, Z whose second rounds take units from the next chain over, so a pool has two feeders. 24 qualify. */
export const THREE_CHAIN_GRAPH = `
ROUNDS:
X1 = 8
Y1 = 8
Z1 = 8
X2 = 8
Y2 = 8
Z2 = 8
T3 = 8
Final = 8 FINAL

ROUTES:
Qual: 1-8->X1, 9-16->Y1, 17-24->Z1
X1: 1-4->X2, 5-8->Z2
Y1: 1-4->Y2, 5-8->X2
Z1: 1-4->Z2, 5-8->Y2
X2: 1-4->T3, 5-8->eliminated
Y2: 1-4->T3, 5-8->eliminated
Z2: 1-4->Final, 5-8->eliminated
T3: 1-4->Final, 5-8->eliminated
`;

export const indexOf = (state: TournamentState, label: string) =>
  state.rounds.findIndex((round) => round.customLabel === label);

/** The rounds' indexes of the labels, in the order the state lists them (a column lists its rounds in its own order). */
export const indexes = (state: TournamentState, ...labels: string[]): number[] =>
  labels.map((label) => indexOf(state, label)).sort((first, second) => first - second);

export function pressed(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
  return result.state;
}

/** Every unit of the round gets a distinct score ordered by a hash of round and name (`scoreByHash`). */
export function scoreRound(state: TournamentState, roundIndex: number): TournamentState {
  const { scores } = scoreByHash({ ...state, curRound: roundIndex }).state;
  return { ...state, scores };
}

export type Scorer = (state: TournamentState, roundIndex: number) => TournamentState;

/** Every room scored by seat, the same scores in every room and round: the places of different rooms tie in relative score. */
export function scoreBySeat(state: TournamentState, roundIndex: number): TournamentState {
  const scores = { ...state.scores };
  const position = new Map<number, number>();
  for (const entry of (state.assignments[roundIndex] ?? []).filter((candidate) => candidate.room !== null)) {
    const room = entry.room as number;
    const slot = position.get(room) ?? 0;
    position.set(room, slot + 1);
    scores[scoreKeysForPosition({ roundIndex, room, position: slot })[0]] = 1000 - 10 * slot;
  }
  return { ...state, scores };
}

/** The tournament as the first waterfall column is drawn, nothing of it scored. */
export function atEntry(count: number, graph: string, setup: Parameters<typeof buildQualWaterfall>[2] = {}) {
  return pressed(playToQualificationExit(buildQualWaterfall(count, graph, setup, { columns: true })));
}

export interface Draws {
  assignments: TournamentState['assignments'];
  byes: TournamentState['byes'];
  rooms: number[][];
  roomHistory: TournamentState['roomHistory'];
}

export const drawsOf = (state: TournamentState): Draws => ({
  assignments: state.assignments,
  byes: state.byes,
  rooms: state.rounds.map((round) => round.rooms),
  roomHistory: state.roomHistory,
});

export const onlyFinalInPlay = (state: TournamentState): boolean =>
  roundsInPlay(state).every((index) => state.rounds[index].isFinal);

export type Hook = (state: TournamentState) => TournamentState;

/** Column play to the Final: every round of the column scored, then Next Round. `after` runs after each advance. */
export function playColumns(
  start: TournamentState,
  after: Hook = (state) => state,
  score: Scorer = scoreRound,
): TournamentState {
  let state = start;
  for (let guard = 0; guard < 40 && !state.rounds[state.curRound].isFinal; guard += 1) {
    const column = [...Array(state.rounds.length).keys()].filter((index) =>
      roundsInPlay(state).includes(index),
    );
    for (const index of column) state = score(state, index);
    state = after(pressed(state));
  }
  return state;
}

/** Which of the rounds in play not yet scored a step scores before it presses Next Round. */
export type Strategy = (state: TournamentState, unscored: number[], step: number) => number[];

export const STRATEGIES: Record<string, Strategy> = {
  'all at once': (_state, unscored) => unscored,
  'one round at a time, forward': (_state, unscored) => unscored.slice(0, 1),
  'one round at a time, backward': (_state, unscored) => unscored.slice(-1),
  'a changing mix (1)': (_state, unscored, step) => mixOf(unscored, step, 1),
  'a changing mix (2)': (_state, unscored, step) => mixOf(unscored, step, 2),
};

function mixOf(unscored: number[], step: number, seed: number): number[] {
  const chosen = unscored.filter((index) => (index * 7 + step * 3 + seed) % 3 !== 0);
  return chosen.length > 0 ? chosen : unscored.slice(0, 1);
}

/** Dependency play to the Final: each step scores what `strategy` picks among the rounds in play, then presses. */
export function playDependency(
  start: TournamentState,
  strategy: Strategy,
  after: Hook = (state) => state,
  score: Scorer = scoreRound,
): TournamentState {
  let state = withDependencyPlay(start);
  for (let guard = 0; guard < 60 && !onlyFinalInPlay(state); guard += 1) {
    const unscored = roundsInPlay(state).filter(
      (index) => !state.rounds[index].isFinal && !isRoundScored(state, index),
    );
    for (const index of strategy(state, unscored, guard)) state = score(state, index);
    state = after(pressed(state));
  }
  expect(onlyFinalInPlay(state), 'the walk reached the Final').toBe(true);
  return state;
}

export const CASES = [
  { label: 'upper and lower, 37 players', count: 37, graph: UPPER_LOWER_GRAPH, setup: {} },
  { label: 'upper and lower, 43 players', count: 43, graph: UPPER_LOWER_GRAPH, setup: {} },
  { label: 'upper and lower, 53 players', count: 53, graph: UPPER_LOWER_GRAPH, setup: {} },
  { label: 'spreadsheet, 32 players', count: 32, graph: SPREADSHEET, setup: { qualAdv: '32' } },
  { label: 'spreadsheet, 37 players', count: 37, graph: SPREADSHEET, setup: { qualAdv: '32' } },
  { label: 'three chains, 31 players', count: 31, graph: THREE_CHAIN_GRAPH, setup: { qualAdv: '24' } },
];

/** The first game of a round's rooms scored with the same order every game, for the games listed (a Best of N). */
export function scoreGames(state: TournamentState, roundIndex: number, games: number[]): TournamentState {
  const all = scoreByHash({ ...state, curRound: roundIndex }).state.scores;
  const round = state.rounds[roundIndex];
  const scores = { ...state.scores };
  const position = new Map<number, number>();
  for (const entry of (state.assignments[roundIndex] ?? []).filter((candidate) => candidate.room !== null)) {
    const room = entry.room as number;
    const slot = position.get(room) ?? 0;
    position.set(room, slot + 1);
    const keys = scoreKeysForPosition({ roundIndex, room, position: slot, numGames: round.numGames ?? 1 });
    const first = all[keys[0]] ?? all[`r${roundIndex}-rm${room}-p${slot}`];
    for (const game of games) scores[keys[game - 1]] = first;
  }
  return { ...state, scores };
}

/** Scores a round with the fourth and fifth of every room level: a tie across the 1-4 / 5-8 boundary. */
export function scoreTied(state: TournamentState, roundIndex: number): TournamentState {
  const scored = scoreRound(state, roundIndex);
  const scores = { ...scored.scores };
  const byRoom = new Map<number, string[]>();
  const position = new Map<number, number>();
  for (const entry of (state.assignments[roundIndex] ?? []).filter((candidate) => candidate.room !== null)) {
    const room = entry.room as number;
    const slot = position.get(room) ?? 0;
    position.set(room, slot + 1);
    byRoom.set(room, [
      ...(byRoom.get(room) ?? []),
      scoreKeysForPosition({ roundIndex, room, position: slot })[0],
    ]);
  }
  for (const keys of byRoom.values()) {
    const ranked = [...keys].sort((first, second) => (scores[second] as number) - (scores[first] as number));
    scores[ranked[4]] = scores[ranked[3]];
  }
  return { ...scored, scores };
}

export function resolveEveryTie(state: TournamentState, roundIndex: number): TournamentState {
  let next = state;
  for (const [key, cluster] of Object.entries(getAllTies(state, roundIndex))) {
    for (const player of cluster.players) next = resolveTournamentTie(next, key, player.name);
  }
  return next;
}

/** Every unit once across the Rankings lists (the ones still playing, the finalists, the eliminated and the withdrawn). */
export function expectEveryUnitRankedOnce(state: TournamentState, count: number): void {
  const rankings = computeRankings(state);
  const names = [
    ...(rankings?.stillActive ?? []),
    ...(rankings?.finalists ?? []),
    ...(rankings?.eliminatedList ?? []),
    ...(rankings?.dnfList ?? []),
  ].map((unit) => unit.name);
  expect(new Set(names).size).toBe(names.length);
  expect(names).toHaveLength(count);
}

/**
 * A started tournament played through its pooling rounds (each scored with distinct scores, every tie resolved) and
 * into the first round of the bracket, drawn and not scored: the state a bracket walk starts from.
 */
export function playToBracketEntry(start: TournamentState): TournamentState {
  const last = start.rounds.findIndex((round) => round.isWaterfall) - 1;
  let state = start;
  for (let guard = 0; guard < 30 && state.curRound <= last; guard += 1) {
    state = pressed(resolveEveryTie(scoreRound(state, state.curRound), state.curRound));
  }
  return state;
}
