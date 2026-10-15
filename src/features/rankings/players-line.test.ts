import { describe, expect, it } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentTeam } from '../../domain/tournament/types';
import { registeredLine } from './players-line';

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
