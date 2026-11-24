import { describe, expect, it } from 'vitest';
import { declaredSchedule } from '../declared-schedule';
import { roundExitRule } from '../room-exits';
import { indexOf } from './dependency-play-fixtures';
import { built } from './layered-test-support';

describe('declaredSchedule', () => {
  it('clears every line-up and leaves the rounds as they are', () => {
    const state = built(31);
    const declared = declaredSchedule(state);
    expect(declared.rounds).toBe(state.rounds);
    expect(declared.assignments).toHaveLength(state.assignments.length);
    expect(declared.assignments.every((round) => round.length === 0)).toBe(true);
  });

  it('describes a room at its declared size even after a removal shrank its line-up', () => {
    const state = built(31);
    const round = indexOf(state, 'Semi-Final A');
    const lineUp = (seats: number) =>
      Array.from({ length: seats }, (_, seat) => ({ name: `P${seat + 1}`, room: 1 }));
    const withSeats = (seats: number) => {
      const assignments = state.assignments.slice();
      for (let index = assignments.length; index <= round; index += 1) assignments.push([]);
      assignments[round] = lineUp(seats);
      return { ...state, assignments };
    };
    const bandsOf = (value: typeof state) => roundExitRule(value, round);
    expect(bandsOf(withSeats(7))).not.toEqual(bandsOf(withSeats(8)));
    expect(bandsOf(declaredSchedule(withSeats(7)))).toEqual(bandsOf(declaredSchedule(withSeats(8))));
  });
});
