import { describe, expect, it } from 'vitest';
import {
  absentInRoom,
  answerAbsence,
  clearAbsenceAnswer,
  hasBlockingAbsenceQuestions,
  isMarkedAbsent,
  isMemberMarkedAbsent,
  markSurvivalMemberAbsent,
  pendingAbsenceQuestions,
  playersInPlay,
  unmarkSurvivalMemberAbsent,
  usesAbsences,
  withoutRoundAbsences,
} from '../absences';
import { setRoundScore, swapIndividual } from '../mutations';
import { discardDrawsAfter } from '../redraw';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { generated, oneRoomState as build, teamOf as team } from './test-fixtures';
import { withoutAbsenceRule } from './play-through';

const NAMES = ['Ann', 'Bob', 'Cy', 'Di'];

function keysOf(state: TournamentState): string[] {
  return pendingAbsenceQuestions(state).flatMap((room) => room.questions.map((question) => question.key));
}

describe('questions per mode', () => {
  it('asks every score of 0 in an individual round, and nothing for blank or non-zero scores', () => {
    const state = build({ scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 120, 'r0-rm1-p2': null, 'r0-rm1-p3': 0 } });
    expect(keysOf(state)).toEqual(['r0-rm1-p0', 'r0-rm1-p3']);
    expect(pendingAbsenceQuestions(state)).toEqual([
      {
        roundIndex: 0,
        room: 1,
        questions: [
          { key: 'r0-rm1-p0', roundIndex: 0, room: 1, position: 0, unit: 'Ann' },
          { key: 'r0-rm1-p3', roundIndex: 0, room: 1, position: 3, unit: 'Di' },
        ],
      },
    ]);
  });

  it('asks each member of a sum-of-members team, and not a vacant slot', () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', null])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 90, 'r0-rm1-p1-m0': 0, 'r0-rm1-p1-m1': 0 },
    });
    expect(keysOf(state)).toEqual(['r0-rm1-p0-m0', 'r0-rm1-p1-m0']);
    expect(pendingAbsenceQuestions(state)[0].questions.map((question) => question.memberIndex)).toEqual([
      0, 0,
    ]);
  });

  it('asks each member in Save your Buddy', () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'designated-player',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0-m1': 0 },
    });
    expect(keysOf(state)).toEqual(['r0-rm1-p0-m1']);
  });

  it("asks only the team's key in Survival Teams", () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'survival-teams',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p0-m0': 0, 'r0-rm1-p1': 55 },
    });
    expect(keysOf(state)).toEqual(['r0-rm1-p0']);
  });

  it('asks each game of a Semis room separately, tagged with the game', () => {
    const state = build({
      rounds: [{ isSemis: true, numGames: 2 }, {}],
      scores: { 'r0-rm1-p0-g1': 0, 'r0-rm1-p0-g2': 40, 'r0-rm1-p1-g2': 0 },
    });
    expect(pendingAbsenceQuestions(state)[0].questions).toMatchObject([
      { key: 'r0-rm1-p0-g1', game: 1 },
      { key: 'r0-rm1-p1-g2', game: 2 },
    ]);
  });

  it('asks about every round of the column in play only', () => {
    const state = build({ scores: { 'r0-rm1-p0': 0, 'r1-rm1-p0': 0 } });
    expect(keysOf(state)).toEqual(['r0-rm1-p0']);
  });

  it('does not ask in the Final or the grand final', () => {
    const final = build({ rounds: [{ isFinal: true }, {}], scores: { 'r0-rm1-p0': 0 } });
    const grand = build({ rounds: [{ bracket: 'grand-final' }, {}], scores: { 'r0-rm1-p0': 0 } });
    expect(pendingAbsenceQuestions(final)).toEqual([]);
    expect(pendingAbsenceQuestions(grand)).toEqual([]);
  });

  it('asks nothing in a tournament without absenceVersion', () => {
    const state = build({ version: false, scores: { 'r0-rm1-p0': 0 } });
    expect(usesAbsences(state)).toBe(false);
    expect(pendingAbsenceQuestions(state)).toEqual([]);
    expect(hasBlockingAbsenceQuestions(state)).toBe(false);
  });

  it('a generated tournament carries the version and an empty absences record', () => {
    const state = generated(16);
    expect(usesAbsences(state)).toBe(true);
    expect(state.absences).toEqual({});
    expect(usesAbsences(withoutAbsenceRule(state))).toBe(false);
  });
});

describe('answering', () => {
  it('records an answer and removes the question', () => {
    const state = build({ scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0 } });
    const next = answerAbsence(state, ['r0-rm1-p0'], 'absent');
    expect(keysOf(next)).toEqual(['r0-rm1-p1']);
    expect(isMarkedAbsent(next, 'r0-rm1-p0')).toBe(true);
    expect(absentInRoom(next, 0, 1)).toEqual(['Ann']);
  });

  it('a played answer keeps the unit present', () => {
    const state = answerAbsence(build({ scores: { 'r0-rm1-p0': 0 } }), ['r0-rm1-p0'], 'played');
    expect(keysOf(state)).toEqual([]);
    expect(isMarkedAbsent(state, 'r0-rm1-p0')).toBe(false);
  });

  it('ignores a key that is not a score of 0 in the column in play', () => {
    const state = build({ scores: { 'r0-rm1-p0': 30, 'r1-rm1-p0': 0 } });
    expect(answerAbsence(state, ['r0-rm1-p0', 'r1-rm1-p0', 'nope'], 'absent')).toBe(state);
  });

  it('clearAbsenceAnswer asks the question again, only in the column in play', () => {
    const answered = answerAbsence(build({ scores: { 'r0-rm1-p0': 0 } }), ['r0-rm1-p0'], 'absent');
    expect(keysOf(clearAbsenceAnswer(answered, 'r0-rm1-p0'))).toEqual(['r0-rm1-p0']);
    const later = {
      ...answered,
      curRound: 1,
      absences: { ...answered.absences, 'r0-rm1-p0': 'absent' as const },
    };
    expect(clearAbsenceAnswer(later, 'r0-rm1-p0')).toBe(later);
  });

  it('a team is absent from a room when every member that exists is absent', () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', null])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 0 },
    });
    const one = answerAbsence(state, ['r0-rm1-p0-m0', 'r0-rm1-p1-m0'], 'absent');
    expect(absentInRoom(one, 0, 1)).toEqual(['Blue']);
    expect(playersInPlay(one, 0, 1, 0)).toBe(1);
    expect(playersInPlay(one, 0, 1, 1)).toBe(0);
    const both = answerAbsence(one, ['r0-rm1-p0-m1'], 'absent');
    expect(absentInRoom(both, 0, 1)).toEqual(['Red', 'Blue']);
    expect(playersInPlay(both, 0, 1, 0)).toBe(0);
  });

  it('counts players in play only for sum of members, and as 1 without absenceVersion', () => {
    const teams = [team('Red', ['a', 'b']), team('Blue', ['c', 'd'])];
    const buddy = build({ gameFormat: 'team-2v2v2v2', rule: 'designated-player', players: teams });
    const sum = build({ gameFormat: 'team-2v2v2v2', rule: 'sum-members', players: teams, version: false });
    expect(playersInPlay(buddy, 0, 1, 0)).toBe(1);
    expect(playersInPlay(sum, 0, 1, 0)).toBe(1);
    expect(playersInPlay(build({ players: ['A', 'B'] }), 0, 1, 0)).toBe(1);
  });

  it('a Semis unit is absent only if absent in every game; in some games it is present', () => {
    const state = build({
      rounds: [{ isSemis: true, numGames: 2 }, {}],
      scores: { 'r0-rm1-p0-g1': 0, 'r0-rm1-p0-g2': 0, 'r0-rm1-p1-g1': 0, 'r0-rm1-p1-g2': 70 },
    });
    const answered = answerAbsence(state, ['r0-rm1-p0-g1', 'r0-rm1-p0-g2', 'r0-rm1-p1-g1'], 'absent');
    expect(absentInRoom(answered, 0, 1)).toEqual(['Ann']);
  });
});

describe('Survival member marks', () => {
  const survival = () =>
    build({
      gameFormat: 'team-2v2v2v2',
      rule: 'survival-teams',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', 'd'])],
    });

  it('marks a member by hand, for display only, and takes the mark back', () => {
    const marked = markSurvivalMemberAbsent(survival(), 0, 1, 0, 1);
    expect(isMemberMarkedAbsent(marked, 'r0-rm1-p0-m1')).toBe(true);
    expect(absentInRoom(marked, 0, 1)).toEqual([]);
    expect(unmarkSurvivalMemberAbsent(marked, 0, 1, 0, 1).absences).toEqual({});
  });

  it('ignores a missing member, another mode and a round outside the column in play', () => {
    const state = survival();
    expect(markSurvivalMemberAbsent(state, 0, 1, 0, 2)).toBe(state);
    expect(markSurvivalMemberAbsent(state, 1, 1, 0, 0)).toBe(state);
    const sum = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [team('Red', ['a', 'b'])],
    });
    expect(markSurvivalMemberAbsent(sum, 0, 1, 0, 0)).toBe(sum);
  });
});

describe('blocking', () => {
  it('blocks Next Round in an individual round until every 0 is answered', () => {
    const state = build({ scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 60, 'r0-rm1-p2': 50, 'r0-rm1-p3': 40 } });
    expect(hasBlockingAbsenceQuestions(state)).toBe(true);
    const blocked = advanceTournamentRound(state);
    expect(blocked).toMatchObject({
      status: 'blocked',
      reason: 'pending-absences',
      message: 'Answer every score of 0 before advancing.',
    });
    const answered = answerAbsence(state, ['r0-rm1-p0'], 'played');
    expect(hasBlockingAbsenceQuestions(answered)).toBe(false);
    expect(advanceTournamentRound(answered)).not.toMatchObject({ reason: 'pending-absences' });
  });

  it('does not block in Survival Teams, where an unanswered 0 counts as played', () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: 'survival-teams',
      players: [team('Red', ['a', 'b']), team('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 80 },
    });
    expect(pendingAbsenceQuestions(state)).toHaveLength(1);
    expect(hasBlockingAbsenceQuestions(state)).toBe(false);
  });
});

describe('setRoundScore keeps answers honest', () => {
  const answered = () => answerAbsence(build({ scores: { 'r0-rm1-p0': 0 } }), ['r0-rm1-p0'], 'absent');

  it('re-typing the same 0 keeps the answer', () => {
    const next = setRoundScore(answered(), 'r0-rm1-p0', '0', 0, 1);
    expect(isMarkedAbsent(next, 'r0-rm1-p0')).toBe(true);
    expect(keysOf(next)).toEqual([]);
  });

  it('a changed score drops the answer, so a corrected 0 asks again', () => {
    const typed = setRoundScore(answered(), 'r0-rm1-p0', '75', 0, 1);
    expect(typed.absences).toEqual({});
    expect(keysOf(setRoundScore(typed, 'r0-rm1-p0', '0', 0, 1))).toEqual(['r0-rm1-p0']);
  });

  it('clearing the score drops the answer too', () => {
    expect(setRoundScore(answered(), 'r0-rm1-p0', '', 0, 1).absences).toEqual({});
  });

  it('a stale answer under a non-zero score reads as present', () => {
    const stale = { ...answered(), scores: { 'r0-rm1-p0': 12 } };
    expect(stale.absences['r0-rm1-p0']).toBe('absent');
    expect(isMarkedAbsent(stale, 'r0-rm1-p0')).toBe(false);
    expect(absentInRoom(stale, 0, 1)).toEqual([]);
  });
});

describe('cleanup', () => {
  it('a swap clears the outgoing seat only, in the round in play', () => {
    const state = build({
      players: [...NAMES],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0 },
      absences: { 'r0-rm1-p0': 'absent', 'r0-rm1-p1': 'absent', 'r1-rm1-p0': 'absent' },
    });
    const next = swapIndividual({ ...state, reserves: ['Zed'] }, 'Ann', 'Zed');
    expect(next.absences).toEqual({ 'r0-rm1-p1': 'absent', 'r1-rm1-p0': 'absent' });
  });

  it('a swap keeps another seat whose number starts the same (p1 and p10)', () => {
    const names = Array.from({ length: 11 }, (_, index) => `P${index}`);
    const state = build({
      players: names,
      scores: { 'r0-rm1-p1': 0, 'r0-rm1-p10': 0 },
      absences: { 'r0-rm1-p1': 'absent', 'r0-rm1-p10': 'absent' },
    });
    const next = swapIndividual({ ...state, reserves: ['Zed'] }, 'P1', 'Zed');
    expect(next.absences).toEqual({ 'r0-rm1-p10': 'absent' });
  });

  it('discarding the draws after a round drops the answers of the discarded rounds', () => {
    const state = build({
      scores: { 'r0-rm1-p0': 0, 'r1-rm1-p0': 0 },
      absences: { 'r0-rm1-p0': 'absent', 'r1-rm1-p0': 'absent' },
    });
    expect(discardDrawsAfter(state, 0).absences).toEqual({ 'r0-rm1-p0': 'absent' });
  });

  it('withoutRoundAbsences drops one round and nothing else', () => {
    expect(
      withoutRoundAbsences({ 'r1-rm1-p0': 'absent', 'r10-rm1-p0': 'played', 'r2-rm1-p0': 'absent' }, 1),
    ).toEqual({ 'r10-rm1-p0': 'played', 'r2-rm1-p0': 'absent' });
  });
});
