import { describe, expect, it } from 'vitest';
import { bestOfGameCount } from '../match-format';
import { gameColumnLabel, roomGameColumns } from '../game-columns';
import type { TournamentState } from '../types';
import { oneRoomState } from './test-fixtures';

/** One room (round 1), Best of `bestOf`, with `games[g]` the scores of game g + 1 in seat order. */
function bestOfRoom(names: string[], bestOf: number, games: number[][]): TournamentState {
  const scores: Record<string, number> = {};
  games.forEach((row, game) =>
    row.forEach((value, position) => {
      scores[`r0-rm1-p${position}-g${game + 1}`] = value;
    }),
  );
  return oneRoomState({
    players: names,
    rounds: [{ bestOf, numGames: bestOfGameCount(bestOf, names.length), isWaterfall: true }, {}],
    scores,
  });
}

const labelsOf = (state: TournamentState) => roomGameColumns(state, 0, 1).map(gameColumnLabel);
const PAIR = ['A', 'B'];
const EIGHT = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);

/** The unit at `winner` scores highest, the others by seat. */
const wonBy = (winner: number, size: number): number[] =>
  Array.from({ length: size }, (_, index) => (index === winner ? 100 : 10 + index));

describe('the columns of a Best-of room', () => {
  it('1v1 Best of 5 won 3-0: G1 G2 G3, then G4–5 shared and marked as never played', () => {
    const state = bestOfRoom(PAIR, 5, [wonBy(0, 2), wonBy(0, 2), wonBy(0, 2)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3', 'G4–5']);
    expect(roomGameColumns(state, 0, 1).at(-1)).toEqual({ kind: 'rest', from: 4, to: 5, decided: true });
  });

  it('1v1 Best of 3 won 2-1: every game was played, no shared column', () => {
    const state = bestOfRoom(PAIR, 3, [wonBy(0, 2), wonBy(1, 2), wonBy(0, 2)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3']);
    expect(roomGameColumns(state, 0, 1).every((column) => column.kind === 'game')).toBe(true);
  });

  it('FFA Best of 3 in a room of 8 decided at game 2: G1 G2, then G3–9', () => {
    const state = bestOfRoom(EIGHT, 3, [wonBy(0, 8), wonBy(0, 8)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3–9']);
    expect(roomGameColumns(state, 0, 1).at(-1)).toEqual({ kind: 'rest', from: 3, to: 9, decided: true });
  });

  it('the same room after game 1, still undecided: G1, then G2–9, not decided', () => {
    const state = bestOfRoom(EIGHT, 3, [wonBy(0, 8)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2–9']);
    expect(roomGameColumns(state, 0, 1).at(-1)).toEqual({ kind: 'rest', from: 2, to: 9, decided: false });
  });

  it('the same room played to game 9: G1 to G9, no shared column', () => {
    const games = Array.from({ length: 9 }, (_, game) => wonBy(game % 8, 8));
    const state = bestOfRoom(EIGHT, 3, games);
    expect(labelsOf(state)).toEqual(Array.from({ length: 9 }, (_, index) => `G${index + 1}`));
  });

  it('one game left reads "G3", not a range', () => {
    const state = bestOfRoom(PAIR, 3, [wonBy(0, 2), wonBy(1, 2)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3']);
    expect(roomGameColumns(state, 0, 1).at(-1)).toEqual({ kind: 'rest', from: 3, to: 3, decided: false });
  });

  it('a room nobody has scored yet is one column of all its games', () => {
    expect(labelsOf(bestOfRoom(EIGHT, 3, []))).toEqual(['G1–9']);
  });

  it('a game being played (scores typed for some units) already has its column', () => {
    const state = bestOfRoom(PAIR, 5, [wonBy(0, 2), [40]]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3–5']);
  });

  it('a game typed after the deciding game counts for nothing', () => {
    const state = bestOfRoom(PAIR, 3, [wonBy(0, 2), wonBy(0, 2), wonBy(1, 2)]);
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3']);
  });
});

describe('the columns of the other rounds', () => {
  it('a summed round of 4 games shows all four, none shared', () => {
    const state = oneRoomState({ players: EIGHT, rounds: [{ numGames: 4 }, {}] });
    expect(labelsOf(state)).toEqual(['G1', 'G2', 'G3', 'G4']);
  });

  it('a round of one game has none', () => {
    expect(labelsOf(oneRoomState({ players: EIGHT }))).toEqual([]);
  });

  it('a Final of one game shows its game', () => {
    const state = oneRoomState({ players: EIGHT, rounds: [{ isFinal: true, numGames: 1 }, {}] });
    expect(labelsOf(state)).toEqual(['G1']);
  });

  it('a round that does not exist has none', () => {
    expect(roomGameColumns(oneRoomState({ players: EIGHT }), 9, 1)).toEqual([]);
  });
});
