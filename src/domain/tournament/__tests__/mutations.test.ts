import { describe, expect, it } from 'vitest';
import { removeRosterUnit, swapIndividual, swapTeam } from '../mutations';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';

describe('removeRosterUnit', () => {
  it('records a withdrawal with reason "removed" and playedAnyMatch: true when a real score exists', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.withdrawnUnits).toEqual([
      { name: 'P1', label: 'P1', members: null, playedAnyMatch: true, reason: 'removed' },
    ]);
  });

  it("strips the removed unit from every group's members list, so it can never resurface in group standings", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2'],
      groups: [{ label: 'A', members: ['P1', 'P2'] }],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isGroupStage: true })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {},
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.groups).toEqual([{ label: 'A', members: ['P2'] }]);
  });

  it('records playedAnyMatch: false for a pure no-show (assigned but never scored)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {},
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.withdrawnUnits[0]).toMatchObject({ name: 'P1', playedAnyMatch: false, reason: 'removed' });
  });

  it("snapshots a removed team's real name/members, which are no longer resolvable once the team object is gone", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [
        {
          teamId: 't1',
          teamName: 'The Sharks',
          members: [{ name: 'Alice' }, { name: 'Bob' }],
        },
      ],
      rounds: [buildRound({ roundNum: 1, rooms: [1], players: 1 })],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      scores: {},
    });
    const result = removeRosterUnit(state, 't1');
    expect(result.withdrawnUnits).toEqual([
      {
        name: 't1',
        label: 'The Sharks',
        members: ['Alice', 'Bob'],
        playedAnyMatch: false,
        reason: 'removed',
      },
    ]);
    // The live team object is really gone -- confirms the snapshot was necessary.
    expect(result.players).toEqual([]);
  });

  it('records playedAnyMatch: true for a unit that only ever played in the Final (room: null, score in finalScores)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2, numGames: 1 })],
      assignments: [
        [
          { name: 'P1', room: null, isLucky: false },
          { name: 'P2', room: null, isLucky: false },
        ],
      ],
      finalScores: { 'game1-P1': 100 },
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.withdrawnUnits[0]).toMatchObject({ playedAnyMatch: true });
  });
});

describe('swapIndividual', () => {
  it('records a withdrawal with reason "swapped" for the outgoing name', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
    });
    const result = swapIndividual(state, 'P1', 'P3');
    expect(result.withdrawnUnits).toEqual([
      { name: 'P1', label: 'P1', members: null, playedAnyMatch: true, reason: 'swapped' },
    ]);
    expect(result.players).toEqual(['P2', 'P3']);
  });

  it("remaps the outgoing name to the incoming name in every group's members list", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2'],
      groups: [{ label: 'A', members: ['P1', 'P2'] }],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isGroupStage: true })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
    });
    const result = swapIndividual(state, 'P1', 'P3');
    expect(result.groups).toEqual([{ label: 'A', members: ['P3', 'P2'] }]);
  });

  it('is a no-op on groups when state.groups is empty (non-group-stage tournaments)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2'],
      groups: [],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: {},
    });
    const result = swapIndividual(state, 'P1', 'P3');
    expect(result.groups).toEqual([]);
  });
});

describe('swapTeam', () => {
  it('records a withdrawal with reason "swapped" and the outgoing team\'s name/members snapshotted', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [
        { teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, { name: 'Bob' }] },
        { teamId: 't2', teamName: 'Team Two', members: [{ name: 'Carl' }, { name: 'Dave' }] },
      ],
      groups: [{ label: 'A', members: ['t1', 't2'] }],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, isGroupStage: true })],
      assignments: [
        [
          { name: 't1', room: 1, isLucky: false },
          { name: 't2', room: 1, isLucky: false },
        ],
      ],
      scores: {},
    });
    const result = swapTeam(state, 't1', {
      teamId: 't3',
      teamName: 'Team Three',
      members: [{ name: 'Erin' }, { name: 'Frank' }],
    });
    expect(result.withdrawnUnits).toEqual([
      { name: 't1', label: 'Team One', members: ['Alice', 'Bob'], playedAnyMatch: false, reason: 'swapped' },
    ]);
    // Existing groups-remap behavior, unchanged by this plan -- regression coverage only.
    expect(result.groups).toEqual([{ label: 'A', members: ['t3', 't2'] }]);
  });
});
