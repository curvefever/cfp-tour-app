import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { oneRoomState } from '../../domain/tournament/__tests__/test-fixtures';
import type { TournamentState } from '../../domain/tournament/types';
import { luckyLoserNames, unitScoreSummary, winsSoFar } from './room-row-inputs';

describe('luckyLoserNames', () => {
  const state = createDefaultTournamentState({
    rounds: [
      buildRound({ roundNum: 1, rooms: [4], players: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4 }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, winnersTo: 0 }),
    ],
    luckyLosers: [['P9'], ['P1', 'P2']],
  });

  it('reads the lucky losers of the next round', () => {
    expect(luckyLoserNames(state, 0)).toEqual(['P1', 'P2']);
  });

  it('follows the round the winners go to when it is not the next one', () => {
    expect(luckyLoserNames(state, 2)).toEqual(['P9']);
  });

  it('is empty when none are named', () => {
    expect(luckyLoserNames(state, 1)).toEqual([]);
  });
});

describe('on a Best-of room', () => {
  function bestOfRoom(games: number[][]): TournamentState {
    const scores: Record<string, number> = {};
    games.forEach((row, game) =>
      row.forEach((value, position) => {
        scores[`r0-rm1-p${position}-g${game + 1}`] = value;
      }),
    );
    return oneRoomState({
      players: ['A', 'B'],
      rounds: [{ bestOf: 3, numGames: 3, isWaterfall: true }, {}],
      scores,
    });
  }

  it('sums the total of a summed round and counts the wins of a Best of', () => {
    const summed = oneRoomState({
      players: ['A', 'B'],
      rounds: [{ numGames: 2 }, {}],
      scores: { 'r0-rm1-p0-g1': 10, 'r0-rm1-p0-g2': 5, 'r0-rm1-p1-g1': 1, 'r0-rm1-p1-g2': 1 },
    });
    expect(unitScoreSummary(summed, 0, 1, 0)).toEqual({ label: 'Total', value: 15 });
    const state = bestOfRoom([
      [10, 5],
      [8, 3],
    ]);
    expect(unitScoreSummary(state, 0, 1, 0)).toEqual({ label: 'Wins', value: 2 });
    expect(unitScoreSummary(state, 0, 1, 1)).toEqual({ label: 'Wins', value: 0 });
  });

  it('counts the games won so far, and nothing outside a Best of or before a game counts', () => {
    expect(winsSoFar(bestOfRoom([[10, 5]]), 0, 1, 0)).toBe(1);
    expect(winsSoFar(bestOfRoom([[10, 5]]), 0, 1, 1)).toBe(0);
    expect(winsSoFar(bestOfRoom([]), 0, 1, 0)).toBeNull();
    expect(winsSoFar(oneRoomState({ players: ['A', 'B'], scores: { 'r0-rm1-p0': 3 } }), 0, 1, 0)).toBeNull();
  });
});
