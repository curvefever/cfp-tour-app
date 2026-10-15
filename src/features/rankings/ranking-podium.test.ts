import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { computeRankings } from '../../domain/tournament/rankings';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { finalStanding } from './ranking-podium';

/** Six players: P1-P4 play a Final (a given number of games), P5 and P6 went out in the first round. */
function finalState(
  finalScores: Record<string, number>,
  numGames: number,
  extra: Partial<TournamentState> = {},
): TournamentState {
  const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [6], players: 6, advPerRoom: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames }),
    ],
    assignments: [
      names.map((name) => ({ name, room: 1, isLucky: false })),
      names.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
    ],
    scores: Object.fromEntries(names.map((_, index) => [`r0-rm1-p${index}`, 600 - index * 100])),
    finalScores,
    ...extra,
  });
}

function standingOf(state: TournamentState) {
  const data = computeRankings(state);
  if (!data) throw new Error('no rankings');
  return finalStanding(state, data);
}

describe('finalStanding', () => {
  const threeGames = {
    'game1-P1': 100,
    'game2-P1': 120,
    'game3-P1': 109,
    'game1-P2': 200,
    'game2-P2': 90,
    'game3-P2': 139,
    'game1-P3': 60,
    'game2-P3': 70,
    'game3-P3': 80,
    'game1-P4': 10,
    'game2-P4': 20,
    'game3-P4': 30,
  };

  it('stands the podium second, first, third, with the Final line from the total and the game count', () => {
    const { podium } = standingOf(finalState(threeGames, 3));
    expect(podium.map((card) => [card.rank, card.label, card.medal, card.line])).toEqual([
      [2, 'P1', 'silver', 'Final · 329 over 3 games'],
      [1, 'P2', 'gold', 'Final · 429 over 3 games'],
      [3, 'P3', 'bronze', 'Final · 210 over 3 games'],
    ]);
  });

  it('gives the first three again in order of place', () => {
    const { top } = standingOf(finalState(threeGames, 3));
    expect(top.map((card) => [card.rank, card.label])).toEqual([
      [1, 'P2'],
      [2, 'P1'],
      [3, 'P3'],
    ]);
  });

  it('lists the rest from the fourth entry down, ranked, with where each stood', () => {
    const { rest } = standingOf(finalState(threeGames, 3));
    expect(rest.map((row) => [row.rank, row.label, row.where])).toEqual([
      ['4', 'P4', 'Final · 4th'],
      ['5', 'P5', 'Round 1 · Room A · 5th'],
      ['6', 'P6', 'Round 1 · Room A · 6th'],
    ]);
  });

  it('writes a single-game Final without a game count', () => {
    const { podium } = standingOf(
      finalState({ 'game1-P1': 50, 'game1-P2': 80, 'game1-P3': 40, 'game1-P4': 30 }, 1),
    );
    expect(podium[1].line).toBe('Final · 80');
  });

  it('gives units level on a rank the same number, podium included, and skips the next', () => {
    const level = { 'game1-P1': 80, 'game1-P2': 80, 'game1-P3': 40, 'game1-P4': 30 };
    const { podium, rest } = standingOf(finalState(level, 1));
    expect(podium.map((card) => [card.label, card.rank, card.medal])).toEqual([
      ['P2', 1, 'gold'],
      ['P1', 1, 'gold'],
      ['P3', 3, 'bronze'],
    ]);
    expect(rest[0].rank).toBe('4');
  });

  it('puts a unit that withdrew after playing last in the list, with no number', () => {
    const withdrawn = [
      { name: 'P7', label: 'P7', members: null, playedAnyMatch: true, reason: 'removed' as const },
    ];
    const { rest } = standingOf(finalState(threeGames, 3, { withdrawnUnits: withdrawn }));
    expect(rest.at(-1)).toMatchObject({ rank: '—', label: 'P7', where: 'Withdrawn' });
    expect(rest.slice(0, -1).every((row) => row.rank !== '—')).toBe(true);
  });

  it('lets a unit eliminated earlier stand on the podium when the Final had only two', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], players: 4, advPerRoom: 2 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, isFinal: true, numGames: 1 }),
      ],
      assignments: [
        ['P1', 'P2', 'P3', 'P4'].map((name) => ({ name, room: 1, isLucky: false })),
        ['P1', 'P2'].map((name) => ({ name, room: 1, isLucky: false })),
      ],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
      finalScores: { 'game1-P1': 50, 'game1-P2': 80 },
    });
    const { podium, rest } = standingOf(state);
    expect(podium.map((card) => [card.rank, card.label, card.line])).toEqual([
      [2, 'P1', 'Final · 50'],
      [1, 'P2', 'Final · 80'],
      [3, 'P3', 'Round 1 · Room A · 3rd'],
    ]);
    expect(rest.map((row) => row.label)).toEqual(['P4']);
  });
});
