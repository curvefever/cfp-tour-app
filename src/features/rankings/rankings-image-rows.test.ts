import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { computeRankings } from '../../domain/tournament/rankings';
import { scoreKeysForPosition } from '../../domain/tournament/scoring';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentTeam, TournamentState, WithdrawnUnit } from '../../domain/tournament/types';
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

/** Six teams of three: t1-t4 reach a single-game Final (t1 wins), t5 and t6 went out in the first round. */
function teamsFinished(finalScores: Record<string, number> = {}): TournamentState {
  const teams: TournamentTeam[] = Array.from({ length: 6 }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c'].map((letter) => ({ name: `${letter}${index + 1}` })),
  }));
  const scores: Record<string, number> = {};
  teams.forEach((_team, position) => {
    scoreKeysForPosition({ roundIndex: 0, room: 1, position, numGames: 1, teamSize: 3 }).forEach((key) => {
      scores[key] = 600 - position * 100;
    });
  });
  return createDefaultTournamentState({
    gameFormat: 'team-3v3v3',
    players: teams,
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [6], players: 6, advPerRoom: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames: 1 }),
    ],
    assignments: [
      teams.map((team) => ({ name: team.teamId, room: 1, isLucky: false })),
      teams.slice(0, 4).map((team) => ({ name: team.teamId, room: 1, isLucky: false })),
    ],
    scores,
    finalScores,
  });
}

const membersOf = (rows: ReturnType<typeof rowsOf>) =>
  Object.fromEntries(rows.map((row) => [row.name, row.members]));

describe('rankingsImageRows members', () => {
  it('while a team tournament runs: those still in and the eliminated carry their members', () => {
    const rows = rowsOf(teamsFinished());
    expect(rows).toHaveLength(6);
    expect(membersOf(rows)).toEqual({
      'Team 1': ['a1', 'b1', 'c1'],
      'Team 2': ['a2', 'b2', 'c2'],
      'Team 3': ['a3', 'b3', 'c3'],
      'Team 4': ['a4', 'b4', 'c4'],
      'Team 5': ['a5', 'b5', 'c5'],
      'Team 6': ['a6', 'b6', 'c6'],
    });
  });

  it('a withdrawn team that played carries its members', () => {
    const withdrawn: WithdrawnUnit = {
      name: 't7',
      label: 'Team 7',
      members: ['a7', 'b7', 'c7'],
      playedAnyMatch: true,
      reason: 'removed',
    };
    const rows = rowsOf({ ...teamsFinished(), withdrawnUnits: [withdrawn] });
    expect(rows.at(-1)).toMatchObject({ rank: '—', name: 'Team 7', members: ['a7', 'b7', 'c7'] });
  });

  it('after the Final: the lines after the podium carry their members', () => {
    const finalScores = Object.fromEntries(
      [10, 8, 6, 4].flatMap((total, index) =>
        [0, 1, 2].map((member) => [`game1-t${index + 1}-m${member}`, total]),
      ),
    );
    const rows = rowsOf(teamsFinished(finalScores));
    expect(rows.map((row) => [row.name, row.members])).toEqual([
      ['Team 4', ['a4', 'b4', 'c4']],
      ['Team 5', ['a5', 'b5', 'c5']],
      ['Team 6', ['a6', 'b6', 'c6']],
    ]);
  });

  it('an individual format has no members: every list carries null', () => {
    const inPlayRows = rowsOf(state({}));
    expect(inPlayRows.every((row) => row.members === null)).toBe(true);
    const finishedRows = rowsOf(
      state({ 'game1-Player 10': 30, 'game1-Player 9': 90, 'game1-Player 3': 60, 'game1-Player 1': 10 }),
    );
    expect(finishedRows.every((row) => row.members === null)).toBe(true);
  });
});
