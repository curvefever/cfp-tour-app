import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absence-answers';
import { roomRows } from '../room-rows';
import { SHARED_TIE_MARK } from '../scoring';
import type { TournamentState } from '../types';
import { r1WithFiveAbsent } from './absentee-bracket-fixture';
import { scoreRooms } from './fair-cut-fixtures';
import { generated } from './test-fixtures';

/** FFA 24 in rooms of 8, single elimination with no pooling: Round 1 is a warm-up round, its Room A seats P-names in a fixed order. */
const started = (): TournamentState => ({
  ...generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
  started: true,
});
const seatsOfRoomA = (state: TournamentState) =>
  state.assignments[0].filter((entry) => entry.room === 1).map((entry) => entry.name);
const view = (state: TournamentState, ordered = true) =>
  roomRows(state, 0, 1, { ordered }).rows.map(({ name, place, shared, absent, rank, fate }) => ({
    name,
    place,
    shared,
    absent,
    rank,
    fate,
  }));

describe('roomRows: a room keeps its seat order until every unit is scored', () => {
  it('lists the units in seat order, with no place, while no score is typed', () => {
    const state = started();
    const seats = seatsOfRoomA(state);
    const result = roomRows(state, 0, 1);
    expect(result.complete).toBe(false);
    expect(result.rows.map((row) => row.name)).toEqual(seats);
    expect(result.rows.map((row) => [row.place, row.rank, row.position])).toEqual(
      seats.map((_, index) => [null, index + 1, index]),
    );
  });

  it('keeps the seat order while one score is missing, and names the scores it has', () => {
    const state = scoreRooms(started(), 0, [[5, 9, 3, 7, 1, 8, 2]]);
    const result = roomRows(state, 0, 1);
    expect(result.complete).toBe(false);
    expect(result.rows.map((row) => row.score)).toEqual([5, 9, 3, 7, 1, 8, 2, null]);
    expect(result.rows.every((row) => row.place === null)).toBe(true);
  });

  it('orders by score with places once the room is complete', () => {
    const state = scoreRooms(started(), 0, [[5, 9, 3, 7, 1, 8, 2, 4]]);
    const seats = seatsOfRoomA(state);
    const result = roomRows(state, 0, 1);
    expect(result.complete).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual([1, 5, 3, 0, 7, 2, 6, 4].map((seat) => seats[seat]));
    expect(result.rows.map((row) => [row.place, row.rank, row.shared])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((place) => [place, place, false]),
    );
  });

  it('keeps the seat order of a complete room when it is not to be ordered (a round not reached)', () => {
    const state = scoreRooms(started(), 0, [[5, 9, 3, 7, 1, 8, 2, 4]]);
    const result = roomRows(state, 0, 1, { ordered: false });
    expect(result.complete).toBe(true);
    expect(result.rows.map((row) => row.name)).toEqual(seatsOfRoomA(state));
    expect(result.rows.every((row) => row.place === null && !row.shared)).toBe(true);
  });
});

describe('roomRows: a tie', () => {
  const tied = () => scoreRooms(started(), 0, [[9, 9, 5, 4, 3, 2, 1, 0]]);

  it('places an unresolved tie one after the other, not shared', () => {
    expect(view(tied()).map((row) => [row.place, row.shared])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, false],
      [5, false],
      [6, false],
      [7, false],
      [8, false],
    ]);
  });

  it('gives a shared tie one place for both units, and the next unit the place after them', () => {
    const state = tied();
    const [first, second] = seatsOfRoomA(state);
    const shared = { ...state, tieResolutions: { 'r0-rm1-s9': [SHARED_TIE_MARK, first, second] } };
    const rows = view(shared);
    expect(rows.slice(0, 3).map((row) => [row.place, row.rank, row.shared])).toEqual([
      [1, 1, true],
      [1, 1, true],
      [3, 3, false],
    ]);
  });
});

describe('roomRows: the absentees come after every unit that was present', () => {
  it('ranks an absentee of a single-elimination room after the others, with no place, and cuts it', () => {
    const state = started();
    const scored = scoreRooms(state, 0, [[5, 9, 3, 7, 1, 8, 2, 0]]);
    const seats = seatsOfRoomA(state);
    const marked = answerAbsence(scored, ['r0-rm1-p7'], 'absent');
    const rows = view(marked);
    expect(rows.map((row) => row.name)).toEqual([1, 5, 3, 0, 2, 6, 4, 7].map((seat) => seats[seat]));
    expect(rows.slice(0, 7).every((row) => !row.absent && row.fate === undefined)).toBe(true);
    expect(rows[7]).toEqual({
      name: seats[7],
      place: null,
      shared: false,
      absent: true,
      rank: 8,
      fate: 'eliminate',
    });
    expect(rows.slice(0, 7).map((row) => row.place)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('puts the absentees of a Custom bracket room last, in seat order, each with the rank of its seat after the present units (the one whose seat leads nowhere is cut)', () => {
    const state = r1WithFiveAbsent();
    const rows = roomRows(state, state.curRound, 1).rows;
    expect(rows.map((row) => [row.absent, row.rank, row.place, row.fate])).toEqual([
      [false, 1, 1, undefined],
      [false, 2, 2, undefined],
      [false, 3, 3, undefined],
      [true, 4, null, 'eliminate'],
      [true, 5, null, 'rank'],
      [true, 6, null, 'rank'],
      [true, 7, null, 'rank'],
      [true, 8, null, 'rank'],
    ]);
    const roomB = roomRows(state, state.curRound, 2).rows;
    expect(roomB.every((row) => !row.absent && row.fate === undefined)).toBe(true);
  });
});
