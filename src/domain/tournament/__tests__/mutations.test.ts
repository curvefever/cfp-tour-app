import { describe, expect, it } from 'vitest';
import { projectFutureRoundSlots } from '../bracket';
import { rebuildFixedDrawHistory } from '../fixed-draws';
import { generateTournament } from '../generation';
import {
  addReserveUnit,
  addWalkUpIndividual,
  addWalkUpTeam,
  connectAnonymousFinalist,
  fillTeamSlot,
  flagFinalGameAnonymous,
  removeRosterUnit,
  renameIndividual,
  renameTeamMember,
  resetRoster,
  resetTournamentState,
  resolveTournamentTie,
  setFinalScore,
  setRoundScore,
  shareTiedPoints,
  swapIndividual,
  swapTeam,
  swapWindowOpen,
  unflagFinalGameAnonymous,
  updateTeam,
  withLoadedRoster,
} from '../mutations';
import { marshalForFirebase, unmarshalFromFirebase } from '../../../features/sync/firebase-marshal';
import { computeRankings } from '../rankings';
import { distributeRooms } from '../room-distribution';
import { createTournamentRuntime } from '../runtime';
import { isConfirmed, setConfirmed } from '../confirmations';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { settingsFromForm } from '../tournament-settings';
import { advanceTournamentRound } from '../transitions';
import type { TournamentRound, TournamentState, TournamentTeam } from '../types';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';
import { ALL_ROUTED_GRAPHS, buildQualWaterfall, playToQualificationExit } from './qual-waterfall';
import { buildAssignments, buildRound } from './test-fixtures';
import { ONE_SCORE_PER_TEAM } from '../formats';

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
      { name: 'P1', label: 'P1', members: null, playedAnyMatch: true, reason: 'removed', round: 0 },
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
        round: 0,
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

describe('One score per team score keys', () => {
  function oneScoreTeamRoom() {
    const teamIds = ['t0', 't1', 't2', 't3'];
    return createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      gamemodeConfig: { teamScoringRule: ONE_SCORE_PER_TEAM },
      players: teamIds.map((teamId) => ({
        teamId,
        teamName: teamId,
        members: [{ name: `${teamId}a` }, { name: `${teamId}b` }],
      })),
      rounds: [buildRound({ roundNum: 1, rooms: [4], players: 4 })],
      assignments: [teamIds.map((name) => ({ name, room: 1, isLucky: false }))],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    });
  }

  it('removing the team at position 1 shifts the plain keys of later positions down and drops the last', () => {
    const result = removeRosterUnit(oneScoreTeamRoom(), 't1');
    expect(result.scores).toEqual({ 'r0-rm1-p0': 400, 'r0-rm1-p1': 200, 'r0-rm1-p2': 100 });
  });

  it("replacing a team deletes only that position's plain key", () => {
    const result = swapTeam(oneScoreTeamRoom(), 't1', {
      teamId: 't9',
      teamName: 't9',
      members: [{ name: 'x' }, { name: 'y' }],
    });
    expect(result.scores).toEqual({ 'r0-rm1-p0': 400, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 });
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
      {
        name: 'P1',
        label: 'P1',
        members: null,
        playedAnyMatch: true,
        reason: 'swapped',
        round: 0,
        replacedBy: 'P3',
      },
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
      {
        name: 't1',
        label: 'Team One',
        members: ['Alice', 'Bob'],
        playedAnyMatch: false,
        reason: 'swapped',
        round: 0,
        replacedBy: 't3',
      },
    ]);
    // Existing groups-remap behavior, unchanged by this plan -- regression coverage only.
    expect(result.groups).toEqual([{ label: 'A', members: ['t3', 't2'] }]);
  });

  describe('replacement taken from the reserves', () => {
    const reserveTeam = {
      teamId: 'r1',
      teamName: 'Reserve Team 1',
      members: [{ name: 'Gina' }, { name: 'Hal' }],
    };
    const otherReserve = {
      teamId: 'r2',
      teamName: 'Reserve Team 2',
      members: [{ name: 'Ian' }, { name: 'Jo' }],
    };

    function withReserves() {
      return createDefaultTournamentState({
        gameFormat: 'team-2v2v2v2',
        players: [
          { teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, { name: 'Bob' }] },
          { teamId: 't2', teamName: 'Team Two', members: [{ name: 'Carl' }, { name: 'Dave' }] },
        ],
        reserves: [reserveTeam, otherReserve],
        rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
        assignments: [
          [
            { name: 't1', room: 1, isLucky: false },
            { name: 't2', room: 1, isLucky: false },
          ],
        ],
        scores: {},
      });
    }

    it("moves the reserve into the roster and takes the outgoing team's seat", () => {
      const result = swapTeam(withReserves(), 't1', reserveTeam);
      expect((result.players as { teamId: string }[]).map((team) => team.teamId)).toEqual(['t2', 'r1']);
      expect((result.reserves as { teamId: string }[]).map((team) => team.teamId)).toEqual(['r2']);
      expect(result.assignments[0].map((seat) => seat.name)).toEqual(['r1', 't2']);
    });

    it('still refuses a typed replacement named like a different reserve team', () => {
      const state = withReserves();
      const typed = { teamId: 'new1', teamName: 'Reserve Team 2', members: [{ name: 'Kim' }] };
      expect(swapTeam(state, 't1', typed)).toBe(state);
    });

    it('still accepts a replacement named like the outgoing team', () => {
      const state = withReserves();
      const sameName = { teamId: 'new2', teamName: 'Team One', members: [{ name: 'Kim' }] };
      expect(swapTeam(state, 't1', sameName)).not.toBe(state);
    });
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

describe('addReserveUnit -- which tournaments take a reserve', () => {
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

  it('asks before adding a reserve who would miss 2 or more counted qualifying rounds, for qual-table', () => {
    const state = createDefaultTournamentState({
      cfg: { poolingPhase: 'qual-table' },
      rounds: [
        buildRound({ roundNum: 1, isQual: true, isNoElim: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isQual: true, isNoElim: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 3, isQual: true, isNoElim: true, rooms: [2], players: 2 }),
      ],
      curRound: 2,
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'confirm-late-join', missedRounds: 3 });
  });

  it('asks before adding a reserve who would miss 2 or more counted rounds, for swiss too (same standings engine)', () => {
    const state = createDefaultTournamentState({
      cfg: { poolingPhase: 'swiss' },
      rounds: [
        buildRound({ roundNum: 1, isSwiss: true, isNoElim: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 2, isSwiss: true, isNoElim: true, rooms: [2], players: 2 }),
        buildRound({ roundNum: 3, isSwiss: true, isNoElim: true, rooms: [2], players: 2 }),
      ],
      curRound: 2,
    });
    expect(addReserveUnit(state, 'P3')).toEqual({ status: 'confirm-late-join', missedRounds: 3 });
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

  it('blocks a reserve for a waterfall bracket without a pooling phase -- its routing table is validated against the exact entrant count at generation time, with no mechanism to fold in a late arrival', () => {
    const state = workingRoundState({ scheduleLogic: 'waterfall-bracket', cfg: { poolingPhase: 'none' } });
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

describe('withLoadedRoster', () => {
  it('stores the roster, its reserves, the count and the format it was parsed for, and nothing else', () => {
    const team = {
      teamId: 't1',
      teamName: 'Alpha',
      members: [{ name: 'A1' }, { name: 'A2' }],
    };
    const before = createDefaultTournamentState({
      title: 'Cup',
      gameFormat: 'ffa-individual',
      players: ['Old'],
      confirmedCount: null,
    });
    const result = withLoadedRoster(before, 'team-2v2v2v2', {
      players: [team],
      reserves: [],
      reserveIndividuals: [{ name: 'Solo' }],
    });
    expect(result).toMatchObject({
      gameFormat: 'team-2v2v2v2',
      players: [team],
      reserves: [],
      reserveIndividuals: [{ name: 'Solo' }],
      confirmedCount: 1,
    });
    expect(result.title).toBe(before.title);
    expect(result.cfg).toBe(before.cfg);
    expect(result.info).toBe(before.info);
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

  it('keeps the tournament id, since the tournament itself stays', () => {
    const state = createDefaultTournamentState({ tournamentId: 't-keep', players: ['P1'] });
    expect(resetRoster(state).tournamentId).toBe('t-keep');
  });

  it('removes the settings snapshot, since it describes the schedule that resetRoster just cleared', () => {
    const state = createDefaultTournamentState({
      settings: settingsFromForm(createDefaultSetup()),
    });
    expect(resetRoster(state)).not.toHaveProperty('settings');
  });
});

describe('resetTournamentState', () => {
  it('keeps the tournament id, the roster and the generated rounds, and clears what was played', () => {
    const state = createDefaultTournamentState({
      tournamentId: 't-keep',
      players: ['P1', 'P2'],
      confirmedCount: 2,
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
      curRound: 0,
      started: true,
    });
    const result = resetTournamentState(state);
    expect(result.tournamentId).toBe('t-keep');
    expect(result.players).toEqual(['P1', 'P2']);
    expect(result.rounds).toEqual(state.rounds);
    expect(result.scores).toEqual({});
    expect(result.assignments).toEqual([]);
    expect(result.started).toBe(false);
  });

  it('keeps the settings snapshot, since it keeps the schedule (rounds) the snapshot describes', () => {
    const settings = settingsFromForm(createDefaultSetup());
    const state = createDefaultTournamentState({ settings });
    expect(resetTournamentState(state).settings).toEqual(settings);
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

  it('leaves roomHistory and poolingByeCounts untouched for an adaptive (non-fixed) tournament', () => {
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 37, players: individuals(37) }),
      createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '24' }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error('generation failed');
    const removed = removeRosterUnit(result.state, 'P1');
    expect(removed.roomHistory).toBe(result.state.roomHistory);
    expect(removed.poolingByeCounts).toBe(result.state.poolingByeCounts);
  });
});

describe('removeRosterUnit -- re-plans the future rounds for the new headcount', () => {
  type SetupOverrides = Parameters<typeof createDefaultSetup>[0];

  function generate(count: number, setup: SetupOverrides): TournamentState {
    const result = generateTournament(
      createDefaultTournamentState({
        confirmedCount: count,
        players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
      }),
      createDefaultSetup(setup),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
    return result.state;
  }

  const seats = (round: TournamentRound) => round.rooms.reduce((total, size) => total + size, 0);
  const nullProjections = (state: TournamentState) =>
    Object.entries(projectFutureRoundSlots(state))
      .filter(([, value]) => value === null)
      .map(([key]) => key);

  it('FFA 37 with a qualification table: the later qualification rounds are planned for 36, the bracket rounds still start from qualAdv', () => {
    const state = generate(37, { poolingPhase: 'qual-table', qualAdv: '24' });
    const removed = removeRosterUnit(state, 'P1');
    const qualRounds = removed.rounds.filter((round) => round.isQual);
    expect(qualRounds.map(seats)).toEqual([37, 36, 36]);
    const firstBracket = removed.rounds.findIndex((round) => !round.isQual);
    expect(removed.rounds[firstBracket]).toEqual(state.rounds[firstBracket]);
  });

  it('FFA 23 single elimination with no pooling: warm-up and elimination rounds are re-planned for 22, and the Bracket preview keeps every entry it had', () => {
    const state = generate(23, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });
    const removed = removeRosterUnit(state, 'P1');
    expect(seats(removed.rounds[1])).toBe(22);
    expect(removed.rounds[2].players).toBe(22);
    expect(nullProjections(removed).every((key) => nullProjections(state).includes(key))).toBe(true);
  });

  it('keeps the explicit elimination targets and Final size override', () => {
    const setup = {
      scheduleLogic: 'single-elimination' as const,
      poolingPhase: 'none' as const,
      eliminationRoundTargets: '32,24,16',
      finalOverride: '4',
    };
    const state = generate(37, setup);
    const removed = removeRosterUnit(state, 'P1');
    const targets = (rounds: TournamentRound[]) =>
      rounds
        .filter((round) => !round.isNoElim && !round.isSemis && !round.isFinal)
        .map((round) => round.advTotal);
    expect(targets(removed.rounds)).toEqual([32, 24, 16]);
    expect(removed.rounds[removed.rounds.length - 1].players).toBe(4);
    expect(seats(removed.rounds[1])).toBe(36);
  });

  it('leaves the rounds alone when the rebuild would be incoherent (an explicit first target above the new headcount)', () => {
    const state = generate(37, {
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      eliminationRoundTargets: '37,24,16',
    });
    expect(removeRosterUnit(state, 'P1').rounds).toBe(state.rounds);
  });

  it('does not rebuild a fixed-draw tournament: its bracket rounds stay the very same objects', () => {
    const state = generate(37, { poolingPhase: 'qual-table', qualAdv: '24', drawPublication: 'fixed' });
    const removed = removeRosterUnit(state, 'P1');
    const firstBracket = state.rounds.findIndex((round) => !round.isQual);
    expect(removed.rounds[firstBracket]).toBe(state.rounds[firstBracket]);
  });

  it('leaves the graph rounds of a waterfall bracket untouched and refits its pooling rounds to the new headcount', () => {
    const state = generate(16, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      waterfallGraph:
        'ROUNDS:\nR1 = 2x8\nSemiB = 8\nFinal = 8 FINAL\n\nROUTES:\nR1.A: 1-3->Final, 4-7->SemiB, 8->eliminated\nR1.B: 1-3->Final, 4-7->SemiB, 8->eliminated\nSemiB: 1-2->Final, 3-8->eliminated',
    });
    const removed = removeRosterUnit(state, 'P1');
    const firstWaterfall = state.rounds.findIndex((round) => round.isWaterfall);
    expect(removed.rounds.slice(firstWaterfall)).toEqual(state.rounds.slice(firstWaterfall));
    const roomSize = state.gamemodeConfig.roomSize as { min: number; max: number; ideal: number };
    for (const index of [1, 2]) {
      expect(removed.rounds[index].rooms).toEqual(distributeRooms(15, roomSize));
      expect(removed.rounds[index].players).toBe(15);
    }
    expect(removed.rounds[0]).toBe(state.rounds[0]);
  });

  it('still removes the unit, and leaves the rounds untouched, when the rebuild returns null', () => {
    const state = generate(23, { scheduleLogic: 'single-elimination', poolingPhase: 'none' });
    const broken = { ...state, gamemodeConfig: { ...state.gamemodeConfig, roomSize: undefined } };
    const removed = removeRosterUnit(broken, 'P1');
    expect(removed.players).not.toContain('P1');
    expect(removed.rounds).toBe(broken.rounds);
  });

  it('Swiss: the round count cannot change because of the new headcount', () => {
    const state = generate(12, { gameFormat: 'individual-1v1', poolingPhase: 'swiss', qualAdv: '4' });
    const removed = removeRosterUnit(state, 'P1');
    expect(removed.rounds.filter((round) => round.isSwiss)).toHaveLength(
      state.rounds.filter((round) => round.isSwiss).length,
    );
    expect(removed.rounds).toHaveLength(state.rounds.length);
  });
});

const advanced = (state: TournamentState): TournamentState => {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
  return result.state;
};
const seatedNames = (state: TournamentState, index: number) =>
  (state.assignments[index] ?? []).map((entry) => entry.name);
const roundIndexOf = (state: TournamentState, label: string) =>
  state.rounds.findIndex((round) => round.customLabel === label);
const poolNames = (state: TournamentState) =>
  Object.values(state.pendingBracketSeeds).flatMap((seeds) => seeds.map((seed) => seed.name));

describe('swapIndividual -- where the outgoing unit is in play', () => {
  const withReserve = (state: TournamentState): TournamentState => ({ ...state, reserves: ['Sub'] });

  it('37 waterfall routing everyone: a unit waiting for R1C is replaced in its pool, keeping the slot it earned', () => {
    const atR1 = advanced(
      playToQualificationExit(withReserve(buildQualWaterfall(37, ALL_ROUTED_GRAPHS[37]))),
    );
    const r1c = roundIndexOf(atR1, 'R1C');
    const waiting = atR1.pendingBracketSeeds[r1c][3];

    const swapped = swapIndividual(atR1, waiting.name, 'Sub');

    expect(swapped.pendingBracketSeeds[r1c][3]).toEqual({ ...waiting, name: 'Sub' });
    expect(swapped.pendingBracketSeeds[r1c]).toHaveLength(21);
    expect(JSON.stringify(swapped.pendingBracketSeeds)).not.toContain(`"${waiting.name}"`);
    expect(swapped.players).toContain('Sub');
    expect(swapped.players).not.toContain(waiting.name);
    expect(swapped.reserves).toEqual([]);
    expect(swapped.withdrawnUnits).toMatchObject([{ name: waiting.name, reason: 'swapped' }]);

    const atR1c = advanced(scoreCurrentRound(swapped, 0));
    expect(atR1c.curRound).toBe(r1c);
    expect(seatedNames(atR1c, r1c)).toContain('Sub');
    expect(seatedNames(atR1c, r1c)).not.toContain(waiting.name);
    expect(seatedNames(atR1c, r1c)).toHaveLength(21);
  });

  it('43 waterfall routing everyone: a unit seated in R1 is still swapped in its seat (regression)', () => {
    const atR1 = advanced(
      playToQualificationExit(withReserve(buildQualWaterfall(43, ALL_ROUTED_GRAPHS[43]))),
    );
    const r1 = roundIndexOf(atR1, 'R1');
    const seated = atR1.assignments[r1][5];

    const swapped = swapIndividual(atR1, seated.name, 'Sub');

    expect(swapped.assignments[r1][5]).toMatchObject({ name: 'Sub', room: seated.room });
    expect(seatedNames(swapped, r1)).not.toContain(seated.name);
    expect(swapped.pendingBracketSeeds).toEqual(atR1.pendingBracketSeeds);
    expect(swapped.withdrawnUnits).toMatchObject([{ name: seated.name, reason: 'swapped' }]);
  });

  it('a unit that is neither seated nor waiting leaves the state unchanged', () => {
    const atR1 = advanced(
      playToQualificationExit(withReserve(buildQualWaterfall(37, ALL_ROUTED_GRAPHS[37]))),
    );
    expect(swapIndividual(atR1, 'Nobody', 'Sub')).toBe(atR1);
  });

  it('double elimination 1v1 at 31: a unit waiting in a pending pool is replaced and seated when its round is drawn', () => {
    const start = buildState({
      label: 'de 31',
      count: 31,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
        oddCountStrategy: 'bye',
      },
    }) as TournamentState;
    // Round 3 (losers) leaves 16 winners-bracket units waiting in round 4's pool.
    let state: TournamentState = { ...start, reserves: ['Sub'] };
    while (state.curRound < 3) state = advanced(scoreCurrentRound(state, 0));
    const [destination, pool] = Object.entries(state.pendingBracketSeeds)[0];
    expect(pool.length).toBeGreaterThan(0);
    const waiting = pool[0];

    const swapped = swapIndividual(state, waiting.name, 'Sub');

    expect(swapped.pendingBracketSeeds[destination][0]).toEqual({ ...waiting, name: 'Sub' });
    const drawn = advanced(scoreCurrentRound(swapped, 0));
    expect(seatedNames(drawn, Number(destination))).toContain('Sub');
    expect(seatedNames(drawn, Number(destination))).not.toContain(waiting.name);
  });
});

describe('swaps close once anyone is eliminated', () => {
  const advance = (state: TournamentState): TournamentState => {
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`expected an advance, got ${JSON.stringify(result)}`);
    return result.state;
  };
  const withReserve = (state: TournamentState): TournamentState => ({ ...state, reserves: ['Sub'] });
  const individual = (count: number, setup: SweepConfig['setup']) =>
    withReserve(buildState({ label: 'swap window', count, teams: false, setup }) as TournamentState);

  /** Scores and advances until `target` is the current round; returns the state just before that last advance (scored) and just after. */
  function playUpTo(start: TournamentState, target: number, teamSize = 0) {
    let state = start;
    while (state.curRound < target - 1) state = advance(scoreCurrentRound(state, teamSize));
    const before = scoreCurrentRound(state, teamSize);
    return { before, after: advance(before) };
  }

  /** Both sides of the boundary, and every swap attempt on the closed side leaves the state untouched. */
  function expectBoundaryAt(start: TournamentState, firstClosedRound: number) {
    const { before, after } = playUpTo(start, firstClosedRound);
    expect(before.curRound).toBe(firstClosedRound - 1);
    expect(swapWindowOpen(start)).toBe(true);
    expect(swapWindowOpen(before)).toBe(true);
    expect(swapWindowOpen(after)).toBe(false);

    const seated = after.assignments[after.curRound][0].name;
    const eliminated = computeRankings(after)?.eliminatedList[0].name as string;
    expect(eliminated).toBeDefined();
    expect(swapIndividual(after, seated, 'Sub')).toBe(after);
    expect(swapIndividual(after, eliminated, 'Sub')).toBe(after);

    const openSeat = before.assignments[before.curRound][0].name;
    const swapped = swapIndividual(before, openSeat, 'Sub');
    expect(swapped).not.toBe(before);
    expect(swapped.players).toContain('Sub');
  }

  it('single elimination, 31: open through the warm-ups and the first elimination round, closed once its losers are out', () => {
    expectBoundaryAt(
      individual(31, {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'none',
      }),
      3,
    );
  });

  it('single elimination, 37: stays open while units are out only in the round still in play, closes once it is advanced', () => {
    const start = individual(37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
    });
    const { before, after } = playUpTo(start, 3);
    const inPlay = computeRankings(before)?.eliminatedList ?? [];
    expect(inPlay.length).toBeGreaterThan(0);
    expect(inPlay.every((entry) => entry.rank === null)).toBe(true);
    expect(swapWindowOpen(before)).toBe(true);
    expect(swapWindowOpen(after)).toBe(false);
  });

  it('qualification table into a waterfall with Qual source, 37: open in the last qualification round, closed after the pooling exit', () => {
    expectBoundaryAt(withReserve(buildQualWaterfall(37)), 3);
  });

  it('group stage into a bracket, 43 in groups of 5: open through the last group round, closed after the group exit', () => {
    expectBoundaryAt(
      individual(43, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'group-stage',
        groupSize: '5',
        oddCountStrategy: 'bye',
      }),
      5,
    );
  });

  it('Kings Valley, 53: open until the first Kings Valley round that eliminates', () => {
    expectBoundaryAt(
      individual(53, { gameFormat: 'ffa-individual', scheduleLogic: 'kings-valley', poolingPhase: 'none' }),
      3,
    );
  });

  it('double elimination, 31: open while losers only drop to the losers bracket, closed at the first unit knocked out of it', () => {
    const start = individual(31, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'bye',
    });
    const atFirstLosersRound = playUpTo(start, 3).after;
    expect(atFirstLosersRound.rounds[atFirstLosersRound.curRound].bracket).toBe('losers');
    expect(swapWindowOpen(atFirstLosersRound)).toBe(true);
    expectBoundaryAt(start, 4);
  });

  it('team swaps close at the same point (single elimination, 31 teams of 3)', () => {
    const start = buildState({
      label: 'teams',
      count: 31,
      teams: true,
      setup: { gameFormat: 'team-3v3v3', scheduleLogic: 'single-elimination', poolingPhase: 'none' },
    }) as TournamentState;
    const reserve: TournamentTeam = {
      teamId: 'sub',
      teamName: 'Sub Team',
      members: [{ name: 'x' }, { name: 'y' }, { name: 'z' }],
    };
    let state = start;
    while (swapWindowOpen(state)) state = advance(scoreCurrentRound(state, 3));
    const eliminated = computeRankings(state)?.eliminatedList[0].name as string;
    expect(swapTeam(state, state.assignments[state.curRound][0].name, reserve)).toBe(state);
    expect(swapTeam(state, eliminated, reserve)).toBe(state);
    expect(swapTeam(start, start.assignments[0][0].name, reserve)).not.toBe(start);
  });
});

describe('removeRosterUnit -- a unit waiting in a pending pool', () => {
  it('37 waterfall: a unit waiting for R1C is in no pool, and R1C is drawn short without it', () => {
    const atR1 = advanced(playToQualificationExit(buildQualWaterfall(37)));
    const r1c = roundIndexOf(atR1, 'R1C');
    const waiting = atR1.pendingBracketSeeds[r1c][3].name;

    const removed = removeRosterUnit(atR1, waiting);

    expect(poolNames(removed)).not.toContain(waiting);
    expect(removed.pendingBracketSeeds[r1c]).toHaveLength(7);
    const atR1c = advanced(scoreCurrentRound(removed, 0));
    expect(seatedNames(atR1c, r1c)).not.toContain(waiting);
    expect(atR1c.rounds[r1c]).toMatchObject({ rooms: [7], players: 7 });
  });

  it('43 waterfall: a unit waiting for R2 after playing R1 is not seated in R2, which is drawn short', () => {
    const atR1c = advanced(scoreCurrentRound(advanced(playToQualificationExit(buildQualWaterfall(43))), 0));
    const r2 = roundIndexOf(atR1c, 'R2');
    const waiting = atR1c.pendingBracketSeeds[r2][0].name;

    const removed = removeRosterUnit(atR1c, waiting);

    expect(poolNames(removed)).not.toContain(waiting);
    const atR2 = advanced(scoreCurrentRound(removed, 0));
    expect(atR2.curRound).toBe(r2);
    expect(seatedNames(atR2, r2)).not.toContain(waiting);
    expect(atR2.rounds[r2]).toMatchObject({ rooms: [7], players: 7 });
  });

  it('double elimination 1v1 at 31: a unit waiting in the round 4 pool is not seated, and the round is still drawn', () => {
    let state = buildState({
      label: 'de 31',
      count: 31,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'double-elimination',
        poolingPhase: 'none',
        oddCountStrategy: 'bye',
      },
    }) as TournamentState;
    while (state.curRound < 3) state = advanced(scoreCurrentRound(state, 0));
    const waiting = state.pendingBracketSeeds[4][0].name;

    const removed = removeRosterUnit(state, waiting);

    expect(poolNames(removed)).not.toContain(waiting);
    const drawn = advanced(scoreCurrentRound(removed, 0));
    expect(drawn.curRound).toBe(4);
    expect(seatedNames(drawn, 4)).not.toContain(waiting);
    expect((drawn.assignments[4] ?? []).length).toBe(15);
  });

  it('removing a seated unit leaves every pool untouched (regression)', () => {
    const atR1 = advanced(playToQualificationExit(buildQualWaterfall(37)));
    const seated = atR1.assignments[atR1.curRound][0].name;
    expect(removeRosterUnit(atR1, seated).pendingBracketSeeds).toEqual(atR1.pendingBracketSeeds);
  });
});

describe('names the database cannot store are refused by the domain', () => {
  const individuals = () =>
    createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      gamemodeConfig: { roomSize: ROOM_SIZE },
      players: ['P1', 'P2'],
      reserves: ['Sub'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
    });
  const teams = () =>
    createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [
        { teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, { name: 'Bob' }] },
        { teamId: 't2', teamName: 'Team Two', members: [{ name: 'Carl' }, { name: 'Dave' }] },
      ],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 't1', room: 1, isLucky: false },
          { name: 't2', room: 1, isLucky: false },
        ],
      ],
    });

  it('renameIndividual leaves the state unchanged for "A.B" and renames to a clean name', () => {
    const state = individuals();
    expect(renameIndividual(state, 'P1', 'A.B')).toBe(state);
    expect(renameIndividual(state, 'P1', 'Ann').players).toEqual(['Ann', 'P2']);
  });

  it('addWalkUpIndividual refuses "x#1" with its own reason, before anything else', () => {
    const state = individuals();
    expect(addWalkUpIndividual(state, 'x#1')).toEqual({ status: 'blocked', reason: 'unstorable-name' });
    expect(addWalkUpIndividual(state, 'x1').status).toBe('added');
  });

  it('swapIndividual leaves the state unchanged for a replacement called "a/b"', () => {
    const state = individuals();
    expect(swapIndividual(state, 'P1', 'a/b')).toBe(state);
    expect(swapIndividual(state, 'P1', 'Sub')).not.toBe(state);
  });

  it('swapTeam leaves the state unchanged for a replacement with a member called "m[1]"', () => {
    const state = teams();
    const clean: TournamentTeam = {
      teamId: 't3',
      teamName: 'Team Three',
      members: [{ name: 'm1' }, { name: 'm2' }],
    };
    expect(swapTeam(state, 't1', { ...clean, members: [{ name: 'm[1]' }, { name: 'm2' }] })).toBe(state);
    expect(swapTeam(state, 't1', { ...clean, teamName: 'Team.Three' })).toBe(state);
    expect(swapTeam(state, 't1', clean)).not.toBe(state);
  });

  it('updateTeam and fillTeamSlot refuse a new name with a forbidden character but accept a clean one', () => {
    const state = teams();
    const rename = (teamName: string) => updateTeam(state, 't1', (team) => ({ ...team, teamName }));
    expect(rename('Team#1')).toBe(state);
    expect(rename('Team 1')).not.toBe(state);
    const roomy = {
      ...state,
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, null] }, state.players[1]],
    } as TournamentState;
    expect(fillTeamSlot(roomy, 't1', 1, { name: 'Bo$b' })).toBe(roomy);
    expect(fillTeamSlot(roomy, 't1', 1, { name: 'Bob' })).not.toBe(roomy);
  });

  it('a name stored before names were checked does not lock its team: only newly introduced names are refused', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Old.Team', members: [{ name: 'Alice' }, { name: 'Bob' }] }],
    });
    const renamedMember = updateTeam(state, 't1', (team) => ({
      ...team,
      members: [{ name: 'Alicia' }, team.members[1]],
    }));
    expect(renamedMember).not.toBe(state);
    expect((renamedMember.players[0] as TournamentTeam).teamName).toBe('Old.Team');
  });
});

describe('shareTiedPoints', () => {
  const KEY = 'r0-rm1-s500';
  const tiedRoom = (round: Partial<TournamentRound>, extra: Partial<TournamentState> = {}) =>
    createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['A', 'B', 'C', 'D', 'E', 'F'],
      rounds: [buildRound({ roundNum: 1, rooms: [4, 2], players: 6, ...round })],
      assignments: [buildAssignments(['A', 'B', 'C', 'D', 'E', 'F'], [4, 2])],
      scores: {
        'r0-rm1-p0': 500,
        'r0-rm1-p1': 500,
        'r0-rm1-p2': 500,
        'r0-rm1-p3': 100,
        'r0-rm2-p0': 9,
        'r0-rm2-p1': 5,
      },
      ...extra,
    });
  const pooling = () => tiedRoom({ isNoElim: true });

  it('stores the ranked picks, the shared mark, then the sharing units', () => {
    expect(shareTiedPoints(pooling(), KEY, ['A', 'B', 'C']).tieResolutions).toEqual({
      [KEY]: ['#shared', 'A', 'B', 'C'],
    });
    const picked = resolveTournamentTie(pooling(), KEY, 'C');
    expect(shareTiedPoints(picked, KEY, ['A', 'B']).tieResolutions).toEqual({
      [KEY]: ['C', '#shared', 'A', 'B'],
    });
  });

  it('refuses the tie of an elimination round and of a Final', () => {
    const elimination = tiedRoom({ advPerRoom: 2 });
    expect(shareTiedPoints(elimination, KEY, ['A', 'B', 'C'])).toBe(elimination);
    const final = tiedRoom({ isFinal: true, isNoElim: true });
    expect(shareTiedPoints(final, KEY, ['A', 'B', 'C'])).toBe(final);
  });

  it('refuses a resolved key, a missing tie and names that are not exactly the unranked remainder', () => {
    const state = pooling();
    const resolved = { ...state, tieResolutions: { [KEY]: ['A', 'B'] } };
    expect(shareTiedPoints(resolved, KEY, ['C'])).toBe(resolved);
    const alreadyShared = shareTiedPoints(state, KEY, ['A', 'B', 'C']);
    expect(shareTiedPoints(alreadyShared, KEY, ['A', 'B', 'C'])).toBe(alreadyShared);
    expect(shareTiedPoints(state, 'r0-rm1-s999', ['A', 'B'])).toBe(state);
    expect(shareTiedPoints(state, KEY, ['A', 'B'])).toBe(state);
    expect(shareTiedPoints(state, KEY, ['A', 'B', 'D'])).toBe(state);
    expect(shareTiedPoints(state, KEY, ['A'])).toBe(state);
    const picked = resolveTournamentTie(state, KEY, 'A');
    expect(shareTiedPoints(picked, KEY, ['A', 'B', 'C'])).toBe(picked);
  });

  it('makes resolveTournamentTie refuse a shared key', () => {
    const shared = shareTiedPoints(pooling(), KEY, ['A', 'B', 'C']);
    expect(resolveTournamentTie(shared, KEY, 'A')).toBe(shared);
  });

  it('keeps the share through a rename and through the removal of an unrelated unit', () => {
    const shared = shareTiedPoints(pooling(), KEY, ['A', 'B', 'C']);
    expect(renameIndividual(shared, 'B', 'Bea').tieResolutions).toEqual({
      [KEY]: ['#shared', 'A', 'Bea', 'C'],
    });
    expect(removeRosterUnit(shared, 'F').tieResolutions).toEqual({ [KEY]: ['#shared', 'A', 'B', 'C'] });
  });

  it('survives the Firebase round trip', () => {
    const shared = shareTiedPoints(resolveTournamentTie(pooling(), KEY, 'C'), KEY, ['A', 'B']);
    const stored = unmarshalFromFirebase(marshalForFirebase(shared.tieResolutions));
    expect(stored).toEqual({ [KEY]: ['C', '#shared', 'A', 'B'] });
  });
});

describe('confirmations follow the person', () => {
  const individuals = (confirmed: string[]) =>
    confirmed.reduce(
      (state, name) => setConfirmed(state, name, true),
      createDefaultTournamentState({
        gameFormat: 'ffa-individual',
        players: ['P1', 'P2', 'P3'],
        reserves: ['Sub'],
        confirmedCount: 3,
      }),
    );
  const teams = () =>
    setConfirmed(
      createDefaultTournamentState({
        gameFormat: 'team-2v2v2v2',
        players: [
          { teamId: 't1', teamName: 'Team One', members: [{ name: 'Alice' }, { name: 'Bob' }] },
          { teamId: 't2', teamName: 'Team Two', members: [{ name: 'Carl' }, { name: 'Dave' }] },
        ],
      }),
      'Alice',
      true,
    );

  it("renameIndividual moves a player's confirmation to the new spelling", () => {
    const result = renameIndividual(individuals(['P1', 'P2']), 'P1', 'Ann');
    expect(result.confirmations).toEqual({ Ann: true, P2: true });
  });

  it("renameIndividual moves a reserve's confirmation", () => {
    const result = renameIndividual(individuals(['Sub']), 'Sub', 'Spare');
    expect(result.reserves).toEqual(['Spare']);
    expect(result.confirmations).toEqual({ Spare: true });
  });

  it('a refused rename leaves the confirmation where it was', () => {
    const state = individuals(['P1']);
    expect(renameIndividual(state, 'P1', 'A.B')).toBe(state);
    expect(renameIndividual(state, 'P1', 'P2')).toBe(state);
  });

  it('renameTeamMember renames the member and moves their confirmation', () => {
    const result = renameTeamMember(teams(), 't1', 0, '  Alicia ');
    expect((result.players as TournamentTeam[])[0].members[0]).toEqual({ name: 'Alicia' });
    expect(result.confirmations).toEqual({ Alicia: true });
  });

  it('renameTeamMember refuses a name the database cannot store, an empty name and a vacant slot', () => {
    const state = teams();
    expect(renameTeamMember(state, 't1', 0, 'A.B')).toBe(state);
    expect(renameTeamMember(state, 't1', 0, '  ')).toBe(state);
    expect(renameTeamMember(state, 'nope', 0, 'Zed')).toBe(state);
    const vacant = updateTeam(state, 't1', (team) => ({ ...team, members: [team.members[0], null] }));
    expect(renameTeamMember(vacant, 't1', 1, 'Zed')).toBe(vacant);
  });

  it("a swap brings the incoming name's own status, and the outgoing one stays on its name", () => {
    const played = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['P1', 'P2'],
      reserves: ['Sub'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
    });
    const state = setConfirmed(setConfirmed(played, 'P1', true), 'Sub', true);
    const result = swapIndividual(state, 'P1', 'Sub');
    expect(result.players).toEqual(['P2', 'Sub']);
    expect(isConfirmed(result, 'Sub')).toBe(true);
    expect(isConfirmed(result, 'P1')).toBe(true);
  });

  it('Clear roster clears every confirmation', () => {
    expect(resetRoster(individuals(['P1', 'Sub'])).confirmations).toEqual({});
  });

  it('reloading the roster and Back to draft keep them', () => {
    const state = individuals(['P1', 'Sub']);
    const loaded = withLoadedRoster(state, 'ffa-individual', {
      players: ['P1', 'P2'],
      reserves: ['Sub'],
      reserveIndividuals: [],
    });
    expect(loaded.confirmations).toEqual({ P1: true, Sub: true });
    expect(resetTournamentState(loaded).confirmations).toEqual({ P1: true, Sub: true });
  });
});

describe('addWalkUpTeam', () => {
  const qualSetup = { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table', qualAdv: '8' } as const;
  const newTeam: TournamentTeam = {
    teamId: 'walkup',
    teamName: 'Late Team',
    members: [{ name: 'Kim' }, { name: 'Lee' }],
  };

  function generatedTeams(count: number, started: boolean): TournamentState {
    const players = Array.from({ length: count }, (_, index) => ({
      teamId: `t${index + 1}`,
      teamName: `Team ${index + 1}`,
      members: [{ name: `a${index}` }, { name: `b${index}` }],
    }));
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players }),
      createDefaultSetup(qualSetup),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(result.message);
    return { ...result.state, started };
  }

  const seatedIn = (state: TournamentState, round: number, name: string) =>
    (state.assignments[round] ?? []).filter((entry) => entry.name === name).length;

  it('after the start the team is a late joiner: on the roster, in no room of the round in play', () => {
    const start = generatedTeams(31, true);
    const result = addWalkUpTeam(start, newTeam);
    if (result.status !== 'added') throw new Error(JSON.stringify(result));
    expect(result.state.players).toHaveLength(32);
    expect(result.state.reserves).toEqual([]);
    expect(seatedIn(result.state, 0, 'walkup')).toBe(0);
    expect(result.state.assignments[0]).toEqual(start.assignments[0]);
  });

  it('before the start the team is seated in round 1 (31 -> 32 teams)', () => {
    const result = addWalkUpTeam(generatedTeams(31, false), newTeam);
    if (result.status !== 'added') throw new Error(JSON.stringify(result));
    expect(result.state.confirmedCount).toBe(32);
    expect(seatedIn(result.state, 0, 'walkup')).toBe(1);
  });

  it('refuses a team with no members', () => {
    const state = generatedTeams(31, true);
    expect(addWalkUpTeam(state, { ...newTeam, members: [null, null] })).toEqual({
      status: 'blocked',
      reason: 'no-members',
    });
  });

  it('refuses a name already used by a roster team or by a reserve team', () => {
    const state = {
      ...generatedTeams(31, true),
      reserves: [{ ...newTeam, teamId: 'r1', teamName: 'Bench' }],
    };
    const duplicate = { status: 'blocked', reason: 'duplicate-name' };
    expect(addWalkUpTeam(state, { ...newTeam, teamName: 'Team 5' })).toEqual(duplicate);
    expect(addWalkUpTeam(state, { ...newTeam, teamName: 'Bench' })).toEqual(duplicate);
  });

  it('refuses a name or a member name the database cannot store', () => {
    const state = generatedTeams(31, true);
    const unstorable = { status: 'blocked', reason: 'unstorable-name' };
    expect(addWalkUpTeam(state, { ...newTeam, members: [{ name: 'm[1]' }, { name: 'Lee' }] })).toEqual(
      unstorable,
    );
    expect(addWalkUpTeam(state, { ...newTeam, teamName: 'Team.Three' })).toEqual(unstorable);
  });

  it('refuses an individual format', () => {
    const state = createDefaultTournamentState({ gameFormat: 'ffa-individual', players: ['P1', 'P2'] });
    expect(addWalkUpTeam(state, newTeam)).toEqual({ status: 'blocked', reason: 'room-cap' });
  });
});
