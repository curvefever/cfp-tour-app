import { describe, expect, it } from 'vitest';
import { clickConfirmationAndSeat, moveReturningUnit } from '../returning-unit';
import { returningMoveOf } from '../returning-match';
import type { TournamentState } from '../types';
import { afterRoundOne, byeOf, pickAbsent, roomsOf } from './absentee-fixtures';
import { pressed } from './dependency-play-fixtures';
import { swiss } from './swiss-source-fixtures';

/**
 * A unit marked back after the draw whose room is shared with another likely absentee: the app asks before it moves
 * the unit to a real match (a swap with an absentee that faces a present unit, or taking the place of the opponent
 * against the unit that holds a normal bye), never alone.
 */

const SETUP = { gameFormat: 'individual-1v1' as const };

/** Round 2 drawn for a Swiss of `count` with `absentCount` likely absentees of round 1. */
function roundTwo(count: number, absentCount: number) {
  const start = swiss(count, SETUP);
  const units = pickAbsent(start, absentCount);
  const state = pressed(afterRoundOne(start, units));
  const absent = new Set(units);
  const sharing = roomsOf(state.assignments[1]).find((room) =>
    room.every((name) => absent.has(name)),
  ) as string[];
  return { state, absent, sharing };
}

const roomOf = (state: TournamentState, name: string) =>
  state.assignments[1].find((entry) => entry.name === name)?.room;

describe('the question when a paired absentee comes back', () => {
  it('(a) asks to swap with an absentee that faces a present unit', () => {
    const { state, absent, sharing } = roundTwo(14, 3);
    const [unit, partner] = sharing;
    const facing = [...absent].find((name) => !sharing.includes(name)) as string;
    const click = clickConfirmationAndSeat(state, unit);
    expect(click.notice).toBeNull();
    expect(click.question).toMatchObject({ unit, roundIndex: 1 });
    expect(click.question?.question).toContain(`${unit} is back, but ${partner} in Room`);
    expect(click.question?.question).toContain('to play');
    expect(click.question?.declined).toBe(
      `${unit} is back and stays in Room ${roomLetter(roomOf(state, unit))}.`,
    );
    // Nothing moved until the organiser says yes.
    expect(roomsOf(click.state.assignments[1])).toEqual(roomsOf(state.assignments[1]));

    const moved = moveReturningUnit(click.state, unit);
    if (!moved.ok) throw new Error(moved.error);
    const after = moved.state;
    expect(roomOf(after, unit)).toBe(roomOf(state, facing));
    expect(roomOf(after, facing)).toBe(roomOf(state, unit));
    expect(after.assignments[1].find((entry) => entry.name === partner)?.room).toBe(roomOf(state, partner));
    // Only the two rooms changed.
    const changed = roomsOf(state.assignments[1]).filter(
      (room, index) =>
        JSON.stringify([...room].sort()) !== JSON.stringify([...roomsOf(after.assignments[1])[index]].sort()),
    );
    expect(changed).toHaveLength(2);
  });

  it('(b) asks to take the place of its opponent against the unit that had the bye, who gives the bye to the opponent', () => {
    const { state, sharing } = roundTwo(13, 2);
    const [unit, partner] = sharing;
    const holder = byeOf(state.assignments[1])?.name as string;
    expect(byeOf(state.assignments[1])?.absentBye).toBeUndefined();
    const click = clickConfirmationAndSeat(state, unit);
    expect(click.question?.question).toContain(`${unit} is back, but ${partner} in Room`);
    expect(click.question?.question).toContain(`to play ${holder}, who had the bye?`);

    const moved = moveReturningUnit(click.state, unit);
    if (!moved.ok) throw new Error(moved.error);
    const after = moved.state;
    expect(roomOf(after, holder)).toBe(roomOf(state, partner));
    expect(roomOf(after, unit)).toBe(roomOf(state, unit));
    expect(byeOf(after.assignments[1])).toMatchObject({ name: partner, absentBye: true });
    expect(after.byes[1]).toEqual([partner]);
    expect(after.poolingByeCounts[holder]).toBe((state.poolingByeCounts[holder] ?? 0) - 1);
    expect(after.poolingByeCounts[partner]).toBe((state.poolingByeCounts[partner] ?? 0) + 1);
  });

  it('asks nothing and says so when no real match is free', () => {
    const { state, sharing } = roundTwo(14, 2);
    const [unit, partner] = sharing;
    const click = clickConfirmationAndSeat(state, unit);
    expect(click.question).toBeUndefined();
    expect(click.notice).toBe(
      `${unit} is back. No real match is free, so ${unit} stays in Room ${roomLetter(roomOf(state, unit))} and wins by walkover if ${partner} stays absent.`,
    );
    expect(roomsOf(click.state.assignments[1])).toEqual(roomsOf(state.assignments[1]));
  });

  it('refuses the move when a room it touches got a score in the meantime', () => {
    const { state, absent, sharing } = roundTwo(14, 3);
    const [unit] = sharing;
    const facing = [...absent].find((name) => !sharing.includes(name)) as string;
    const click = clickConfirmationAndSeat(state, unit);
    const room = roomOf(state, facing);
    const scored = { ...click.state, scores: { ...click.state.scores, [`r1-rm${room}-p0`]: 100 } };
    const moved = moveReturningUnit(scored, unit);
    expect(moved.ok).toBe(false);
  });

  it('clears the answers and tie decisions of the two rooms it touches, and keeps the others', () => {
    const { state, absent, sharing } = roundTwo(14, 3);
    const [unit] = sharing;
    const facing = [...absent].find((name) => !sharing.includes(name)) as string;
    const touched = [roomOf(state, unit), roomOf(state, facing)] as number[];
    const other = [1, 2, 3, 4, 5, 6, 7].find((room) => !touched.includes(room)) as number;
    const marked = clickConfirmationAndSeat(state, unit).state;
    const seeded: TournamentState = {
      ...marked,
      absences: {
        ...marked.absences,
        [`r1-rm${touched[0]}-p0`]: 'played',
        [`r1-rm${other}-p0`]: 'played',
      },
      tieResolutions: {
        ...marked.tieResolutions,
        [`r1-rm${touched[1]}-s5`]: [unit],
        [`r1-rm${other}-s5`]: [unit],
      },
    };
    const moved = moveReturningUnit(seeded, unit);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.state.absences[`r1-rm${touched[0]}-p0`]).toBeUndefined();
    expect(moved.state.absences[`r1-rm${other}-p0`]).toBe('played');
    expect(moved.state.tieResolutions[`r1-rm${touched[1]}-s5`]).toBeUndefined();
    expect(moved.state.tieResolutions[`r1-rm${other}-s5`]).toEqual([unit]);
  });

  it('offers no move to a returning unit that already faces a present opponent', () => {
    // 13 with 2 absentees: the two share a room and a present unit holds the bye. Trade one absentee with a present unit
    // of another room, so each absentee faces a present unit: a move for either would take it from a real match.
    const { state, absent, sharing } = roundTwo(13, 2);
    const [unit, other] = sharing;
    const present = state.assignments[1].find((entry) => entry.room !== null && !absent.has(entry.name));
    if (!present) throw new Error('no present unit');
    const mixed: TournamentState = {
      ...state,
      assignments: state.assignments.map((round, index) =>
        index !== 1
          ? round
          : round.map((entry) =>
              entry.name === other
                ? { ...entry, room: present.room }
                : entry.name === present.name
                  ? { ...entry, room: roomOf(state, other) ?? null }
                  : entry,
            ),
      ),
    };
    const click = clickConfirmationAndSeat(mixed, unit);
    expect(click.question).toBeUndefined();
    expect(returningMoveOf(click.state, 1, unit)).toBeNull();
    expect(roomsOf(click.state.assignments[1])).toEqual(roomsOf(mixed.assignments[1]));
  });

  it('keeps the old outcome on a version 3 tournament: no question', () => {
    const { state, sharing } = roundTwo(14, 3);
    const [unit] = sharing;
    const v3: TournamentState = { ...state, gamemodeConfig: { ...state.gamemodeConfig, absenceVersion: 3 } };
    const click = clickConfirmationAndSeat(v3, unit);
    expect(click.question).toBeUndefined();
    expect(returningMoveOf(click.state, 1, unit)).toBeNull();
  });
});

/** "A", "B": a room number as the Bracket letters it. */
function roomLetter(room: number | null | undefined): string {
  return String.fromCharCode(64 + (room ?? 1));
}
