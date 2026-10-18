import { describe, expect, it } from 'vitest';
import {
  isConfirmed,
  moveConfirmation,
  rosterConfirmationSummary,
  setConfirmed,
  teamConfirmation,
} from '../confirmations';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentState, TournamentTeam } from '../types';

const names = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);

function confirm(state: TournamentState, ...who: string[]): TournamentState {
  return who.reduce((current, name) => setConfirmed(current, name, true), state);
}

function threeTeams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `T${index + 1}a` }, { name: `T${index + 1}b` }, { name: `T${index + 1}c` }],
  }));
}

describe('setConfirmed / isConfirmed', () => {
  it('confirms a name, and unconfirming deletes the key rather than storing false', () => {
    const state = createDefaultTournamentState({ players: names(3) });
    const confirmed = setConfirmed(state, 'P2', true);
    expect(isConfirmed(confirmed, 'P2')).toBe(true);
    expect(isConfirmed(confirmed, 'P1')).toBe(false);
    const undone = setConfirmed(confirmed, 'P2', false);
    expect(undone.confirmations).toEqual({});
    expect(Object.keys(undone.confirmations)).toHaveLength(0);
  });

  it('returns the same state object when nothing changes', () => {
    const state = createDefaultTournamentState({ players: names(3) });
    expect(setConfirmed(state, 'P1', false)).toBe(state);
    const confirmed = setConfirmed(state, 'P1', true);
    expect(setConfirmed(confirmed, 'P1', true)).toBe(confirmed);
  });

  it('does not touch the state it was given', () => {
    const state = createDefaultTournamentState({ players: names(3) });
    setConfirmed(state, 'P1', true);
    expect(state.confirmations).toEqual({});
  });

  it('is not fooled by a name that is also an Object.prototype member', () => {
    const state = createDefaultTournamentState({ players: ['constructor', 'toString'] });
    expect(isConfirmed(state, 'constructor')).toBe(false);
    expect(isConfirmed(setConfirmed(state, 'constructor', true), 'constructor')).toBe(true);
  });
});

describe('moveConfirmation', () => {
  it('moves a confirmed name to its new spelling and leaves others alone', () => {
    const state = confirm(createDefaultTournamentState(), 'Old', 'Other');
    const moved = moveConfirmation(state, 'Old', 'New');
    expect(moved.confirmations).toEqual({ New: true, Other: true });
  });

  it('is a no-op for a name that is not confirmed', () => {
    const state = confirm(createDefaultTournamentState(), 'Other');
    expect(moveConfirmation(state, 'Old', 'New')).toBe(state);
  });
});

describe('teamConfirmation', () => {
  it('is none, some or all over the members', () => {
    const [team] = threeTeams(1);
    const base = createDefaultTournamentState({ players: [team] });
    expect(teamConfirmation(base, team)).toEqual({ confirmed: 0, total: 3, level: 'none' });
    expect(teamConfirmation(confirm(base, 'T1a'), team)).toEqual({ confirmed: 1, total: 3, level: 'some' });
    expect(teamConfirmation(confirm(base, 'T1a', 'T1b', 'T1c'), team)).toEqual({
      confirmed: 3,
      total: 3,
      level: 'all',
    });
  });

  it('does not count a vacant slot: two confirmed members of a team of 3 with one slot open is all', () => {
    const team: TournamentTeam = {
      teamId: 't1',
      teamName: 'Team 1',
      members: [{ name: 'A' }, null, { name: 'C' }],
    };
    const state = confirm(createDefaultTournamentState({ players: [team] }), 'A', 'C');
    expect(teamConfirmation(state, team)).toEqual({ confirmed: 2, total: 2, level: 'all' });
  });

  it('is none for a team with no members', () => {
    const team: TournamentTeam = { teamId: 't1', teamName: 'Team 1', members: [null, null] };
    expect(teamConfirmation(createDefaultTournamentState({ players: [team] }), team)).toEqual({
      confirmed: 0,
      total: 0,
      level: 'none',
    });
  });

  it('follows the member name, not the team name or id', () => {
    const [team] = threeTeams(1);
    const state = confirm(createDefaultTournamentState({ players: [team] }), 'Team 1', 't1');
    expect(teamConfirmation(state, team).level).toBe('none');
  });
});

describe('rosterConfirmationSummary', () => {
  it('counts the confirmed players of 37, reserves not included', () => {
    const state = confirm(
      createDefaultTournamentState({ players: names(37), reserves: ['R1', 'R2'] }),
      'P1',
      'P20',
      'P37',
      'R1',
    );
    expect(rosterConfirmationSummary(state)).toEqual({ confirmed: 3, total: 37 });
  });

  it('ignores a confirmed name that is not on the roster', () => {
    const state = confirm(createDefaultTournamentState({ players: names(37) }), 'Gone');
    expect(rosterConfirmationSummary(state)).toEqual({ confirmed: 0, total: 37 });
  });

  it('counts teams and players for 13 teams of 3', () => {
    const teams = threeTeams(13);
    const state = confirm(
      createDefaultTournamentState({ players: teams }),
      // team 1 fully, team 2 two of three, team 3 one of three
      'T1a',
      'T1b',
      'T1c',
      'T2a',
      'T2b',
      'T3a',
    );
    expect(rosterConfirmationSummary(state)).toEqual({
      confirmed: 6,
      total: 39,
      teamsConfirmed: 1,
      teams: 13,
    });
  });

  it('is zero over zero for an empty roster', () => {
    expect(rosterConfirmationSummary(createDefaultTournamentState())).toEqual({ confirmed: 0, total: 0 });
  });
});
