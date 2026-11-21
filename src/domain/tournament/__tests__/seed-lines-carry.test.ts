import { describe, expect, it } from 'vitest';
import { routeStandings } from '../bracket-replay';
import type { TournamentRound, TournamentStanding } from '../types';
import {
  atSwissExit,
  exitOrder,
  favouritesWin,
  indexOfLabel,
  pressed,
  roomNames,
} from './seed-lines-fixtures';

/** The seed a unit arrives with in a Custom bracket fed by a pooling phase: its place at the exit, or its source room's seed. */

const seedsOf = (assignments: Array<{ name: string; seed?: number }>) =>
  Object.fromEntries(assignments.map((entry) => [entry.name, entry.seed]));

describe('a qualifier carries its place at the exit', () => {
  it('routeStandings tags each arrival with seed = place and from = the pooling round', () => {
    const table = ['A', 'B', 'C'].map((name): TournamentStanding => ({
      name,
      totalFP: 0,
      totalScore: 0,
      played: 1,
      roomShare: 1,
    }));
    const round = { standingsRoutes: [4, 'eliminated', 4] } as unknown as TournamentRound;
    const routed = routeStandings(table, round, 2);
    expect(routed.get(4)?.map(({ name, seed, from }) => [name, seed, from])).toEqual([
      ['A', 1, 2],
      ['C', 3, 2],
    ]);
  });

  it('Qual 7-10 reach Round 6 with seeds 7-10, and Qual 1-6 wait for the Quarter-finals with seeds 1-6', () => {
    const exit = atSwissExit();
    const entered = pressed(exit);
    const order = exitOrder(entered);
    const round6 = entered.assignments[indexOfLabel(entered, 'R6')];
    expect(seedsOf(round6)).toEqual(
      Object.fromEntries([6, 7, 8, 9].map((place) => [order[place], place + 1])),
    );
    const waiting = entered.pendingBracketSeeds[indexOfLabel(entered, 'QF')] ?? [];
    expect(waiting.map(({ name, seed }) => [name, seed])).toEqual(
      [0, 1, 2, 3, 4, 5].map((place) => [order[place], place + 1]),
    );
    const poolingRound = entered.rounds.findIndex((round) => round.standingsRoutes);
    expect(new Set(waiting.map((entry) => entry.from))).toEqual(new Set([poolingRound]));
  });
});

describe('a room arrival carries its source room seed', () => {
  it('Round 6 room 1 (Qual 7 and 10) has seed 7 and room 2 (Qual 8 and 9) seed 8, for the winner and the loser alike', () => {
    const exit = atSwissExit();
    const entered = pressed(exit);
    const order = exitOrder(entered);
    expect(roomNames(entered, 'R6', 1)).toEqual([order[6], order[9]]);
    expect(roomNames(entered, 'R6', 2)).toEqual([order[7], order[8]]);
    const sent = pressed(favouritesWin(entered, 'R6'));
    const quarter = indexOfLabel(sent, 'QF');
    const losers = indexOfLabel(sent, 'R910');
    const round6 = indexOfLabel(sent, 'R6');
    const winners = sent.assignments[quarter].map((entry) => [entry.name, entry.seed]);
    expect(Object.fromEntries(winners)).toEqual({
      ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((place) => [order[place], place + 1])),
      [order[6]]: 7,
      [order[7]]: 8,
    });
    expect(seedsOf(sent.assignments[losers])).toEqual({ [order[9]]: 7, [order[8]]: 8 });
    expect(sent.rounds[round6].isWaterfall).toBe(true);
  });

  it('the Quarter-finals store seeds 1-8 and a winner and a loser of one room carry the same seed', () => {
    const sent = pressed(favouritesWin(pressed(atSwissExit()), 'R6'));
    const quarter = indexOfLabel(sent, 'QF');
    expect(sent.assignments[quarter].map((entry) => entry.seed).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const rooms = [1, 2, 3, 4].map((room) =>
      sent.assignments[quarter].filter((entry) => entry.room === room),
    );
    const roomSeed = rooms.map((room) => Math.min(...room.map((entry) => entry.seed as number)));
    const played = pressed(favouritesWin(sent, 'QF'));
    const upper = seedsOf(played.assignments[indexOfLabel(played, 'SF')]);
    const lower = seedsOf(played.assignments[indexOfLabel(played, 'R58')]);
    rooms.forEach((room, index) => {
      const [first, second] = [...room].sort((a, b) => (a.seed as number) - (b.seed as number));
      expect(upper[first.name]).toBe(roomSeed[index]);
      expect(lower[second.name]).toBe(roomSeed[index]);
    });
  });
});
