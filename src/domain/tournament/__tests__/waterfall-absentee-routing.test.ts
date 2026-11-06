import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { routeWaterfallRound } from '../bracket-replay';
import { computeRankings } from '../rankings';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentRound, TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { ABSENTEE_GRAPH, r1WithFiveAbsent } from './absentee-bracket-fixture';
import { buildAssignments, buildRound } from './test-fixtures';

type Routes = Array<number | 'eliminated'>;
const OUT = 'eliminated';

/**
 * One room of `drawn` units routed by `routes` (destinations are bare round numbers: nothing validates them),
 * with the units at `absent` seats scored 0 and answered absent, the others scored 90, 80, ... in seat order.
 */
function oneRoom(routes: Routes, drawn: number, absent: number[], version: 1 | 2 = 2): TournamentState {
  const players = Array.from({ length: drawn }, (_, index) => `W${index + 1}`);
  const keyOf = (seat: number) => `r0-rm1-p${seat}`;
  const scores = Object.fromEntries(
    players.map((_, seat) => [keyOf(seat), absent.includes(seat) ? 0 : 100 - 10 * seat]),
  );
  const state = createDefaultTournamentState({
    players,
    gamemodeConfig: { absenceVersion: version },
    rounds: [
      buildRound({
        roundNum: 1,
        rooms: [drawn],
        players: drawn,
        isWaterfall: true,
        waterfallRoutes: [routes],
      }),
      buildRound({ roundNum: 2, rooms: [4], players: 4 }),
    ],
    assignments: [buildAssignments(players, [drawn])],
    scores,
    started: true,
  });
  return answerAbsence(state, absent.map(keyOf), 'absent');
}

/** Where each destination's arrivals come from, by name. */
function poolsOf(state: TournamentState): Record<number, string[]> {
  const routed = routeWaterfallRound(state, 0, state.rounds[0]);
  return Object.fromEntries(
    [...routed].map(([destination, seeds]) => [destination, seeds.map((s) => s.name)]),
  );
}

const TOP_FOUR_THEN_LOWER: Routes = [1, 1, 1, 1, 2, 2, 2, 2];
const seats = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('a Custom bracket room routes its absentees by the room’s last place (absenceVersion 2)', () => {
  it('room of 8, 1-4 → A, 5-8 → B, 5 absent: 3 present to A, 4 absentees to B, 1 absentee out', () => {
    const pools = poolsOf(oneRoom(TOP_FOUR_THEN_LOWER, 8, seats(3, 7)));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3'], 2: ['W5', 'W6', 'W7', 'W8'] });
  });

  it('1-2 → A, 3-4 → B, 5-8 → C, 6 absent: 2 present to A, 4 absentees to C, 2 out', () => {
    const pools = poolsOf(oneRoom([1, 1, 2, 2, 3, 3, 3, 3], 8, seats(2, 7)));
    expect(pools).toEqual({ 1: ['W1', 'W2'], 3: ['W5', 'W6', 'W7', 'W8'] });
  });

  it('last place out (1-4 → A, 5-8 out), 5 absent: 3 present to A, every absentee out', () => {
    const pools = poolsOf(oneRoom([1, 1, 1, 1, OUT, OUT, OUT, OUT], 8, seats(3, 7)));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3'] });
  });

  it('absentees no more than the last band: nothing changes from today', () => {
    const pools = poolsOf(oneRoom(TOP_FOUR_THEN_LOWER, 8, seats(5, 7)));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3', 'W4'], 2: ['W5', 'W6', 'W7', 'W8'] });
  });

  it('a room drawn short (7 of 8): the last place is rank 7, not 8', () => {
    const routes: Routes = [1, 1, 1, 1, 2, 2, 2, 3];
    const pools = poolsOf(oneRoom(routes, 7, seats(3, 6)));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3'], 2: ['W5', 'W6', 'W7'] });
  });

  it('a non-contiguous band (5,8 → B, 6,7 → C), 4 absent: ranks 5 and 8 go to B, 6 and 7 are out', () => {
    const pools = poolsOf(oneRoom([1, 1, 1, 1, 2, 3, 3, 2], 8, seats(4, 7)));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3', 'W4'], 2: ['W5', 'W8'] });
  });

  it('a walkover room (one present unit): the present unit takes its seat, absentees only where the last place goes', () => {
    const pools = poolsOf(oneRoom(TOP_FOUR_THEN_LOWER, 8, seats(1, 7)));
    expect(pools).toEqual({ 1: ['W1'], 2: ['W5', 'W6', 'W7', 'W8'] });
  });

  it('an all-absent room: every unit goes where the last place goes, as far as that band’s seats allow', () => {
    const pools = poolsOf(oneRoom(TOP_FOUR_THEN_LOWER, 8, seats(0, 7)));
    expect(pools).toEqual({ 2: ['W5', 'W6', 'W7', 'W8'] });
  });

  it('a v1 state routes as today: the first absentee climbs into the top band', () => {
    const pools = poolsOf(oneRoom(TOP_FOUR_THEN_LOWER, 8, seats(3, 7), 1));
    expect(pools).toEqual({ 1: ['W1', 'W2', 'W3', 'W4'], 2: ['W5', 'W6', 'W7', 'W8'] });
  });
});

const indexOf = (state: TournamentState, label: string): number =>
  state.rounds.findIndex((round: TournamentRound) => round.customLabel === label);

describe('a generated Custom bracket with absentees in a room', () => {
  it('generation writes absenceVersion 3 (version 2 routing plus likely absentees)', () => {
    expect(r1WithFiveAbsent().gamemodeConfig.absenceVersion).toBe(3);
  });

  it('Next Round is not blocked: Semi A arrives one short, Lower is full, the overflow absentee is out', () => {
    const state = r1WithFiveAbsent();
    const advanced = advanceTournamentRound(state);
    expect(advanced.status).toBe('advanced');
    if (advanced.status !== 'advanced') return;
    const roomA = state.assignments[state.curRound].filter((entry) => entry.room === 1);
    const roomB = state.assignments[state.curRound].filter((entry) => entry.room === 2);
    const overflow = roomA[3].name;
    const arrivals = (label: string) =>
      advanced.state.assignments[indexOf(advanced.state, label)]
        .filter((entry) => entry.room !== null)
        .map((entry) => entry.name);
    expect(arrivals('Semi A')).toHaveLength(7);
    expect(arrivals('Semi A')).not.toContain(overflow);
    expect(arrivals('Lower').sort()).toEqual(
      [...roomA.slice(4), ...roomB.slice(4)].map((entry) => entry.name).sort(),
    );
    expect(arrivals('Lower')).not.toContain(overflow);
  });

  it('Rankings lists the overflow absentee as eliminated once the room is scored, the other absentees still in', () => {
    const state = r1WithFiveAbsent();
    const roomA = state.assignments[state.curRound].filter((entry) => entry.room === 1).map((e) => e.name);
    const rankings = computeRankings(state);
    expect(rankings?.eliminatedList.map((entry) => entry.name)).toEqual([roomA[3]]);
    const active = rankings?.stillActive.map((entry) => entry.name) ?? [];
    expect(active).toEqual(expect.arrayContaining([...roomA.slice(0, 3), ...roomA.slice(4)]));
    expect(active).not.toContain(roomA[3]);
  });

  it('a v1 state keeps the first absentee in, as before', () => {
    const state = r1WithFiveAbsent();
    const v1 = { ...state, gamemodeConfig: { ...state.gamemodeConfig, absenceVersion: 1 as const } };
    expect(computeRankings(v1)?.eliminatedList).toEqual([]);
  });

  it('the live graph edit replays the advanced round to the same line-ups', () => {
    const advanced = advanceTournamentRound(r1WithFiveAbsent());
    if (advanced.status !== 'advanced') throw new Error('expected to advance');
    const edited = applyWaterfallGraphEdit(advanced.state, ABSENTEE_GRAPH);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const semiIndex = indexOf(advanced.state, 'Semi A');
    expect(edited.state.assignments[semiIndex]).toEqual(advanced.state.assignments[semiIndex]);
  });
});
