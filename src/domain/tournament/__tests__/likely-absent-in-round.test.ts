import { describe, expect, it } from 'vitest';
import { absentInRoom } from '../absences';
import { answerAbsence } from '../absence-answers';
import { likelyAbsentInRound, markBack } from '../likely-absentees';
import type { TournamentState } from '../types';
import { afterRound1, teamsAfterRound1 } from './absentee-bracket-fixture';

const COUNT = 37;

/** 37 players in round 1 (rooms of 6-8), the first seat of room 1 answered absent, advanced to round 2. */
function afterOneAbsent(version: 2 | 3 = 3): { state: TournamentState; absent: string } {
  const state = afterRound1([[1, 0]], version, COUNT);
  const absent = state.assignments[0].find((entry) => entry.room === 1)?.name;
  if (!absent) throw new Error('no seat in room 1');
  return { state, absent };
}

/** The score key of the unit's seat in round 2. */
function round2Key(state: TournamentState, unit: string): string {
  const entry = state.assignments[1].find((item) => item.name === unit);
  if (!entry || entry.room === null) throw new Error(`${unit} has no seat in round 2`);
  const position = state.assignments[1].filter((item) => item.room === entry.room).indexOf(entry);
  return `r1-rm${entry.room}-p${position}`;
}

describe('likelyAbsentInRound', () => {
  it('marks the player answered absent in round 1 and drawn into round 2, and nobody else', () => {
    const { state, absent } = afterOneAbsent();
    expect(state.rounds[0].rooms.reduce((sum, size) => sum + size, 0)).toBe(COUNT);
    expect(state.rounds[0].rooms.every((size) => size >= 6 && size <= 8)).toBe(true);
    expect([...likelyAbsentInRound(state, 1)]).toEqual([absent]);
  });

  it('looks at one room only when given its number', () => {
    const { state, absent } = afterOneAbsent();
    const room = state.assignments[1].find((entry) => entry.name === absent)?.room ?? 0;
    expect([...likelyAbsentInRound(state, 1, room)]).toEqual([absent]);
    const others = state.rounds[1].rooms.map((_, index) => index + 1).filter((number) => number !== room);
    for (const other of others) expect(likelyAbsentInRound(state, 1, other).size).toBe(0);
  });

  it('marks nothing in round 1 itself: there is no earlier absence', () => {
    const { state } = afterOneAbsent();
    expect(likelyAbsentInRound(state, 0).size).toBe(0);
  });

  it('drops the player once marked back', () => {
    const { state, absent } = afterOneAbsent();
    expect(likelyAbsentInRound(markBack(state, absent), 1).size).toBe(0);
  });

  it('drops the player once it scores, keeps it on an unanswered 0, and drops it when that 0 is answered absent', () => {
    const { state, absent } = afterOneAbsent();
    const key = round2Key(state, absent);
    const scored = { ...state, scores: { ...state.scores, [key]: 50 } };
    expect(likelyAbsentInRound(scored, 1).size).toBe(0);

    const zero = { ...state, scores: { ...state.scores, [key]: 0 } };
    expect([...likelyAbsentInRound(zero, 1)]).toEqual([absent]);

    const answered = answerAbsence(zero, [key], 'absent');
    expect(likelyAbsentInRound(answered, 1).size).toBe(0);
    const room = answered.assignments[1].find((entry) => entry.name === absent)?.room ?? 0;
    expect(absentInRoom(answered, 1, room)).toContain(absent);
  });

  it('drops the player when the 0 is answered played', () => {
    const { state, absent } = afterOneAbsent();
    const key = round2Key(state, absent);
    const zero = { ...state, scores: { ...state.scores, [key]: 0 } };
    expect(likelyAbsentInRound(answerAbsence(zero, [key], 'played'), 1).size).toBe(0);
  });

  it('marks nothing before absence tracking (absenceVersion 3)', () => {
    const { state } = afterOneAbsent(2);
    expect(likelyAbsentInRound(state, 1).size).toBe(0);
  });

  it('marks a team whose every member was absent, not one with a member back, in 13 teams of two', () => {
    // Team of seat 0 of room 1: both members absent. Team of seat 1: member 0 absent only.
    const state = teamsAfterRound1([
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    const seats = state.assignments[0].filter((entry) => entry.room === 1);
    const [bothAbsent, oneAbsent] = [seats[0].name, seats[1].name];
    const marked = likelyAbsentInRound(state, 1);
    expect([...marked]).toEqual([bothAbsent]);
    expect(marked.has(oneAbsent)).toBe(false);
  });
});
