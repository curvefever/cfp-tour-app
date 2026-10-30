import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { oneRoomState } from '../../domain/tournament/__tests__/test-fixtures';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import {
  gameScoreLayout,
  luckyLoserNames,
  roomGameScores,
  unitScoreSummary,
  winsSoFar,
} from './room-row-inputs';

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

describe('roomGameScores', () => {
  const key = (position: number, game: number, member?: number) =>
    `r0-rm1-p${position}-g${game}${member === undefined ? '' : `-m${member}`}`;

  it('reads each game of a summed 3-game round, with a dash (null) for a game not typed yet', () => {
    const state = oneRoomState({
      players: ['A', 'B'],
      rounds: [{ numGames: 3 }, {}],
      scores: { [key(0, 1)]: 200, [key(1, 1)]: 150, [key(0, 2)]: 120 },
    });
    expect(roomGameScores(state, 0, 1, 0)).toEqual([200, 120, null]);
    expect(roomGameScores(state, 0, 1, 1)).toEqual([150, null, null]);
  });

  it('gives null for the game a decided Best of 3 does not need', () => {
    const state = oneRoomState({
      players: ['A', 'B'],
      rounds: [{ bestOf: 3, numGames: 3, isWaterfall: true }, {}],
      scores: { [key(0, 1)]: 30, [key(1, 1)]: 10, [key(0, 2)]: 25, [key(1, 2)]: 5, [key(0, 3)]: 99 },
    });
    expect(roomGameScores(state, 0, 1, 0)).toEqual([30, 25, null]);
    expect(roomGameScores(state, 0, 1, 1)).toEqual([10, 5, null]);
  });

  it('gives 4 games for a Best of 3 in a room of 3 teams', () => {
    const state = oneRoomState({
      players: ['A', 'B', 'C'],
      rounds: [{ bestOf: 3, numGames: 4, isWaterfall: true }, {}],
      scores: { [key(0, 1)]: 3, [key(1, 1)]: 2, [key(2, 1)]: 1 },
    });
    expect(roomGameScores(state, 0, 1, 2)).toEqual([1, null, null, null]);
  });

  describe('in a team format', () => {
    const teams: TournamentTeam[] = ['t1', 't2'].map((teamId) => ({
      teamId,
      teamName: teamId,
      members: ['a', 'b', 'c', 'd'].map((member) => ({ name: `${teamId}${member}` })),
    }));
    const options = { gameFormat: 'team-4v4' as const, players: teams, rounds: [{ numGames: 2 }, {}] };

    it('reads one score per team under the survival rule', () => {
      const state = oneRoomState({
        ...options,
        rule: 'survival-teams',
        scores: { [key(0, 1)]: 40, [key(1, 1)]: 25, [key(0, 2)]: 10 },
      });
      expect(roomGameScores(state, 0, 1, 0)).toEqual([40, 10]);
      expect(roomGameScores(state, 0, 1, 1)).toEqual([25, null]);
    });

    it('adds the members of a team under sum of members, and waits for every member', () => {
      const members = (position: number, game: number, values: number[]) =>
        Object.fromEntries(values.map((value, member) => [key(position, game, member), value]));
      const state = oneRoomState({
        ...options,
        rule: 'sum-members',
        scores: { ...members(0, 1, [10, 20, 30, 40]), ...members(0, 2, [1, 2]) },
      });
      expect(roomGameScores(state, 0, 1, 0)).toEqual([100, null]);
    });
  });

  it('is empty on a single-game round', () => {
    const state = oneRoomState({ players: ['A', 'B'], scores: { 'r0-rm1-p0': 3 } });
    expect(roomGameScores(state, 0, 1, 0)).toEqual([]);
  });
});

describe('gameScoreLayout', () => {
  it('shows nothing for one game, columns for 2 to 4, and a line from 5', () => {
    expect([1, 2, 4, 5, 7].map(gameScoreLayout)).toEqual(['none', 'columns', 'columns', 'line', 'line']);
  });
});
