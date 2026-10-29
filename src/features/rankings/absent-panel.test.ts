import { describe, expect, it } from 'vitest';
import { answerAbsence, markSurvivalMemberAbsent } from '../../domain/tournament/absences';
import { oneRoomState, teamOf } from '../../domain/tournament/__tests__/test-fixtures';
import { absentMatchRows, streakText, survivalMarkChoices, survivalMarkRows } from './absent-panel';

const four = ['Ann', 'Bob', 'Cy', 'Di'];

describe('absentMatchRows', () => {
  /** Round 1: Ann absent. Round 2 (in play): Ann and Bob absent. */
  const twoRounds = () => {
    const state = oneRoomState({
      players: four,
      scores: { 'r0-rm1-p0': 0, 'r1-rm1-p0': 0, 'r1-rm1-p1': 0 },
    });
    const answered = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    return answerAbsence({ ...answered, curRound: 1 }, ['r1-rm1-p0', 'r1-rm1-p1'], 'absent');
  };

  it('lists each absence with the round and room, oldest round first', () => {
    expect(absentMatchRows(twoRounds()).map((row) => `${row.label} · ${row.where}`)).toEqual([
      'Ann · Round 1 · Room A',
      'Ann · Round 2 · Room A',
      'Bob · Round 2 · Room A',
    ]);
  });

  it('offers "Mark as played" only for the round in play; an earlier round is read-only', () => {
    expect(absentMatchRows(twoRounds()).map((row) => row.canMarkPlayed)).toEqual([false, true, true]);
  });

  it('carries the unit tools and the streak on the latest row only: "absent 2 rounds running"', () => {
    const rows = absentMatchRows(twoRounds());
    expect(rows.map((row) => row.latest)).toEqual([false, true, true]);
    expect(rows.map((row) => streakText(row.streak))).toEqual(['', 'absent 2 rounds running', '']);
  });

  it('does not count rounds that are not in a row', () => {
    const state = oneRoomState({
      players: four,
      rounds: [{}, {}, {}],
      scores: { 'r0-rm1-p0': 0, 'r2-rm1-p0': 0 },
    });
    const answered = answerAbsence({ ...state, curRound: 0 }, ['r0-rm1-p0'], 'absent');
    const later = answerAbsence({ ...answered, curRound: 2 }, ['r2-rm1-p0'], 'absent');
    expect(absentMatchRows(later).map((row) => row.streak)).toEqual([1, 1]);
  });

  it('keys each row by the score keys marked absent, so "Mark as played" answers exactly them', () => {
    const rows = absentMatchRows(twoRounds());
    expect(rows.map((row) => row.keys)).toEqual([['r0-rm1-p0'], ['r1-rm1-p0'], ['r1-rm1-p1']]);
    const played = answerAbsence(twoRounds(), rows[1].keys, 'played');
    expect(absentMatchRows(played).map((row) => row.label)).toEqual(['Ann', 'Bob']);
  });

  it('lists a sum-of-members team only once every member is absent, with every member key', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 50, 'r0-rm1-p1-m1': 50 },
    });
    const half = answerAbsence(base, ['r0-rm1-p0-m0'], 'absent');
    expect(absentMatchRows(half)).toEqual([]);
    const all = answerAbsence(half, ['r0-rm1-p0-m1'], 'absent');
    expect(absentMatchRows(all).map((row) => [row.label, row.keys])).toEqual([
      ['Red', ['r0-rm1-p0-m0', 'r0-rm1-p0-m1']],
    ]);
  });

  it('is empty without an absentee, and for a tournament without absenceVersion', () => {
    expect(absentMatchRows(oneRoomState({ players: four, scores: { 'r0-rm1-p0': 0 } }))).toEqual([]);
    expect(
      absentMatchRows(oneRoomState({ players: four, version: false, scores: { 'r0-rm1-p0': 0 } })),
    ).toEqual([]);
  });
});

describe('Survival member marks', () => {
  const survival = () =>
    oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'survival-teams',
      players: [teamOf('Red', ['Ann', 'Bea']), teamOf('Blue', ['Cy', 'Di'])],
    });

  it('offers each seated team with its members, and marks one by hand', () => {
    const choices = survivalMarkChoices(survival());
    expect(choices.map((choice) => [choice.teamLabel, choice.members.map((member) => member.name)])).toEqual([
      ['Red', ['Ann', 'Bea']],
      ['Blue', ['Cy', 'Di']],
    ]);
    const marked = markSurvivalMemberAbsent(survival(), 0, 1, 1, 0);
    expect(survivalMarkRows(marked).map((row) => `${row.label} · ${row.where}`)).toEqual([
      'Cy (Blue) · Round 1 · Room A',
    ]);
    expect(survivalMarkChoices(marked)[1].members.map((member) => member.marked)).toEqual([true, false]);
  });

  it('offers nothing outside Survival Teams', () => {
    const sum = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [teamOf('Red', ['Ann', 'Bea'])],
    });
    expect(survivalMarkChoices(sum)).toEqual([]);
    expect(survivalMarkRows(sum)).toEqual([]);
  });
});
