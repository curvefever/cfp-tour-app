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

/** `count` players: P1-P4 play a single-game Final, the others went out in the first round (P5 first). */
function finishedOf(count: number, finalScores: Record<string, number>) {
  const names = Array.from({ length: count }, (_, index) => `P${index + 1}`);
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [count], players: count, advPerRoom: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames: 1 }),
    ],
    assignments: [
      names.map((name) => ({ name, room: 1, isLucky: false })),
      names.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
    ],
    scores: Object.fromEntries(names.map((_, index) => [`r0-rm1-p${index}`, 5000 - index * 10])),
    finalScores,
  });
}

function rowsOf(current: ReturnType<typeof state>) {
  const data = computeRankings(current);
  if (!data) throw new Error('no rankings');
  return rankingsImageRows(current, data);
}

describe('rankingsImageRows', () => {
  it('while the round that eliminated them is still in play: "—" for a rank, and the same where line', () => {
    const advanced = state({});
    const inPlay = { ...advanced, curRound: 0, assignments: [advanced.assignments[0], []] };
    const rows = rowsOf(inPlay).slice(4);
    expect(rows.map((row) => [row.rank, row.name])).toEqual([
      ['—', 'Player 2'],
      ['—', 'Player 4'],
      ['—', 'P5'],
      ['—', 'P6'],
      ['—', 'P7'],
      ['—', 'P8'],
    ]);
    expect(rows.map((row) => row.where)).toEqual(
      rowsOf(advanced)
        .slice(4)
        .map((row) => row.where),
    );
  });

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
  });

  it('after the Final: the lines after the podium, from the fourth entry down', () => {
    const rows = rowsOf(
      state({ 'game1-Player 10': 30, 'game1-Player 9': 90, 'game1-Player 3': 60, 'game1-Player 1': 10 }),
    );
    expect(rows.slice(0, 2).map((row) => [row.rank, row.name, row.where])).toEqual([
      ['4', 'Player 1', 'Final · 4th'],
      ['5', 'Player 2', expect.any(String)],
    ]);
    expect(rows).toHaveLength(7);
  });

  it('after the Final of 37 units: 34 lines, the first one the fourth place', () => {
    const rows = rowsOf(finishedOf(37, { 'game1-P1': 40, 'game1-P2': 30, 'game1-P3': 20, 'game1-P4': 10 }));
    expect(rows).toHaveLength(34);
    expect(rows[0]).toMatchObject({ rank: '4', name: 'P4' });
    expect(rows.at(-1)).toMatchObject({ rank: '37', name: 'P37' });
  });

  it('after a Final with a shared third place: the second unit on third place opens the list', () => {
    const rows = rowsOf(finishedOf(31, { 'game1-P1': 40, 'game1-P2': 30, 'game1-P3': 20, 'game1-P4': 20 }));
    expect(rows).toHaveLength(28);
    expect(rows[0]).toMatchObject({ rank: '3', name: 'P4' });
  });
});
