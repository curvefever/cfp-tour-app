import { describe, expect, it } from 'vitest';
import {
  confirmationSource,
  isConfirmed,
  moveConfirmation,
  rosterConfirmationSummary,
  scoredPlayers,
  setConfirmed,
  teamConfirmation,
} from '../confirmations';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentState, TournamentTeam } from '../types';
import { buildRound } from './test-fixtures';

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

/** Seats `units` over `roomCount` rooms in turn: unit i sits in room i % roomCount at position floor(i / roomCount). */
function seat(units: string[], roomCount: number) {
  return units.map((name, index) => ({
    name,
    room: (index % roomCount) + 1,
    position: Math.floor(index / roomCount),
  }));
}

const key = (roundIndex: number, seated: { room: number; position: number }, suffix = '') =>
  `r${roundIndex}-rm${seated.room}-p${seated.position}${suffix}`;

describe('scoredPlayers, individual formats', () => {
  const players = names(37);
  const seated = seat(players, 5);
  const base = () =>
    createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players,
      rounds: [buildRound({ roundNum: 1, rooms: [8, 8, 7, 7, 7], players: 37, isQual: true })],
      assignments: [seated.map(({ name, room }) => ({ name, room, isLucky: false }))],
    });

  it('37 players: a score above 0 confirms, a 0 and an empty field do not', () => {
    const state = {
      ...base(),
      // P1 typed 0 (a no-show), P2 scored, P3 left empty; P37 sits at position 7 of room 2
      scores: {
        [key(0, seated[0])]: 0,
        [key(0, seated[1])]: 50,
        [key(0, seated[36])]: 3,
        [key(0, seated[2])]: null,
      },
    };
    expect([...scoredPlayers(state)].sort()).toEqual(['P2', 'P37']);
    expect(confirmationSource(state, 'P2')).toBe('score');
    expect(confirmationSource(state, 'P1')).toBeNull();
    expect(confirmationSource(state, 'P3')).toBeNull();
  });

  it('a score wins over a manual mark, and the manual mark shows again once the score is corrected to 0', () => {
    const marked = setConfirmed({ ...base(), scores: { [key(0, seated[1])]: 50 } }, 'P2', true);
    expect(confirmationSource(marked, 'P2')).toBe('score');
    const corrected = { ...marked, scores: { [key(0, seated[1])]: 0 } };
    expect(confirmationSource(corrected, 'P2')).toBe('manual');
    expect(confirmationSource({ ...corrected, confirmations: {} }, 'P2')).toBeNull();
  });

  it('counts scored players in the header summary with the manual ones, once each', () => {
    const scores = { [key(0, seated[1])]: 10, [key(0, seated[4])]: 10 };
    const state = confirm({ ...base(), scores }, 'P2', 'P9');
    expect(rosterConfirmationSummary(state)).toEqual({ confirmed: 3, total: 37 });
  });

  it('counts a game-split round: a score in game 2 is enough', () => {
    const state = {
      ...base(),
      rounds: [buildRound({ roundNum: 1, rooms: [8, 8, 7, 7, 7], players: 37, isSemis: true, numGames: 2 })],
      scores: { [key(0, seated[6], '-g2')]: 4, [key(0, seated[7], '-g1')]: 0 },
    };
    expect([...scoredPlayers(state)]).toEqual(['P7']);
  });

  it('ignores a unit seated without a room', () => {
    const state = {
      ...base(),
      assignments: [[{ name: 'P1', room: null }, ...base().assignments[0].slice(1)]],
      scores: { 'r0-rmnull-p0': 5 },
    };
    expect(scoredPlayers(state).has('P1')).toBe(false);
  });

  it('a Final score above 0 confirms the finalist, in any game and through an anonymous alias', () => {
    const state = {
      ...createDefaultTournamentState({ gameFormat: 'ffa-individual', players: names(4) }),
      rounds: [
        buildRound({ roundNum: 1, rooms: [4], players: 4, isFinal: true, numGames: 3, anonymousGames: [1] }),
      ],
      assignments: [names(4).map((name) => ({ name, room: 1, isLucky: false }))],
      anonymousFinalists: [{ alias: 'Finalist-1', realKey: 'P3', connected: false }],
      finalScores: { 'game2-P1': 5, 'game2-P2': 0, 'game1-Finalist-1': 9 } as TournamentState['finalScores'],
    };
    expect([...scoredPlayers(state)].sort()).toEqual(['P1', 'P3']);
  });
});

describe('scoredPlayers, team formats', () => {
  const teams = threeTeams(13).map((team) => ({ ...team, members: team.members.slice(0, 2) }));
  const seated = seat(
    teams.map((team) => team.teamId),
    4,
  );
  const base = (rule: 'sum-members' | 'designated-player' | 'survival-teams') =>
    createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      gamemodeConfig: { teamScoringRule: rule },
      players: teams,
      rounds: [buildRound({ roundNum: 1, rooms: [4, 3, 3, 3], players: 13, isQual: true })],
      assignments: [seated.map(({ name, room }) => ({ name, room, isLucky: false }))],
    });
  // Team 5 sits in room 1 at position 1; its first member scored, its second has no score
  const fifth = seated[4];

  it('13 teams, sum of members: the member who scored is confirmed, the teammate without a score is not', () => {
    const scores = { [key(0, fifth, '-m0')]: 7, [key(0, fifth, '-m1')]: 0 };
    const state = { ...base('sum-members'), scores };
    expect([...scoredPlayers(state)]).toEqual(['T5a']);
    expect(teamConfirmation(state, teams[4])).toEqual({ confirmed: 1, total: 2, level: 'some' });
    expect(rosterConfirmationSummary(state)).toMatchObject({
      confirmed: 1,
      total: 26,
      teamsConfirmed: 0,
      teams: 13,
    });
  });

  it('both members scoring makes the team confirmed', () => {
    const scores = { [key(0, fifth, '-m0')]: 7, [key(0, fifth, '-m1')]: 2 };
    const state = { ...base('sum-members'), scores };
    expect(teamConfirmation(state, teams[4]).level).toBe('all');
    expect(rosterConfirmationSummary(state)).toMatchObject({ teamsConfirmed: 1 });
  });

  it('Survival Teams and Save your Buddy confirm nobody from a score', () => {
    const survival = { ...base('survival-teams'), scores: { [key(0, fifth)]: 7 } };
    expect(scoredPlayers(survival).size).toBe(0);
    const buddy = { ...base('designated-player'), scores: { [key(0, fifth, '-m0')]: 7 } };
    expect(scoredPlayers(buddy).size).toBe(0);
    expect(rosterConfirmationSummary(buddy)).toMatchObject({ confirmed: 0, teamsConfirmed: 0 });
  });

  it('a score belongs to whoever holds the slot now', () => {
    const refilled = {
      ...base('sum-members'),
      players: teams.map((team, index) =>
        index === 4 ? { ...team, members: [{ name: 'Newcomer' }, team.members[1]] } : team,
      ),
      scores: { [key(0, fifth, '-m0')]: 7 },
    };
    expect([...scoredPlayers(refilled)]).toEqual(['Newcomer']);
  });

  it('a team in a game-split round counts a member score in any game', () => {
    const state = {
      ...base('sum-members'),
      rounds: [buildRound({ roundNum: 1, rooms: [4, 3, 3, 3], players: 13, isSemis: true, numGames: 2 })],
      scores: { [key(0, fifth, '-g2-m1')]: 4 },
    };
    expect([...scoredPlayers(state)]).toEqual(['T5b']);
  });

  it('a Final score confirms the member, and none counts under Survival Teams', () => {
    const final = {
      ...base('sum-members'),
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isFinal: true, numGames: 2 })],
      assignments: [
        [
          { name: 't1', room: 1 },
          { name: 't2', room: 1 },
        ],
      ],
      finalScores: { 'game2-t1-m1': 6, 'game1-t2-m0': 0 } as TournamentState['finalScores'],
    };
    expect([...scoredPlayers(final)]).toEqual(['T1b']);
    expect(scoredPlayers({ ...final, gamemodeConfig: { teamScoringRule: 'survival-teams' } }).size).toBe(0);
  });
});
