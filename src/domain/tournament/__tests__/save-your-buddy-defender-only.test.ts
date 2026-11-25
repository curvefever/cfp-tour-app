import { describe, expect, it } from 'vitest';
import { absentInRoom, hasPlayedAnyMatch, membersPresentAtSeat, pendingAbsenceQuestions } from '../absences';
import { answerAbsence } from '../absence-answers';
import { scoredPlayers } from '../confirmations';
import { setTeamDefender } from '../mutations';
import { getFinalUnitScore, getUnitScore, isRoomScored, scoredMemberSlots } from '../scoring';
import { createDefaultTournamentState } from '../state-defaults';
import type { TournamentState } from '../types';
import { buildRound, oneRoomState, teamOf } from './test-fixtures';

/** Save your Buddy: only the defender's score is entered; the other members of a team take none. */

const TEAMS = [teamOf('Red', ['r1', 'r2', 'r3']), teamOf('Blue', ['b1', 'b2', 'b3'])];

function buddyRoom(options: Partial<Parameters<typeof oneRoomState>[0]> = {}, defender = 1): TournamentState {
  const state = oneRoomState({
    gameFormat: 'team-3v3v3',
    rule: 'designated-player',
    players: TEAMS,
    ...options,
  });
  return {
    ...state,
    defenderChanges: {
      Red: [{ round: 0, memberIdx: defender }],
      Blue: [{ round: 0, memberIdx: defender }],
    },
  };
}

describe('scoredMemberSlots', () => {
  it('is the defender alone in Save your Buddy and every slot otherwise', () => {
    const buddy = buddyRoom();
    expect(scoredMemberSlots(buddy, 'Red', 0, 3)).toEqual([1]);
    expect(scoredMemberSlots(buddy, 'Red', 1, 3)).toEqual([1]);
    expect(scoredMemberSlots({ ...buddy, defenderChanges: {} }, 'Red', 0, 3)).toEqual([0]);
    const sum = {
      ...buddy,
      gamemodeConfig: { ...buddy.gamemodeConfig, teamScoringRule: 'sum-members' as const },
    };
    expect(scoredMemberSlots(sum, 'Red', 0, 3)).toEqual([0, 1, 2]);
  });
});

describe('a Save your Buddy room is scored by the defenders alone', () => {
  it("is complete with only the defenders' keys, and the team score is the defender's", () => {
    const state = buddyRoom({ scores: { 'r0-rm1-p0-m1': 120, 'r0-rm1-p1-m1': 80 } });
    expect(isRoomScored(state, 0, 1)).toBe(true);
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(120);
    expect(getUnitScore(state, 0, 1, 1, null)).toBe(80);
  });

  it('is not complete when only a non-defender was typed', () => {
    const state = buddyRoom({ scores: { 'r0-rm1-p0-m0': 120, 'r0-rm1-p0-m2': 5, 'r0-rm1-p1-m1': 80 } });
    expect(isRoomScored(state, 0, 1)).toBe(false);
    expect(getUnitScore(state, 0, 1, 0, null)).toBeNull();
  });

  it('needs the defender of every game in a round of several games', () => {
    const rounds = [{ numGames: 2 }, {}];
    const filled = {
      'r0-rm1-p0-g1-m1': 10,
      'r0-rm1-p0-g2-m1': 20,
      'r0-rm1-p1-g1-m1': 5,
      'r0-rm1-p1-g2-m1': 6,
    };
    expect(isRoomScored(buddyRoom({ rounds, scores: filled }), 0, 1)).toBe(true);
    const { 'r0-rm1-p1-g2-m1': _missing, ...partial } = filled;
    expect(isRoomScored(buddyRoom({ rounds, scores: partial }), 0, 1)).toBe(false);
  });

  it('still needs every member in Sum of members', () => {
    const state = buddyRoom({ rule: 'sum-members', scores: { 'r0-rm1-p0-m1': 120, 'r0-rm1-p1-m1': 80 } });
    expect(isRoomScored(state, 0, 1)).toBe(false);
  });

  it('is complete in the Final from the defenders keys of each game', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-3v3v3',
      players: TEAMS,
      rounds: [buildRound({ roundNum: 1, isFinal: true, players: 2, rooms: [2], numGames: 2 })],
      finalScores: { 'game1-Red-m1': 10, 'game2-Red-m1': 20, 'game1-Blue-m1': 7 },
      defenderChanges: { Red: [{ round: 0, memberIdx: 1 }], Blue: [{ round: 0, memberIdx: 1 }] },
      gamemodeConfig: { teamScoringRule: 'designated-player' },
    });
    expect(getFinalUnitScore(state, 'Red', 1, null)).toBe(10);
    expect(getFinalUnitScore(state, 'Red', 2, null)).toBe(20);
    expect(getFinalUnitScore(state, 'Blue', 1, null)).toBe(7);
    expect(getFinalUnitScore(state, 'Blue', 2, null)).toBeNull();
  });
});

describe('absences in Save your Buddy', () => {
  it("asks once per seat, about the defender's 0, and an absent defender makes the team absent", () => {
    const state = buddyRoom({
      scores: { 'r0-rm1-p0-m1': 0, 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m2': 0, 'r0-rm1-p1-m1': 50 },
    });
    expect(pendingAbsenceQuestions(state)[0].questions.map((question) => question.key)).toEqual([
      'r0-rm1-p0-m1',
    ]);
    const absent = answerAbsence(state, ['r0-rm1-p0-m1'], 'absent');
    expect(absentInRoom(absent, 0, 1)).toEqual(['Red']);
    expect(membersPresentAtSeat(absent, 0, 1, 0)).toEqual([]);
    expect(membersPresentAtSeat(absent, 0, 1, 1)).toEqual([0, 1, 2]);
  });

  it('a defender answered "played" keeps the team present, with every member on the roster', () => {
    const state = buddyRoom({
      players: [teamOf('Red', ['r1', 'r2', null]), TEAMS[1]],
      scores: { 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m1': 40 },
    });
    const played = answerAbsence(state, ['r0-rm1-p0-m1'], 'played');
    expect(absentInRoom(played, 0, 1)).toEqual([]);
    expect(membersPresentAtSeat(played, 0, 1, 0)).toEqual([0, 1]);
    expect(hasPlayedAnyMatch(played, 'Red')).toBe(true);
  });

  it('a stored room whose members were all marked absent stays absent', () => {
    const state = buddyRoom({
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p0-m2': 0, 'r0-rm1-p1-m1': 40 },
      absences: { 'r0-rm1-p0-m0': 'absent', 'r0-rm1-p0-m1': 'absent', 'r0-rm1-p0-m2': 'absent' },
    });
    expect(absentInRoom(state, 0, 1)).toEqual(['Red']);
  });
});

describe('changing the defender after a score was typed', () => {
  it('moves the typed score to the new defender, and the room stays complete', () => {
    const state = buddyRoom({ scores: { 'r0-rm1-p0-m0': 120, 'r0-rm1-p1-m0': 80 } }, 0);
    const changed = setTeamDefender(state, 'Red', 2);
    expect(changed.scores).toEqual({ 'r0-rm1-p0-m2': 120, 'r0-rm1-p1-m0': 80 });
    expect(isRoomScored(changed, 0, 1)).toBe(true);
    expect(getUnitScore(changed, 0, 1, 0, null)).toBe(120);
    const both = setTeamDefender(changed, 'Blue', 2);
    expect(both.scores).toEqual({ 'r0-rm1-p0-m2': 120, 'r0-rm1-p1-m2': 80 });
    expect(isRoomScored(both, 0, 1)).toBe(true);
    expect(getUnitScore(both, 0, 1, 0, null)).toBe(120);
  });

  it('moves the absence answer with the 0, in every game', () => {
    const state = buddyRoom(
      {
        rounds: [{ numGames: 2 }, {}],
        scores: { 'r0-rm1-p0-g1-m0': 0, 'r0-rm1-p0-g2-m0': 30 },
        absences: { 'r0-rm1-p0-g1-m0': 'played' },
      },
      0,
    );
    const changed = setTeamDefender(state, 'Red', 1);
    expect(changed.scores).toEqual({ 'r0-rm1-p0-g1-m1': 0, 'r0-rm1-p0-g2-m1': 30 });
    expect(changed.absences).toEqual({ 'r0-rm1-p0-g1-m1': 'played' });
  });

  it('moves nothing when the new defender already has a score', () => {
    const scores = { 'r0-rm1-p0-m0': 120, 'r0-rm1-p0-m1': 90 };
    const state = buddyRoom({ scores }, 0);
    const changed = setTeamDefender(state, 'Red', 1);
    expect(changed.scores).toEqual(scores);
    expect(changed.defenderChanges.Red).toEqual([{ round: 0, memberIdx: 1 }]);
  });

  it('moves nothing when the seat holds no score, or when it is not Save your Buddy', () => {
    expect(setTeamDefender(buddyRoom({}, 0), 'Red', 1).scores).toEqual({});
    const sum = buddyRoom({ rule: 'sum-members', scores: { 'r0-rm1-p0-m0': 10, 'r0-rm1-p0-m1': 20 } }, 0);
    expect(setTeamDefender(sum, 'Red', 1).scores).toEqual(sum.scores);
  });

  it('moves the Final keys of every game', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-3v3v3',
      players: TEAMS,
      rounds: [buildRound({ roundNum: 1, isFinal: true, players: 2, rooms: [2], numGames: 2 })],
      assignments: [
        [
          { name: 'Red', room: null, isLucky: false },
          { name: 'Blue', room: null, isLucky: false },
        ],
      ],
      finalScores: { 'game1-Red-m0': 10, 'game2-Red-m0': 20, 'game1-Blue-m0': 7 },
      gamemodeConfig: { teamScoringRule: 'designated-player' },
      started: true,
    });
    const changed = setTeamDefender(state, 'Red', 2);
    expect(changed.finalScores).toEqual({ 'game1-Red-m2': 10, 'game2-Red-m2': 20, 'game1-Blue-m0': 7 });
    expect(getFinalUnitScore(changed, 'Red', 2, null)).toBe(20);
  });
});

describe('confirmation in Save your Buddy', () => {
  it("confirms every member of a team from the defender's score alone", () => {
    const state = buddyRoom({ scores: { 'r0-rm1-p0-m1': 90 } });
    expect([...scoredPlayers(state)].sort()).toEqual(['r1', 'r2', 'r3']);
  });
});
