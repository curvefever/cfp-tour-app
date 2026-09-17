import { describe, expect, it } from 'vitest';
import {
  addReserveUnit,
  removeRosterUnit,
  setFinalScore,
  setRoundScore,
  swapIndividual,
  swapTeam,
} from '../mutations';
import { createDefaultTournamentState } from '../state-defaults';
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
