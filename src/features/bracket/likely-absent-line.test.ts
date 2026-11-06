import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../../domain/tournament/absences';
import { markBack } from '../../domain/tournament/likely-absentees';
import { swapIndividual } from '../../domain/tournament/mutations';
import { currentColumn } from '../../domain/tournament/round-columns';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { afterRound1, r1WithFiveAbsent } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import { oneRoomState, teamOf } from '../../domain/tournament/__tests__/test-fixtures';
import { likelyAbsentChips } from './likely-absent-line';

const unitsOf = (state: TournamentState) => likelyAbsentChips(state).map((chip) => chip.unit);

/** The units seated in the round, room by room. */
const seatedOrder = (state: TournamentState, roundIndex: number) =>
  [...state.assignments[roundIndex]]
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => (a.room ?? Infinity) - (b.room ?? Infinity) || a.index - b.index)
    .map((entry) => entry.name);

// 31 players, rooms 8, 8, 8, 7; round 1 scored, six seats answered absent, advanced to round 2.
const SIX_ABSENT: Array<[number, number]> = [1, 2].flatMap((room) =>
  [0, 1, 2].map((position) => [room, position] as [number, number]),
);

describe('the units of the Bracket’s likely-absent line', () => {
  it('after the draw lists the units of the new round that were absent last time, in room order', () => {
    const state = afterRound1(SIX_ABSENT, 3);
    const absent = SIX_ABSENT.map(
      ([room, position]) => state.assignments[0].filter((e) => e.room === room)[position].name,
    );
    expect(unitsOf(state).sort()).toEqual([...absent].sort());
    const order = seatedOrder(state, 1);
    const listed = unitsOf(state);
    expect(listed).toEqual([...listed].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(likelyAbsentChips(state)[0].title).toBe('Absent in Round 1 — click when back');
    expect(likelyAbsentChips(state)[0].clickName).toBe(likelyAbsentChips(state)[0].unit);
  });

  it('before Next Round lists the units answered absent in the round in play', () => {
    const state = r1WithFiveAbsent();
    const listed = unitsOf(state);
    expect(listed).toHaveLength(5);
    const roomA = state.assignments[state.curRound].filter((entry) => entry.room === 1).map((e) => e.name);
    expect(listed).toEqual(roomA.slice(3));
  });

  it('does not list a unit with a score in the new round, nor one marked back', () => {
    const state = afterRound1(SIX_ABSENT, 3);
    const [first, second, third] = unitsOf(state);
    const back = markBack(state, first);
    expect(unitsOf(back)).not.toContain(first);
    expect(unitsOf(back)).toHaveLength(5);
    const room = state.assignments[1].find((entry) => entry.name === second)?.room;
    const position = state.assignments[1].filter((e) => e.room === room).findIndex((e) => e.name === second);
    const played = { ...state, scores: { ...state.scores, [`r1-rm${room}-p${position}`]: 55 } };
    expect(unitsOf(played)).not.toContain(second);
    expect(unitsOf(played)).toContain(third);
  });

  it('lists nobody in a version 2 tournament', () => {
    expect(unitsOf(afterRound1(SIX_ABSENT, 2))).toEqual([]);
  });

  it('leaves out a swapped-out unit: the replacement took its seat in the round in play and is not absent itself', () => {
    const state = afterRound1(SIX_ABSENT, 3);
    const [swappedOut] = unitsOf(state);
    const swapped = swapIndividual({ ...state, reserves: ['Zed'] }, swappedOut, 'Zed');
    expect(swapped.assignments[1].some((entry) => entry.name === swappedOut)).toBe(false);
    expect(swapped.assignments[0].some((entry) => entry.name === swappedOut)).toBe(true);
    expect(unitsOf(swapped)).not.toContain(swappedOut);
    expect(unitsOf(swapped)).not.toContain('Zed');
    expect(unitsOf(swapped)).toHaveLength(5);
  });

  it('leaves out a withdrawn unit whatever the assignments still hold', () => {
    const state = afterRound1(SIX_ABSENT, 3);
    const [gone] = unitsOf(state);
    const withdrawn: TournamentState = {
      ...state,
      withdrawnUnits: [
        { name: gone, label: gone, members: null, playedAnyMatch: false, reason: 'removed', round: 1 },
      ],
    };
    expect(unitsOf(withdrawn)).not.toContain(gone);
    expect(unitsOf(withdrawn)).toHaveLength(5);
  });

  it('lists a unit of a side round of the column in play', () => {
    const column = advanceTournamentRound(r1WithFiveAbsent());
    if (column.status !== 'advanced') throw new Error(`could not advance: ${column.status}`);
    const state = column.state;
    const { start, end } = currentColumn(state);
    expect(end).toBeGreaterThan(start);
    const lastRound = new Set(state.assignments[end].map((entry) => entry.name));
    expect(unitsOf(state).some((unit) => lastRound.has(unit))).toBe(true);
  });
});

describe('a team on the line', () => {
  const base = oneRoomState({
    gameFormat: 'team-2v2v2v2',
    rule: 'sum-members',
    rounds: [{}, {}],
    players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
    scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 50, 'r0-rm1-p1-m1': 50 },
  });
  const state = { ...base, gamemodeConfig: { ...base.gamemodeConfig, absenceVersion: 3 as const } };
  const half = answerAbsence(state, ['r0-rm1-p0-m0'], 'absent');
  const all = answerAbsence(half, ['r0-rm1-p0-m1'], 'absent');

  it('is one chip with the team’s label and its first member to click, once every member is absent', () => {
    const chips = likelyAbsentChips({ ...all, curRound: 1 });
    expect(chips).toEqual([
      { unit: 'Red', label: 'Red', clickName: 'a', title: 'Absent in Round 1 — click when back' },
    ]);
  });

  it('is not listed while a member is not absent, nor once a member is back', () => {
    expect(likelyAbsentChips({ ...half, curRound: 1 })).toEqual([]);
    expect(likelyAbsentChips({ ...markBack(all, 'b'), curRound: 1 })).toEqual([]);
  });
});
