import { describe, expect, it } from 'vitest';
import { rosterKeys } from '../../domain/tournament/roster';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentTeam } from '../../domain/tournament/types';
import { registeredLine, rosterRows } from './players-line';

const players = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);
const teams = (count: number): TournamentTeam[] =>
  Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `a${index}` }, { name: `b${index}` }],
  }));

describe('registeredLine', () => {
  it('counts the players and says when the tournament starts', () => {
    const state = createDefaultTournamentState({ gameFormat: 'ffa-individual', players: players(37) });
    expect(registeredLine(state, 'Sat 18 Oct, 20:00')).toBe(
      '37 players registered so far · starts Sat 18 Oct, 20:00',
    );
  });

  it('stops after "so far" without a start time', () => {
    const state = createDefaultTournamentState({ gameFormat: 'ffa-individual', players: players(43) });
    expect(registeredLine(state, null)).toBe('43 players registered so far');
  });

  it('counts teams in a team format, 13 of them', () => {
    const state = createDefaultTournamentState({ gameFormat: 'team-2v2v2v2', players: teams(13) });
    expect(registeredLine(state, 'Sat 18 Oct, 20:00')).toBe(
      '13 teams registered so far · starts Sat 18 Oct, 20:00',
    );
  });

  it('uses the singular for one', () => {
    expect(
      registeredLine(
        createDefaultTournamentState({ gameFormat: 'ffa-individual', players: players(1) }),
        null,
      ),
    ).toBe('1 player registered so far');
    expect(
      registeredLine(createDefaultTournamentState({ gameFormat: 'team-2v2v2v2', players: teams(1) }), null),
    ).toBe('1 team registered so far');
  });

  it('does not count the reserves', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: players(31),
      reserves: ['R1', 'R2'],
    });
    expect(registeredLine(state, null)).toBe('31 players registered so far');
  });
});

describe('rosterRows', () => {
  it('lists the roster alphabetically, numbers inside names counted as numbers (31 players)', () => {
    const registered = ['Player 10', 'Player 9', 'Ash', 'Player 1', ...players(27)];
    const state = createDefaultTournamentState({ gameFormat: 'ffa-individual', players: registered });
    const rows = rosterRows(state, rosterKeys(state.players), 'alphabetical');
    expect(rows).toHaveLength(31);
    expect(rows.slice(0, 4).map((row) => [row.number, row.label])).toEqual([
      ['1', 'Ash'],
      ['2', 'P1'],
      ['3', 'P2'],
      ['4', 'P3'],
    ]);
    const labels = rows.map((row) => row.label);
    expect(labels.indexOf('Player 9')).toBeLessThan(labels.indexOf('Player 10'));
    expect(labels.indexOf('Player 1')).toBeLessThan(labels.indexOf('Player 9'));
  });

  it('sorts teams by the team name shown, not by the order they registered in (13 teams)', () => {
    const named = teams(13).map((team, index) => ({ ...team, teamName: `Crew ${13 - index}` }));
    const state = createDefaultTournamentState({ gameFormat: 'team-2v2v2v2', players: named });
    const rows = rosterRows(state, rosterKeys(state.players), 'alphabetical');
    expect(rows.map((row) => row.label).slice(0, 3)).toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
    expect(rows[0]?.members).toEqual(['a12', 'b12']);
  });

  it('keeps the reserves in waiting order', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: players(31),
      reserves: ['Wren', 'Ash', 'Moss'],
    });
    expect(rosterRows(state, ['Wren', 'Ash', 'Moss'], 'as-listed').map((row) => row.label)).toEqual([
      'Wren',
      'Ash',
      'Moss',
    ]);
  });
});
