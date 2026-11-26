import { describe, expect, it } from 'vitest';
import {
  removeRosterUnit,
  swapIndividual,
  swapIndividualResult,
  swapTeam,
  swapTeamResult,
  swapWindowOpen,
} from '../mutations';
import { renameIndividual, renameIndividualResult, type RosterEditRefusal } from '../roster-edits';
import type { TournamentState, TournamentTeam } from '../types';
import { pressNextRound, scoreCurrentRound } from './play-through';
import { generated } from './test-fixtures';

const started = (state: TournamentState): TournamentState => ({ ...state, started: true });

/** Plays on until the round in play is an elimination round: nobody out yet, no late joiners. */
function inEliminationRound(state: TournamentState, teamSize: number): TournamentState {
  let next = started(state);
  while (next.rounds[next.curRound].isNoElim) next = pressNextRound(scoreCurrentRound(next, teamSize));
  return next;
}

/** One elimination round played and advanced: someone is out, so the swap window is closed. */
function swapsClosed(state: TournamentState, teamSize: number): TournamentState {
  return pressNextRound(scoreCurrentRound(inEliminationRound(state, teamSize), teamSize));
}

const refusedWith = (result: { status: string; reason?: RosterEditRefusal }) =>
  result.status === 'refused' ? result.reason : 'done';

const players = () => started(generated(20, { scheduleLogic: 'single-elimination' }));
const bracketPlayers = () =>
  inEliminationRound(generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }), 0);
const teams = () =>
  inEliminationRound(
    generated(8, { gameFormat: 'team-2v2', scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
    2,
  );
const team = (id: string, name = id, members = ['Ann', 'Bo']): TournamentTeam => ({
  teamId: id,
  teamName: name,
  members: members.map((member) => ({ name: member })),
});
const withPlayers = (state: TournamentState, ...extra: string[]) => ({
  ...state,
  players: [...(state.players as string[]), ...extra],
});

describe('renameIndividualResult: the first check that fails is the reason', () => {
  const state = players();
  const cases: Array<[string, TournamentState, string, string, RosterEditRefusal | 'done']> = [
    ['an empty name', state, 'P1', '   ', 'empty-name'],
    ['the same name', state, 'P1', ' P1 ', 'same-name'],
    ['a name on the players', state, 'P1', 'P2', 'duplicate-name'],
    ['a name on the reserves', { ...state, reserves: ['Res1'] }, 'P1', 'Res1', 'duplicate-name'],
    ['a name that left', removeRosterUnit(state, 'P3'), 'P1', 'P3', 'withdrawn-name'],
    ['a name that cannot be stored', state, 'P1', 'a.b', 'unstorable-name'],
    ['a free name', state, 'P1', 'Zed', 'done'],
  ];

  it.each(cases)('%s', (_name, from, oldName, newName, reason) => {
    const result = renameIndividualResult(from, oldName, newName);
    expect(refusedWith(result)).toBe(reason);
    const wrapped = renameIndividual(from, oldName, newName);
    if (reason === 'done') expect(wrapped).toEqual(result.status === 'done' ? result.state : null);
    else expect(wrapped).toBe(from);
  });

  it('gives the first of two failing checks', () => {
    const odd = withPlayers(state, 'X.y');
    expect(refusedWith(renameIndividualResult(odd, 'P1', 'X.y'))).toBe('duplicate-name');
    const left = removeRosterUnit(withPlayers(state, 'W.x'), 'W.x');
    expect(refusedWith(renameIndividualResult(left, 'P1', 'W.x'))).toBe('withdrawn-name');
    expect(refusedWith(renameIndividualResult(state, 'P1', ' '))).toBe('empty-name');
  });
});

describe('swapIndividualResult: the first check that fails is the reason', () => {
  const state = bracketPlayers();
  const closed = swapsClosed(generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }), 0);
  const ghost = withPlayers(state, 'Ghost');
  const cases: Array<[string, TournamentState, string, string, RosterEditRefusal | 'done']> = [
    ['an empty name', state, 'P1', '  ', 'empty-name'],
    ['a name on the players', state, 'P1', 'P2', 'duplicate-name'],
    ['a name that left', removeRosterUnit(state, 'P3'), 'P1', 'P3', 'withdrawn-name'],
    ['a name that cannot be stored', state, 'P1', 'a/b', 'unstorable-name'],
    ['the swap window closed', closed, 'P1', 'Zed', 'swap-closed'],
    ['a unit that is not in play', ghost, 'Ghost', 'Zed', 'not-in-play'],
    ['a free name', state, 'P1', 'Zed', 'done'],
    ['a name from the reserves', { ...state, reserves: ['Res1'] }, 'P1', 'Res1', 'done'],
  ];

  it('has the window closed in the closed state', () => {
    expect(swapWindowOpen(closed)).toBe(false);
    expect(swapWindowOpen(state)).toBe(true);
  });

  it.each(cases)('%s', (_name, from, oldName, newName, reason) => {
    const result = swapIndividualResult(from, oldName, newName);
    expect(refusedWith(result)).toBe(reason);
    const wrapped = swapIndividual(from, oldName, newName);
    if (reason === 'done') expect(wrapped).not.toBe(from);
    else expect(wrapped).toBe(from);
  });

  it('gives the first of two failing checks', () => {
    expect(refusedWith(swapIndividualResult(withPlayers(state, 'X.y'), 'P1', 'X.y'))).toBe('duplicate-name');
    expect(refusedWith(swapIndividualResult(closed, 'Nobody', 'Zed'))).toBe('swap-closed');
    expect(refusedWith(swapIndividualResult(closed, 'P1', ''))).toBe('empty-name');
    expect(refusedWith(swapIndividualResult(ghost, 'Ghost', 'a.b'))).toBe('unstorable-name');
    expect(refusedWith(swapIndividualResult(closed, 'P1', 'a.b'))).toBe('unstorable-name');
  });
});

describe('swapTeamResult: the first check that fails is the reason', () => {
  const state = teams();
  const closed = swapsClosed(
    generated(8, { gameFormat: 'team-2v2', scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
    2,
  );
  const withTeam = (extra: TournamentTeam) => ({
    ...state,
    players: [...(state.players as TournamentTeam[]), extra],
  });
  const cases: Array<[string, TournamentState, string, TournamentTeam, RosterEditRefusal | 'done']> = [
    ['a players format', bracketPlayers(), 'P1', team('nt'), 'not-a-team-format'],
    ['the swap window closed', closed, 't1', team('nt'), 'swap-closed'],
    ['a team id already on the roster', state, 't1', team('t2', 'Fresh'), 'duplicate-name'],
    ['a team name another team has', state, 't1', team('nt', 'Team 2'), 'duplicate-name'],
    ['a name that cannot be stored', state, 't1', team('nt', 'Fresh', ['A.nn', 'Bo']), 'unstorable-name'],
    ['a team that is not in play', withTeam(team('ghost')), 'ghost', team('nt', 'Fresh'), 'not-in-play'],
    ['a free team', state, 't1', team('nt', 'Fresh'), 'done'],
  ];

  it('has the window closed in the closed state', () => {
    expect(swapWindowOpen(closed)).toBe(false);
  });

  it.each(cases)('%s', (_name, from, oldId, replacement, reason) => {
    const result = swapTeamResult(from, oldId, replacement);
    expect(refusedWith(result)).toBe(reason);
    const wrapped = swapTeam(from, oldId, replacement);
    if (reason === 'done') expect(wrapped).not.toBe(from);
    else expect(wrapped).toBe(from);
  });

  it('gives the first of two failing checks', () => {
    expect(refusedWith(swapTeamResult(bracketPlayers(), 'P1', team('nt', 'Fresh', ['A.nn'])))).toBe(
      'not-a-team-format',
    );
    expect(refusedWith(swapTeamResult(closed, 't1', team('t2', 'Fresh')))).toBe('swap-closed');
    expect(refusedWith(swapTeamResult(closed, 't1', team('nt', 'Fresh', ['A.nn'])))).toBe('swap-closed');
    const closedPlayers = swapsClosed(
      generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
      0,
    );
    expect(swapWindowOpen(closedPlayers)).toBe(false);
    expect(refusedWith(swapTeamResult(closedPlayers, 'P1', team('nt', 'Fresh')))).toBe('not-a-team-format');
    expect(refusedWith(swapTeamResult(withTeam(team('ghost')), 'ghost', team('nt', 'Fresh', ['A.nn'])))).toBe(
      'unstorable-name',
    );
  });
});
