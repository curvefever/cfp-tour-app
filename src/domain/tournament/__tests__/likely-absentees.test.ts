import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import {
  isLikelyAbsent,
  latestAbsenceRound,
  likelyAbsentees,
  markBack,
  unmarkBack,
} from '../likely-absentees';
import { ONE_SCORE_PER_TEAM } from '../formats';
import {
  renameIndividual,
  renameTeamMember,
  resetRoster,
  resetTournamentState,
  swapIndividual,
} from '../mutations';
import type { TournamentState } from '../types';
import { oneRoomState, teamOf } from './test-fixtures';

const four = ['Ann', 'Bob', 'Cy', 'Di'];

/** A tournament of absenceVersion 3 whose every round seats the four in one room. */
function threeRounds(scores: TournamentState['scores'], version: 1 | 2 | 3 = 3): TournamentState {
  const state = oneRoomState({ players: four, rounds: [{}, {}, {}], scores });
  return { ...state, gamemodeConfig: { ...state.gamemodeConfig, absenceVersion: version } };
}

/** Round 1 played with Ann absent (a 0 answered absent), the others scored. */
function annAbsentInRound1(version: 1 | 2 | 3 = 3): TournamentState {
  const state = threeRounds({ 'r0-rm1-p0': 0, 'r0-rm1-p1': 50, 'r0-rm1-p2': 40, 'r0-rm1-p3': 30 }, version);
  return answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
}

describe('likely absentees', () => {
  it('a unit absent in round 1 is likely absent for round 2, and only that unit', () => {
    const state = annAbsentInRound1();
    expect(latestAbsenceRound(state, 'Ann', 1)).toBe(0);
    expect(isLikelyAbsent(state, 'Ann', 1)).toBe(true);
    expect([...likelyAbsentees(state, 1)]).toEqual(['Ann']);
  });

  it('is not likely absent for the round it was absent from', () => {
    expect(likelyAbsentees(annAbsentInRound1(), 0).size).toBe(0);
  });

  it('marked back it is no longer likely absent, and unmarking brings it back', () => {
    const back = markBack(annAbsentInRound1(), 'Ann');
    expect(back.backFromAbsence).toEqual({ Ann: 0 });
    expect(isLikelyAbsent(back, 'Ann', 1)).toBe(false);
    expect(likelyAbsentees(back, 1).size).toBe(0);
    const undone = unmarkBack(back, 'Ann');
    expect(undone.backFromAbsence).toEqual({});
    expect(isLikelyAbsent(undone, 'Ann', 1)).toBe(true);
  });

  it('answers only a unit that is likely absent: another player or an unmarked one changes nothing', () => {
    const state = annAbsentInRound1();
    expect(markBack(state, 'Bob')).toBe(state);
    expect(unmarkBack(state, 'Ann')).toBe(state);
    expect(markBack(markBack(state, 'Ann'), 'Ann').backFromAbsence).toEqual({ Ann: 0 });
  });

  it('absent in round 1 and played in round 2: not likely absent for round 3', () => {
    const state = threeRounds({ 'r0-rm1-p0': 0, 'r1-rm1-p0': 50, 'r1-rm1-p1': 40 });
    const answered = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    expect(isLikelyAbsent(answered, 'Ann', 1)).toBe(true);
    expect(isLikelyAbsent(answered, 'Ann', 2)).toBe(false);
    expect(likelyAbsentees(answered, 2).size).toBe(0);
  });

  it('absent in rounds 1 and 2, marked back after round 1 only: likely absent for round 3', () => {
    const state = threeRounds({ 'r0-rm1-p0': 0, 'r1-rm1-p0': 0 });
    const backAfterOne = markBack(answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent'), 'Ann');
    const absentAgain = answerAbsence({ ...backAfterOne, curRound: 1 }, ['r1-rm1-p0'], 'absent');
    expect(isLikelyAbsent(absentAgain, 'Ann', 2)).toBe(true);
    expect(markBack(absentAgain, 'Ann').backFromAbsence).toEqual({ Ann: 1 });
    expect(isLikelyAbsent(markBack(absentAgain, 'Ann'), 'Ann', 2)).toBe(false);
  });

  it('a 0 not answered yet, or a bye, does not count as playing: the earlier absence stands', () => {
    const open = threeRounds({ 'r0-rm1-p0': 0, 'r1-rm1-p0': 0 });
    const answered = answerAbsence({ ...open, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    expect(isLikelyAbsent(answered, 'Ann', 2)).toBe(true);
    const bye = {
      ...answered,
      assignments: answered.assignments.map((round, index) =>
        index === 1 ? round.map((entry) => (entry.name === 'Ann' ? { ...entry, room: null } : entry)) : round,
      ),
    };
    expect(isLikelyAbsent(bye, 'Ann', 2)).toBe(true);
  });

  it('a 0 answered "played" is a round played', () => {
    const state = threeRounds({ 'r0-rm1-p0': 0, 'r1-rm1-p0': 0 });
    const first = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    const played = answerAbsence({ ...first, curRound: 1 }, ['r1-rm1-p0'], 'played');
    expect(isLikelyAbsent(played, 'Ann', 2)).toBe(false);
  });

  it('a team with every member absent is likely absent, and any member marked back brings the team back', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      rounds: [{}, {}],
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 50, 'r0-rm1-p1-m1': 50 },
    });
    const state = { ...base, gamemodeConfig: { ...base.gamemodeConfig, absenceVersion: 3 as const } };
    const half = answerAbsence(state, ['r0-rm1-p0-m0'], 'absent');
    expect(likelyAbsentees(half, 1).size).toBe(0);
    const all = answerAbsence(half, ['r0-rm1-p0-m1'], 'absent');
    expect([...likelyAbsentees(all, 1)]).toEqual(['Red']);
    const back = markBack(all, 'b');
    expect(back.backFromAbsence).toEqual({ b: 0 });
    expect(likelyAbsentees(back, 1).size).toBe(0);
  });

  it('in One score per team a 0 is never asked, so an unanswered 0 in a later round is a round played', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      rounds: [{}, {}, {}],
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 50, 'r1-rm1-p0': 0, 'r1-rm1-p1': 50 },
    });
    const state = { ...base, gamemodeConfig: { ...base.gamemodeConfig, absenceVersion: 3 as const } };
    const absent = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    expect([...likelyAbsentees(absent, 1)]).toEqual(['Red']);
    expect(isLikelyAbsent(absent, 'Red', 2)).toBe(false);
  });

  it('a version 2 state never has likely absentees, and marking back changes nothing', () => {
    const state = annAbsentInRound1(2);
    expect(likelyAbsentees(state, 1).size).toBe(0);
    expect(isLikelyAbsent(state, 'Ann', 1)).toBe(false);
    expect(markBack(state, 'Ann')).toBe(state);
  });

  it('a swapped-in replacement is not likely absent: the absence was the swapped-out unit’s', () => {
    const marked = annAbsentInRound1();
    const swapped = swapIndividual({ ...marked, reserves: ['Zed'] }, 'Ann', 'Zed');
    expect(isLikelyAbsent(swapped, 'Zed', 1)).toBe(false);
    expect(likelyAbsentees(swapped, 1).size).toBe(0);
  });
});

describe('the back marks of a tournament', () => {
  it('follow a renamed team member: the mark moves to the new name and the team stays back', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      rounds: [{}, {}],
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 50, 'r0-rm1-p1-m1': 50 },
    });
    const state = { ...base, gamemodeConfig: { ...base.gamemodeConfig, absenceVersion: 3 as const } };
    const absent = answerAbsence(state, ['r0-rm1-p0-m0', 'r0-rm1-p0-m1'], 'absent');
    const renamed = renameTeamMember(markBack(absent, 'b'), 'Red', 1, 'bee');
    expect(renamed.backFromAbsence).toEqual({ bee: 0 });
    expect(likelyAbsentees(renamed, 1).size).toBe(0);
  });

  it('follow a rename', () => {
    const renamed = renameIndividual(markBack(annAbsentInRound1(), 'Ann'), 'Ann', 'Anna');
    expect(renamed.backFromAbsence).toEqual({ Anna: 0 });
    expect(isLikelyAbsent(renamed, 'Anna', 1)).toBe(false);
  });

  it('are cleared by Back to draft and Clear roster', () => {
    const back = markBack(annAbsentInRound1(), 'Ann');
    expect(resetTournamentState(back).backFromAbsence).toEqual({});
    expect(resetRoster(back).backFromAbsence).toEqual({});
  });
});
