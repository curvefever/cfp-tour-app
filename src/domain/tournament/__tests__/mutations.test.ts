import { describe, expect, it } from 'vitest';
import { rebuildFixedDrawHistory } from '../fixed-draws';
import { generateTournament } from '../generation';
import {
  addReserveUnit,
  connectAnonymousFinalist,
  flagFinalGameAnonymous,
  removeRosterUnit,
  resetRoster,
  setFinalScore,
  setRoundScore,
  swapIndividual,
  swapTeam,
  unflagFinalGameAnonymous,
} from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import type { TournamentRound, TournamentState, TournamentTeam } from '../types';
import { buildRound } from './test-fixtures';

const ROOM_SIZE = { min: 6, max: 8, ideal: 8 };

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

describe('future group-stage rounds -- removeRosterUnit/swapIndividual/swapTeam', () => {
  const round0 = buildRound({
    roundNum: 1,
    isGroupStage: true,
    rooms: [2],
    players: 6,
    matches: [{ group: 'A', pair: ['P1', 'P2'] }],
    groupByes: ['P3', 'P4'],
    roomGroups: ['A'],
  });

  it('converts a future match into a bye for the survivor, and shifts other groups into place', () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2, 2],
      players: 6,
      byeCount: 2,
      matches: [
        { group: 'A', pair: ['P1', 'P3'] },
        { group: 'B', pair: ['Q1', 'Q2'] },
      ],
      groupByes: ['P2', 'P4'],
      roomGroups: ['A', 'B'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2', 'P3', 'P4', 'Q1', 'Q2'],
      groups: [
        { label: 'A', members: ['P1', 'P2', 'P3', 'P4'] },
        { label: 'B', members: ['Q1', 'Q2'] },
      ],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [],
      ],
      scores: {},
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.rounds[1]).toMatchObject({
      matches: [{ group: 'B', pair: ['Q1', 'Q2'] }],
      groupByes: ['P2', 'P4', 'P3'],
      rooms: [2],
      byeCount: 3,
      players: 5,
      roomGroups: ['B'],
    });
    // The already-reached round is byte-for-byte untouched.
    expect(result.rounds[0]).toBe(round0);
  });

  it("drops the unit from a future round's existing groupByes when it has no match that round", () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2],
      players: 4,
      byeCount: 2,
      matches: [{ group: 'A', pair: ['P3', 'P4'] }],
      groupByes: ['P1', 'P2'],
      roomGroups: ['A'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2', 'P3', 'P4'],
      groups: [{ label: 'A', members: ['P1', 'P2', 'P3', 'P4'] }],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [],
      ],
      scores: {},
    });
    const result = removeRosterUnit(state, 'P1');
    expect(result.rounds[1]).toMatchObject({
      matches: [{ group: 'A', pair: ['P3', 'P4'] }],
      groupByes: ['P2'],
      rooms: [2],
      byeCount: 1,
      players: 3,
      roomGroups: ['A'],
    });
  });

  it('relabels old -> new in a future match on swapIndividual, with no room/bye/player-count change', () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2],
      players: 3,
      byeCount: 1,
      matches: [{ group: 'A', pair: ['P1', 'P3'] }],
      groupByes: ['P2'],
      roomGroups: ['A'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2', 'P3'],
      groups: [{ label: 'A', members: ['P1', 'P2', 'P3'] }],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [],
      ],
      scores: {},
    });
    const result = swapIndividual(state, 'P1', 'P5');
    expect(result.rounds[1]).toMatchObject({
      matches: [{ group: 'A', pair: ['P5', 'P3'] }],
      groupByes: ['P2'],
      rooms: [2],
      byeCount: 1,
      players: 3,
      roomGroups: ['A'],
    });
    expect(result.rounds[0]).toBe(round0);
  });

  it('relabels old -> new in a future groupByes entry on swapIndividual', () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2],
      players: 3,
      byeCount: 1,
      matches: [{ group: 'A', pair: ['P3', 'P4'] }],
      groupByes: ['P1'],
      roomGroups: ['A'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P3', 'P4'],
      groups: [{ label: 'A', members: ['P1', 'P3', 'P4'] }],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [[{ name: 'P1', room: 1, isLucky: false }], []],
      scores: {},
    });
    const result = swapIndividual(state, 'P1', 'P5');
    expect(result.rounds[1]).toMatchObject({
      matches: [{ group: 'A', pair: ['P3', 'P4'] }],
      groupByes: ['P5'],
    });
  });

  it('relabels old -> new in a future match on swapTeam the same way', () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2],
      players: 3,
      matches: [{ group: 'A', pair: ['t1', 't3'] }],
      groupByes: [],
      roomGroups: ['A'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [
        { teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, { name: 'Bob' }] },
        { teamId: 't3', teamName: 'Team Three', members: [{ name: 'Carl' }, { name: 'Dave' }] },
      ],
      groups: [{ label: 'A', members: ['t1', 't3'] }],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [[{ name: 't1', room: 1, isLucky: false }], []],
      scores: {},
    });
    const result = swapTeam(state, 't1', {
      teamId: 't5',
      teamName: 'Team Five',
      members: [{ name: 'Erin' }, { name: 'Frank' }],
    });
    expect(result.rounds[1]).toMatchObject({
      matches: [{ group: 'A', pair: ['t5', 't3'] }],
    });
  });

  it('leaves non-group-stage pooling phases completely unaffected (regression)', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      cfg: { poolingPhase: 'qual-table' },
      curRound: 0,
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [2], players: 2 }),
      ],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
        [],
      ],
      scores: {},
    });
    const removed = removeRosterUnit(state, 'P1');
    expect(removed.rounds).toBe(state.rounds);
    const swapped = swapIndividual(state, 'P2', 'P5');
    expect(swapped.rounds).toBe(state.rounds);
  });

  it('composes correctly across two sequential removals', () => {
    const round1 = buildRound({
      roundNum: 2,
      isGroupStage: true,
      rooms: [2],
      players: 4,
      matches: [{ group: 'A', pair: ['P1', 'P2'] }],
      groupByes: [],
      roomGroups: ['A'],
    });
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2', 'P3', 'P4'],
      groups: [{ label: 'A', members: ['P1', 'P2', 'P3', 'P4'] }],
      cfg: { poolingPhase: 'group-stage' },
      curRound: 0,
      rounds: [round0, round1],
      assignments: [[], []],
      scores: {},
    });
    const afterFirst = removeRosterUnit(state, 'P1');
    expect(afterFirst.rounds[1]).toMatchObject({ matches: [], groupByes: ['P2'], players: 3 });
    const afterSecond = removeRosterUnit(afterFirst, 'P2');
    expect(afterSecond.rounds[1]).toMatchObject({ matches: [], groupByes: [], players: 2 });
  });
});

describe('setRoundScore', () => {
  const baseState = () => createDefaultTournamentState({ scores: {} });

  it('rejects a negative integer string, stores null', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', '-5', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBeNull();
  });

  it('rejects a decimal string, stores null', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', '5.7', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBeNull();
  });

  it('accepts "0" and stores 0', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', '0', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBe(0);
  });

  it('accepts a positive integer string', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', '42', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBe(42);
  });

  it('treats an empty string as unset (regression)', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', '', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBeNull();
  });

  it('treats non-numeric garbage as unset (regression)', () => {
    const result = setRoundScore(baseState(), 'r0-rm1-p0', 'abc', 0, 1);
    expect(result.scores['r0-rm1-p0']).toBeNull();
  });
});

describe('setFinalScore', () => {
  const baseState = () => createDefaultTournamentState({ finalScores: {} });

  it('rejects a negative integer string, stores ""', () => {
    const result = setFinalScore(baseState(), 'game1-P1', '-5');
    expect(result.finalScores['game1-P1']).toBe('');
  });

  it('rejects a decimal string, stores ""', () => {
    const result = setFinalScore(baseState(), 'game1-P1', '5.7');
    expect(result.finalScores['game1-P1']).toBe('');
  });

  it('accepts "0" and stores 0', () => {
    const result = setFinalScore(baseState(), 'game1-P1', '0');
    expect(result.finalScores['game1-P1']).toBe(0);
  });

  it('accepts a positive integer string', () => {
    const result = setFinalScore(baseState(), 'game1-P1', '42');
    expect(result.finalScores['game1-P1']).toBe(42);
  });

  it('treats an empty string as unset (regression)', () => {
    const result = setFinalScore(baseState(), 'game1-P1', '');
    expect(result.finalScores['game1-P1']).toBe('');
  });

  it('treats non-numeric garbage as unset (regression)', () => {
    const result = setFinalScore(baseState(), 'game1-P1', 'abc');
    expect(result.finalScores['game1-P1']).toBe('');
  });
});

function anonFinalState(overrides: Partial<Parameters<typeof createDefaultTournamentState>[0]> = {}) {
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [2], players: 2, numGames: 3 })],
    assignments: [
      [
        { name: 'P1', room: 1, isLucky: false },
        { name: 'P2', room: 1, isLucky: false },
      ],
    ],
    finalScores: {},
    curRound: 0,
    ...overrides,
  });
}

describe('flagFinalGameAnonymous / unflagFinalGameAnonymous', () => {
  it('generates Finalist-1/Finalist-2 aliases in assignment order on first flag', () => {
    const result = flagFinalGameAnonymous(anonFinalState(), 3);
    expect(result.anonymousFinalists).toEqual([
      { alias: 'Finalist-1', realKey: 'P1', connected: false },
      { alias: 'Finalist-2', realKey: 'P2', connected: false },
    ]);
    expect(result.rounds[0].anonymousGames).toEqual([3]);
  });

  it('reuses the existing alias list for a second flagged game in the same Final', () => {
    const first = flagFinalGameAnonymous(anonFinalState(), 3);
    const second = flagFinalGameAnonymous(first, 2);
    expect(second.anonymousFinalists).toBe(first.anonymousFinalists);
    expect(second.rounds[0].anonymousGames).toEqual([3, 2]);
  });

  it('rejects an out-of-range game number', () => {
    const state = anonFinalState();
    expect(flagFinalGameAnonymous(state, 0)).toBe(state);
    expect(flagFinalGameAnonymous(state, 4)).toBe(state);
  });

  it('rejects flagging a game that already has a real score', () => {
    const state = anonFinalState({ finalScores: { 'game1-P1': 10, 'game1-P2': 20 } });
    expect(flagFinalGameAnonymous(state, 1)).toBe(state);
  });

  it('no-ops re-flagging an already-flagged game', () => {
    const flagged = flagFinalGameAnonymous(anonFinalState(), 3);
    expect(flagFinalGameAnonymous(flagged, 3)).toBe(flagged);
  });

  it('rejects team-format Finals', () => {
    const state = anonFinalState({ gameFormat: 'team-3v3' });
    expect(flagFinalGameAnonymous(state, 3)).toBe(state);
  });

  it('rejects grand-final rounds (progressGrandFinalRace needs real keys to open the next game)', () => {
    const state = anonFinalState({
      rounds: [
        buildRound({
          roundNum: 1,
          isFinal: true,
          bracket: 'grand-final',
          rooms: [2],
          players: 2,
          numGames: 1,
          wbFinalistName: 'P1',
        }),
      ],
    });
    expect(flagFinalGameAnonymous(state, 1)).toBe(state);
  });

  it('rejects generating aliases for more than 10 finalists', () => {
    const assignments = Array.from({ length: 11 }, (_, index) => ({
      name: `P${index + 1}`,
      room: 1,
      isLucky: false,
    }));
    const state = anonFinalState({
      rounds: [buildRound({ roundNum: 1, isFinal: true, rooms: [11], players: 11, numGames: 3 })],
      assignments: [assignments],
    });
    expect(flagFinalGameAnonymous(state, 3)).toBe(state);
  });

  it('unflags a not-yet-scored anonymous game', () => {
    const flagged = flagFinalGameAnonymous(anonFinalState(), 3);
    const result = unflagFinalGameAnonymous(flagged, 3);
    expect(result.rounds[0].anonymousGames).toEqual([]);
  });

  it('rejects unflagging a game that already has a placeholder score', () => {
    const flagged = flagFinalGameAnonymous(anonFinalState(), 3);
    const scored = { ...flagged, finalScores: { 'game3-Finalist-1': 10 } };
    expect(unflagFinalGameAnonymous(scored, 3)).toBe(scored);
  });

  it('no-ops unflagging a game that was never flagged', () => {
    const state = anonFinalState();
    expect(unflagFinalGameAnonymous(state, 3)).toBe(state);
  });
});

describe('connectAnonymousFinalist', () => {
  it('rejects connecting before every game is filled (real or placeholder)', () => {
    let state = anonFinalState({ finalScores: { 'game1-P1': 10, 'game1-P2': 20 } });
    state = flagFinalGameAnonymous(state, 2);
    state = flagFinalGameAnonymous(state, 3);
    // game2/game3 scored under placeholders for Finalist-1 only -- Finalist-2 still missing.
    state = {
      ...state,
      finalScores: { ...state.finalScores, 'game2-Finalist-1': 5, 'game3-Finalist-1': 5 },
    };
    const result = connectAnonymousFinalist(state, 'Finalist-1');
    expect(result).toBe(state);
  });

  it('merges placeholder scores onto the real finalist once every game is filled, and marks connected', () => {
    let state = anonFinalState({ finalScores: { 'game1-P1': 10, 'game1-P2': 20 } });
    state = flagFinalGameAnonymous(state, 2);
    state = flagFinalGameAnonymous(state, 3);
    state = {
      ...state,
      finalScores: {
        ...state.finalScores,
        'game2-Finalist-1': 5,
        'game2-Finalist-2': 7,
        'game3-Finalist-1': 9,
        'game3-Finalist-2': 11,
      },
    };
    const result = connectAnonymousFinalist(state, 'Finalist-1');
    expect(result.finalScores['game2-P1']).toBe(5);
    expect(result.finalScores['game3-P1']).toBe(9);
    expect(result.finalScores['game2-P2']).toBeUndefined();
    expect(result.anonymousFinalists).toEqual([
      { alias: 'Finalist-1', realKey: 'P1', connected: true },
      { alias: 'Finalist-2', realKey: 'P2', connected: false },
    ]);
  });

  it('does not overwrite a real key that somehow already has a score', () => {
    let state = anonFinalState({ finalScores: { 'game1-P1': 10, 'game1-P2': 20 } });
    state = flagFinalGameAnonymous(state, 2);
    state = flagFinalGameAnonymous(state, 3);
    state = {
      ...state,
      finalScores: {
        ...state.finalScores,
        'game2-Finalist-1': 5,
        'game2-Finalist-2': 7,
        'game3-Finalist-1': 9,
        'game3-Finalist-2': 11,
        'game2-P1': 99, // pre-existing, should be left alone
      },
    };
    const result = connectAnonymousFinalist(state, 'Finalist-1');
    expect(result.finalScores['game2-P1']).toBe(99);
    expect(result.finalScores['game3-P1']).toBe(9);
  });

  it('no-ops for an unknown alias', () => {
    const state = anonFinalState({
      finalScores: {
        'game1-P1': 10,
        'game1-P2': 20,
        'game2-P1': 1,
        'game2-P2': 1,
        'game3-P1': 1,
        'game3-P2': 1,
      },
    });
    expect(connectAnonymousFinalist(state, 'Finalist-1')).toBe(state);
  });

  it('no-ops re-connecting an already-connected alias', () => {
    let state = anonFinalState({ finalScores: { 'game1-P1': 10, 'game1-P2': 20 } });
    state = flagFinalGameAnonymous(state, 2);
    state = flagFinalGameAnonymous(state, 3);
    state = {
      ...state,
      finalScores: {
        ...state.finalScores,
        'game2-Finalist-1': 5,
        'game2-Finalist-2': 7,
        'game3-Finalist-1': 9,
        'game3-Finalist-2': 11,
      },
    };
    const connected = connectAnonymousFinalist(state, 'Finalist-1');
    expect(connectAnonymousFinalist(connected, 'Finalist-1')).toBe(connected);
  });
});

describe('addReserveUnit -- qualifying-round restriction', () => {
  function workingRoundState(overrides: Partial<Parameters<typeof createDefaultTournamentState>[0]> = {}) {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: ROOM_SIZE },
      players: ['P1', 'P2'],
      reserves: ['P3'],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      rounds: [buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2 })],
      curRound: 0,
      cfg: { poolingPhase: 'qual-table' },
      ...overrides,
    });
  }

  it('allows a reserve when 0 qualifying rounds are completed', () => {
    const result = addReserveUnit(workingRoundState(), 'P3');
    expect(result.status).toBe('added');
  });

  it('allows a reserve when exactly 1 qualifying round is completed', () => {
    const state = workingRoundState({
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [2], players: 2 }),
      ],
      assignments: [
        [],
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      curRound: 1,
    });
    const result = addReserveUnit(state, 'P3');
    expect(result.status).toBe('added');
  });

  it('blocks a reserve once 2 qualifying rounds are completed, for qual-table', () => {
    const state = createDefaultTournamentState({
      cfg: { poolingPhase: 'qual-table' },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isQual: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 3, isQual: true, rooms: [2], players: 2 }),
      ],
      curRound: 2,
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'blocked', reason: 'qualification-in-progress' });
  });

  it('blocks a reserve once 2 qualifying rounds are completed, for swiss too (same standings engine)', () => {
    const state = createDefaultTournamentState({
      cfg: { poolingPhase: 'swiss' },
      rounds: [
        buildRound({ roundNum: 1, isSwiss: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isSwiss: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 3, isSwiss: true, rooms: [2], players: 2 }),
      ],
      curRound: 2,
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'blocked', reason: 'qualification-in-progress' });
  });

  it('still blocks Group Stage with its own reason, regardless of round count (regression)', () => {
    const state = createDefaultTournamentState({
      cfg: { poolingPhase: 'group-stage' },
      rounds: [
        buildRound({ roundNum: 1, isGroupStage: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isGroupStage: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 3, isGroupStage: true, rooms: [2], players: 2 }),
      ],
      curRound: 2,
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'blocked', reason: 'group-stage' });
  });

  it('blocks a reserve for a fixed-draw tournament regardless of round count -- the whole schedule is already published', () => {
    const state = workingRoundState({
      gamemodeConfig: { roomSize: ROOM_SIZE, drawPublication: 'fixed' },
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'blocked', reason: 'fixed-draw' });
  });

  it('blocks a reserve for a waterfall bracket -- its routing table is validated against the exact entrant count at generation time, with no mechanism to fold in a late arrival', () => {
    const state = workingRoundState({ scheduleLogic: 'waterfall-bracket' });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'blocked', reason: 'waterfall-bracket' });
  });

  it('leaves poolingPhase "none" unaffected regardless of round count (regression)', () => {
    const rounds = Array.from({ length: 6 }, (_, index) =>
      buildRound({ roundNum: index + 1, rooms: [2], players: 2 }),
    );
    const assignments = Array.from({ length: 5 }, () => [] as never[]);
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: ROOM_SIZE },
      players: ['P1', 'P2'],
      reserves: ['P3'],
      cfg: { poolingPhase: 'none' },
      rounds,
      assignments: [
        ...assignments,
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      curRound: 5,
    });
    const result = addReserveUnit(state, 'P3');
    expect(result.status).toBe('added');
  });
});

describe('resetRoster', () => {
  it('clears the roster/schedule and every piece of tournament-specific carryover state, so a reused player name starts with a genuinely clean slate', () => {
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
      roomHistory: { 'P1|P2': 0 },
      anonymousFinalists: [{ alias: 'Finalist-1', realKey: 'P1', connected: false }],
      started: true,
    });
    const result = resetRoster(state);
    expect(result.players).toEqual([]);
    expect(result.rounds).toEqual([]);
    expect(result.started).toBe(false);
    // The two fields this fix adds -- previously left stale across a roster
    // clear, which could bias rematch-avoidance for a reused player name or
    // leave a dangling placeholder-alias mapping into a brand new Final.
    expect(result.roomHistory).toEqual({});
    expect(result.anonymousFinalists).toEqual([]);
  });
});

describe('future fixed-draw rounds -- removeRosterUnit/swapIndividual/swapTeam', () => {
  type SetupOverrides = Parameters<typeof createDefaultSetup>[0];

  function fixedDrawState(setup: SetupOverrides, players: TournamentState['players']): TournamentState {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: players.length, players }),
      createDefaultSetup({ ...setup, drawPublication: 'fixed' }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
    return result.state;
  }

  const individuals = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);
  const teams = (count: number): TournamentTeam[] =>
    Array.from({ length: count }, (_, index) => ({
      teamId: `t${index + 1}`,
      teamName: `Team ${index + 1}`,
      members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
    }));
  const swiss11 = () =>
    fixedDrawState({ gameFormat: 'individual-1v1', poolingPhase: 'swiss', qualAdv: '4' }, individuals(11));
  const qualTable37 = () => fixedDrawState({ poolingPhase: 'qual-table', qualAdv: '24' }, individuals(37));
  const teams13 = () =>
    fixedDrawState({ gameFormat: 'team-3v3v3', poolingPhase: 'qual-table', qualAdv: '6' }, teams(13));

  const futureFixedIndexes = (state: TournamentState) =>
    state.rounds.flatMap((round, index) =>
      index > state.curRound && round.fixedRoomAssignments ? [index] : [],
    );

  function opponentsIn(round: TournamentRound, name: string): string[] {
    const entries = round.fixedRoomAssignments ?? [];
    const mine = entries.find((entry) => entry.name === name);
    if (!mine || mine.room === null) return [];
    return entries
      .filter((entry) => entry.room === mine.room && entry.name !== name)
      .map((entry) => entry.name);
  }

  /** rooms/byeCount/players match the published list and room numbers are contiguous from 1. */
  function expectConsistent(round: TournamentRound) {
    const entries = round.fixedRoomAssignments ?? [];
    const sizes = new Map<number, number>();
    for (const entry of entries) {
      if (entry.room !== null) sizes.set(entry.room, (sizes.get(entry.room) ?? 0) + 1);
    }
    const roomNumbers = [...sizes.keys()].sort((a, b) => a - b);
    expect(roomNumbers).toEqual(roomNumbers.map((_, index) => index + 1));
    expect(round.rooms).toEqual(roomNumbers.map((room) => sizes.get(room)));
    expect(round.byeCount).toBe(entries.filter((entry) => entry.room === null).length);
    expect(round.players).toBe(entries.length);
  }

  it('swiss (11 players): removing a unit turns each future opponent into a bye and keeps room numbers contiguous', () => {
    const state = swiss11();
    const futures = futureFixedIndexes(state);
    expect(futures.length).toBeGreaterThan(0);
    const result = removeRosterUnit(state, 'P3');

    expect(result.rounds[0]).toBe(state.rounds[0]);
    for (const index of futures) {
      const before = state.rounds[index];
      const after = result.rounds[index];
      const entries = after.fixedRoomAssignments ?? [];
      expect(entries.some((entry) => entry.name === 'P3')).toBe(false);
      for (const opponent of opponentsIn(before, 'P3')) {
        expect(entries.find((entry) => entry.name === opponent)?.room).toBeNull();
      }
      expect(entries.length).toBe((before.fixedRoomAssignments ?? []).length - 1);
      expect(
        entries.every((entry) => entry.room === null || opponentsIn(after, entry.name).length === 1),
      ).toBe(true);
      expectConsistent(after);
    }
    // Rounds after the pooling phase carry no published draw and stay untouched.
    state.rounds.forEach((round, index) => {
      if (!futures.includes(index)) expect(result.rounds[index]).toBe(round);
    });
  });

  it('swiss (11 players): removing a unit that is on a bye in a future round just drops that bye', () => {
    const state = swiss11();
    const byeRoundIndex = futureFixedIndexes(state).find((index) =>
      state.rounds[index].fixedRoomAssignments?.some((entry) => entry.room === null),
    ) as number;
    const before = state.rounds[byeRoundIndex].fixedRoomAssignments ?? [];
    const removed = before.find((entry) => entry.room === null)?.name as string;

    const result = removeRosterUnit(state, removed);
    const after = result.rounds[byeRoundIndex].fixedRoomAssignments ?? [];
    expect(after).toEqual(before.filter((entry) => entry.name !== removed));
    expect(result.rounds[byeRoundIndex].byeCount).toBe(0);
    expectConsistent(result.rounds[byeRoundIndex]);
  });

  it('swiss (11 players): removing both units of a future pair makes that room disappear and shifts later rooms down', () => {
    const state = swiss11();
    const roundIndex = futureFixedIndexes(state)[0];
    const entries = state.rounds[roundIndex].fixedRoomAssignments ?? [];
    const [first, second] = entries.filter((entry) => entry.room === 3).map((entry) => entry.name);
    const laterRoomMembers = entries.filter((entry) => entry.room === 4).map((entry) => entry.name);

    const result = removeRosterUnit(removeRosterUnit(state, first), second);
    const after = result.rounds[roundIndex].fixedRoomAssignments ?? [];
    expect(after.some((entry) => entry.name === first || entry.name === second)).toBe(false);
    expect(after.filter((entry) => laterRoomMembers.includes(entry.name)).map((entry) => entry.room)).toEqual(
      [3, 3],
    );
    expectConsistent(result.rounds[roundIndex]);
  });

  it('qual-table (37 players): removing a unit shrinks one room per future round by one and creates no byes', () => {
    const state = qualTable37();
    const futures = futureFixedIndexes(state);
    const result = removeRosterUnit(state, 'P1');

    expect(result.rounds[0]).toBe(state.rounds[0]);
    for (const index of futures) {
      const before = state.rounds[index];
      const after = result.rounds[index];
      expect(after.rooms.reduce((sum, size) => sum + size, 0)).toBe(36);
      expect(after.rooms.length).toBe(before.rooms.length);
      expect(after.byeCount).toBe(0);
      expect((after.fixedRoomAssignments ?? []).some((entry) => entry.name === 'P1')).toBe(false);
      expectConsistent(after);
    }
  });

  it('qual-table team-3v3v3 (13 teams): a team removed from a 2-team future room leaves the other team on a bye', () => {
    const state = teams13();
    const roundIndex = futureFixedIndexes(state)[0];
    const before = state.rounds[roundIndex];
    const smallRoom = before.rooms.findIndex((size) => size === 2) + 1;
    const [removed, survivor] = (before.fixedRoomAssignments ?? [])
      .filter((entry) => entry.room === smallRoom)
      .map((entry) => entry.name);

    const result = removeRosterUnit(state, removed);
    const after = result.rounds[roundIndex];
    expect(after.fixedRoomAssignments?.find((entry) => entry.name === survivor)?.room).toBeNull();
    expect(after.byeCount).toBe(1);
    expect(after.players).toBe(12);
    expectConsistent(after);
  });

  it('swapIndividual relabels the old unit in every future round without changing room shape', () => {
    const state = swiss11();
    const result = swapIndividual(state, 'P3', 'Newcomer');

    expect(result.rounds[0]).toBe(state.rounds[0]);
    for (const index of futureFixedIndexes(state)) {
      const before = state.rounds[index];
      const after = result.rounds[index];
      expect(after.rooms).toEqual(before.rooms);
      expect(after.fixedRoomAssignments).toEqual(
        (before.fixedRoomAssignments ?? []).map((entry) =>
          entry.name === 'P3' ? { ...entry, name: 'Newcomer' } : entry,
        ),
      );
    }
  });

  it('swapTeam relabels the old team in every future round without changing room shape', () => {
    const state = teams13();
    const [replacement] = teams(14).slice(13);
    const result = swapTeam(state, 't2', replacement);

    expect(result.rounds[0]).toBe(state.rounds[0]);
    for (const index of futureFixedIndexes(state)) {
      const before = state.rounds[index];
      const after = result.rounds[index];
      expect(after.rooms).toEqual(before.rooms);
      expect(after.fixedRoomAssignments).toEqual(
        (before.fixedRoomAssignments ?? []).map((entry) =>
          entry.name === 't2' ? { ...entry, name: replacement.teamId } : entry,
        ),
      );
    }
  });

  it.each([
    ['qual-table 37', qualTable37],
    ['swiss 11', swiss11],
  ])(
    'rebuilding roomHistory/poolingByeCounts on an unmodified %s tournament reproduces the generated values',
    (_label, build) => {
      const state = build();
      expect(rebuildFixedDrawHistory(state.rounds, state.assignments, state.curRound)).toEqual({
        roomHistory: state.roomHistory,
        poolingByeCounts: state.poolingByeCounts,
      });
    },
  );

  it('after a removal, no future pairing with the removed unit remains in roomHistory and each orphaned opponent gains a bye count', () => {
    const state = swiss11();
    const orphanedRounds = new Map<string, number>();
    for (const index of futureFixedIndexes(state)) {
      for (const opponent of opponentsIn(state.rounds[index], 'P3')) {
        orphanedRounds.set(opponent, (orphanedRounds.get(opponent) ?? 0) + 1);
      }
    }
    expect(orphanedRounds.size).toBeGreaterThan(0);

    const result = removeRosterUnit(state, 'P3');
    for (const other of individuals(11).filter((name) => name !== 'P3')) {
      const played = result.roomHistory[roomPairKey('P3', other)];
      expect(played === undefined || played <= state.curRound).toBe(true);
    }
    for (const [opponent, count] of orphanedRounds) {
      expect(result.poolingByeCounts[opponent]).toBe((state.poolingByeCounts[opponent] ?? 0) + count);
    }
  });

  it('leaves rounds, roomHistory and poolingByeCounts untouched for an adaptive (non-fixed) tournament', () => {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players: individuals(37) }),
      createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '24' }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error('generation failed');
    const removed = removeRosterUnit(result.state, 'P1');
    expect(removed.rounds).toBe(result.state.rounds);
    expect(removed.roomHistory).toBe(result.state.roomHistory);
    expect(removed.poolingByeCounts).toBe(result.state.poolingByeCounts);
  });
});
