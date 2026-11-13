import { describe, expect, it } from 'vitest';
import { absentInRoom, answerAbsence, pendingAbsenceQuestions, withSeatsShiftedUp } from '../absences';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { removeRosterUnit } from '../mutations';
import type { TournamentState } from '../types';
import { generated, oneRoomState as build, teamOf as team } from './test-fixtures';

/** Removing a unit from a room in play: the units seated after it move up a seat, and their absence answers move with them. */

function pendingKeys(state: TournamentState): string[] {
  return pendingAbsenceQuestions(state).flatMap((room) => room.questions.map((question) => question.key));
}

/** Each unit of a round's rooms with the answers on its seat, keyed by the part after the seat (`''`, `-g2`, `-m0`...). */
function answersByUnit(state: TournamentState, roundIndex: number): Record<string, Record<string, string>> {
  const seen = new Map<number, number>();
  const result: Record<string, Record<string, string>> = {};
  for (const entry of state.assignments[roundIndex] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    const seat = `r${roundIndex}-rm${entry.room}-p${position}`;
    result[entry.name] = Object.fromEntries(
      Object.entries(state.absences)
        .filter(([key]) => key === seat || key.startsWith(`${seat}-`))
        .map(([key, answer]) => [key.slice(seat.length), answer]),
    );
  }
  return result;
}

describe('removing a unit from a room in play moves the answers with their units', () => {
  const FOUR = { 'r0-rm1-p0': 80, 'r0-rm1-p1': 0, 'r0-rm1-p2': 0, 'r0-rm1-p3': 40 };

  it('keeps B absent and C still asked after A is removed (the audit case)', () => {
    const state = build({ scores: FOUR, absences: { 'r0-rm1-p1': 'absent' } });
    const after = removeRosterUnit(state, 'Ann');
    expect(absentInRoom(after, 0, 1)).toEqual(['Bob']);
    expect(pendingKeys(after)).toEqual(['r0-rm1-p1']);
    expect(after.absences).toEqual({ 'r0-rm1-p0': 'absent' });
  });

  it('drops the answer of the removed unit and leaves the next question pending', () => {
    const state = build({ scores: FOUR, absences: { 'r0-rm1-p1': 'absent' } });
    const after = removeRosterUnit(state, 'Bob');
    expect(after.absences).toEqual({});
    expect(absentInRoom(after, 0, 1)).toEqual([]);
    expect(pendingKeys(after)).toEqual(['r0-rm1-p1']);
  });

  it('changes nothing else when the last seat is removed', () => {
    const state = build({
      scores: FOUR,
      absences: { 'r0-rm1-p1': 'absent', 'r0-rm1-p3': 'absent' },
    });
    const after = removeRosterUnit(state, 'Di');
    expect(after.absences).toEqual({ 'r0-rm1-p1': 'absent' });
  });

  it('moves the answers of every game of a multi-game round together', () => {
    const state = build({
      rounds: [{ numGames: 2 }, {}],
      scores: {
        'r0-rm1-p0-g1': 50,
        'r0-rm1-p0-g2': 60,
        'r0-rm1-p1-g1': 0,
        'r0-rm1-p1-g2': 0,
        'r0-rm1-p2-g1': 0,
        'r0-rm1-p2-g2': 30,
        'r0-rm1-p3-g1': 20,
        'r0-rm1-p3-g2': 10,
      },
      absences: { 'r0-rm1-p1-g1': 'absent', 'r0-rm1-p1-g2': 'absent', 'r0-rm1-p2-g1': 'played' },
    });
    const after = removeRosterUnit(state, 'Ann');
    expect(after.absences).toEqual({
      'r0-rm1-p0-g1': 'absent',
      'r0-rm1-p0-g2': 'absent',
      'r0-rm1-p1-g1': 'played',
    });
    expect(absentInRoom(after, 0, 1)).toEqual(['Bob']);
  });

  it('moves the hand mark of a member of a team with one score with its team', () => {
    const state = build({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      players: [team('Red', ['a', 'b']), team('Blue', ['c', 'd']), team('Green', ['e', 'f'])],
      scores: { 'r0-rm1-p0': 70, 'r0-rm1-p1': 50, 'r0-rm1-p2': 30 },
      absences: { 'r0-rm1-p1-m0': 'absent', 'r0-rm1-p2-m1': 'absent' },
    });
    const after = removeRosterUnit(state, 'Red');
    expect(after.absences).toEqual({ 'r0-rm1-p0-m0': 'absent', 'r0-rm1-p1-m1': 'absent' });
  });
});

describe('withSeatsShiftedUp', () => {
  it('matches a seat exactly: p1 is never the start of p10', () => {
    const answers = {
      'r0-rm1-p1': 'absent',
      'r0-rm1-p10': 'played',
      'r0-rm1-p10-m1': 'absent',
      'r0-rm2-p10': 'absent',
      'r1-rm1-p10': 'absent',
    } as const;
    expect(withSeatsShiftedUp(answers, 0, 1, 1)).toEqual({
      'r0-rm1-p9': 'played',
      'r0-rm1-p9-m1': 'absent',
      'r0-rm2-p10': 'absent',
      'r1-rm1-p10': 'absent',
    });
  });
});

describe('awkward counts: the answers of every other unit stay with that unit', () => {
  it.each([37, 53])(
    'FFA %i with a qualification table, a removal from the first, a middle and the last room',
    (count) => {
      const base = { ...generated(count), started: true };
      const rooms = [
        ...new Set(base.assignments[0].flatMap((entry) => (entry.room === null ? [] : [entry.room]))),
      ];
      for (const room of [rooms[0], rooms[Math.floor(rooms.length / 2)], rooms[rooms.length - 1]]) {
        const units = base.assignments[0].filter((entry) => entry.room === room).map((entry) => entry.name);
        const zeros = Object.fromEntries(
          units.map((_, position) => [
            `r0-rm${room}-p${position}`,
            position === 2 || position === 3 ? 0 : 100 - position,
          ]),
        );
        const scored = { ...base, scores: { ...base.scores, ...zeros } };
        const answered = answerAbsence(scored, [`r0-rm${room}-p2`], 'absent');
        const withTwo = answerAbsence(answered, [`r0-rm${room}-p3`], 'played');
        expect(Object.keys(withTwo.absences)).toHaveLength(2);

        const before = answersByUnit(withTwo, 0);
        const after = answersByUnit(removeRosterUnit(withTwo, units[0]), 0);
        expect(after[units[0]]).toBeUndefined();
        for (const unit of Object.keys(after)) expect(after[unit]).toEqual(before[unit]);
      }
    },
  );
});
