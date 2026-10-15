import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { computeRankings } from '../../domain/tournament/rankings';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { rankingsImageRows } from './rankings-image-rows';

/** Ten players: the first four reach a Final (single game), the other six went out in the first round. */
function state(finalScores: Record<string, number>) {
  const names = [
    'Player 10',
    'Player 9',
    'Player 3',
    'Player 1',
    'Player 2',
    'Player 4',
    'P5',
    'P6',
    'P7',
    'P8',
  ];
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [10], players: 10, advPerRoom: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames: 1 }),
    ],
    assignments: [
      names.map((name) => ({ name, room: 1, isLucky: false })),
      names.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
    ],
    scores: Object.fromEntries(names.map((_, index) => [`r0-rm1-p${index}`, 1000 - index * 100])),
    finalScores,
  });
}

function rowsOf(current: ReturnType<typeof state>) {
  const data = computeRankings(current);
  if (!data) throw new Error('no rankings');
  return rankingsImageRows(current, data);
}

describe('rankingsImageRows', () => {
  it('while the tournament runs: those still in alphabetically (numbers as numbers), then the eliminated by place', () => {
    const rows = rowsOf(state({}));
    expect(rows.slice(0, 4).map((row) => [row.rank, row.name])).toEqual([
      ['', 'Player 1'],
      ['', 'Player 3'],
      ['', 'Player 9'],
      ['', 'Player 10'],
    ]);
    expect(rows.slice(4).map((row) => [row.rank, row.name])).toEqual([
      ['5', 'Player 2'],
      ['6', 'Player 4'],
      ['7', 'P5'],
      ['8', 'P6'],
      ['9', 'P7'],
      ['10', 'P8'],
    ]);
    expect(rows.every((row) => row.medal === null)).toBe(true);
  });

  it('after the Final: everybody in order of place, a medal on the first three', () => {
    const rows = rowsOf(
      state({ 'game1-Player 10': 30, 'game1-Player 9': 90, 'game1-Player 3': 60, 'game1-Player 1': 10 }),
    );
    expect(rows.slice(0, 4).map((row) => [row.rank, row.name, row.medal, row.where])).toEqual([
      ['1', 'Player 9', 'gold', 'Final · 90'],
      ['2', 'Player 3', 'silver', 'Final · 60'],
      ['3', 'Player 10', 'bronze', 'Final · 30'],
      ['4', 'Player 1', null, 'Final · 4th'],
    ]);
    expect(rows).toHaveLength(10);
  });
});
