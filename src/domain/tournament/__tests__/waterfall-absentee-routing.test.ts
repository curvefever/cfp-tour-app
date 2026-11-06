import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import { routeWaterfallRound } from '../bracket-replay';
import { generateTournament } from '../generation';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentRound, TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { scoreCurrentRound } from './play-through';
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

const GRAPH = `
ROUNDS:
R1 = 2x8
Semi A = 8
Lower = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Semi A, 5-8->Lower
R1.B: 1-4->Semi A, 5-8->Lower
Semi A: 1-4->Final, 5-8->eliminated
Lower: 1-4->Final, 5-8->eliminated
`;

const indexOf = (state: TournamentState, label: string): number =>
  state.rounds.findIndex((round: TournamentRound) => round.customLabel === label);

/** 16 FFA players, no pooling, advanced to R1; room A of R1 has 5 absent (seats 4-8), room B all present. */
function r1WithFiveAbsent(): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: 16,
      players: Array.from({ length: 16 }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      waterfallGraph: GRAPH,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error('generation failed');
  let state: TournamentState = { ...result.state, started: true };
  while (state.rounds[state.curRound].customLabel !== 'R1') {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`could not reach R1: ${advanced.status}`);
    state = advanced.state;
  }
  const keys = [3, 4, 5, 6, 7].map((seat) => `r${state.curRound}-rm1-p${seat}`);
  const scored = scoreCurrentRound(state, 0);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  return answerAbsence(zeroed, keys, 'absent');
}

describe('a generated Custom bracket with absentees in a room', () => {
  it('generation writes absenceVersion 2', () => {
    expect(r1WithFiveAbsent().gamemodeConfig.absenceVersion).toBe(2);
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

  it('the live graph edit replays the advanced round to the same line-ups', () => {
    const advanced = advanceTournamentRound(r1WithFiveAbsent());
    if (advanced.status !== 'advanced') throw new Error('expected to advance');
    const edited = applyWaterfallGraphEdit(advanced.state, GRAPH);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const semiIndex = indexOf(advanced.state, 'Semi A');
    expect(edited.state.assignments[semiIndex]).toEqual(advanced.state.assignments[semiIndex]);
  });
});
