import { describe, expect, it } from 'vitest';
import { computeStandingsCutoffAdvancing, isStandingsCutoffRound } from '../advancement';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, scoreCurrentRound, type SweepConfig } from './play-through';
import { buildAssignments, buildRound } from './test-fixtures';

/**
 * A unit on a bye in the last round before a standings cut-off (the last
 * Qualification Table/Swiss round, or the last Group Stage round) is already
 * ranked in the cumulative standings, so it must not also be advanced
 * automatically: whether it qualifies is decided by its standing alone.
 */

const H2H = { gameFormat: 'individual-1v1' as const, oddCountStrategy: 'bye' as const };

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(state);
  if (result.status !== 'advanced') throw new Error(`did not advance: ${JSON.stringify(result)}`);
  return result.state;
}

/** Plays every round up to (not including the scoring of) the first standings cut-off round. */
function playToCutoffRound(start: TournamentState): TournamentState {
  let state = start;
  for (let guard = 0; guard < 20 && !isStandingsCutoffRound(state, state.curRound); guard += 1) {
    state = advance(scoreCurrentRound(state, 0));
  }
  expect(isStandingsCutoffRound(state, state.curRound)).toBe(true);
  return state;
}

/** Rewrites every score of rounds 0..curRound so that units win in `order` (first listed wins every room). */
function rescoreAll(state: TournamentState, order: string[]): TournamentState {
  const scores = { ...state.scores };
  for (let roundIndex = 0; roundIndex <= state.curRound; roundIndex += 1) {
    const seen = new Map<number, number>();
    for (const entry of state.assignments[roundIndex] ?? []) {
      if (entry.room === null) continue;
      const position = seen.get(entry.room) ?? 0;
      seen.set(entry.room, position + 1);
      const [key] = scoreKeysForPosition({ roundIndex, room: entry.room, position });
      scores[key] = 100_000 - order.indexOf(entry.name) * 100;
    }
  }
  return { ...state, scores };
}

const enteredNames = (state: TournamentState, roundIndex: number) =>
  (state.assignments[roundIndex] ?? []).map((entry) => entry.name);

function poolingSetup(
  poolingPhase: 'qual-table' | 'swiss',
  drawPublication: 'adaptive' | 'fixed',
): SweepConfig {
  return {
    label: `${poolingPhase} ${drawPublication}`,
    count: 33,
    teams: false,
    setup: { ...H2H, scheduleLogic: 'single-elimination', poolingPhase, qualAdv: '16', drawPublication },
  };
}

describe.each([
  ['Qualification Table', 'qual-table', 'adaptive'],
  ['Swiss', 'swiss', 'adaptive'],
  ['fixed-draw Qualification Table', 'qual-table', 'fixed'],
] as const)('1v1 with 33 players, %s, 16 advancing', (_label, poolingPhase, drawPublication) => {
  function setUp(byeUnitRank: 'outside' | 'inside') {
    const state = buildState(poolingSetup(poolingPhase, drawPublication)) as TournamentState;
    const atCutoff = playToCutoffRound(state);
    const byeUnit = atCutoff.byes[atCutoff.curRound][0];
    expect(byeUnit).toBeDefined();
    const others = Array.from({ length: 33 }, (_, index) => `P${index + 1}`).filter(
      (name) => name !== byeUnit,
    );
    const order = byeUnitRank === 'outside' ? [...others, byeUnit] : [byeUnit, ...others];
    const rescored = rescoreAll(atCutoff, order);
    return { rescored, byeUnit, cutoffRound: rescored.curRound };
  }

  it('a bye unit ranked outside the qualifiers does not advance: exactly 16 enter', () => {
    const { rescored, byeUnit, cutoffRound } = setUp('outside');
    const qualifiers = computeStandingsCutoffAdvancing(rescored, cutoffRound) as Set<string>;
    expect(qualifiers.size).toBe(16);
    expect(qualifiers.has(byeUnit)).toBe(false);
    const next = advance(rescored);
    const entered = enteredNames(next, cutoffRound + 1);
    expect(entered).toHaveLength(16);
    expect(entered).not.toContain(byeUnit);
    expect(new Set(entered)).toEqual(qualifiers);
  });

  it('a bye unit ranked inside the qualifiers enters exactly once: still 16 enter', () => {
    const { rescored, byeUnit, cutoffRound } = setUp('inside');
    const next = advance(rescored);
    const entered = enteredNames(next, cutoffRound + 1);
    expect(entered).toHaveLength(16);
    expect(entered.filter((name) => name === byeUnit)).toHaveLength(1);
  });
});

describe('Group Stage, 1v1: bye units do not skip the group cut-off', () => {
  function playGroupStage(count: number, groupSize: string, qualifiers: string) {
    let state = buildState({
      label: 'group stage',
      count,
      teams: false,
      setup: {
        ...H2H,
        scheduleLogic: 'single-elimination',
        poolingPhase: 'group-stage',
        groupSize,
        qualifiersPerGroup: qualifiers,
        qualAdv: '4',
      },
    }) as TournamentState;
    state = playToCutoffRound(state);
    const byeUnits = state.byes[state.curRound];
    expect(byeUnits.length).toBeGreaterThan(0);
    const others = Array.from({ length: count }, (_, index) => `P${index + 1}`).filter(
      (name) => !byeUnits.includes(name),
    );
    const rescored = rescoreAll(state, [...others, ...byeUnits]);
    return { rescored, byeUnits };
  }

  it.each([
    [9, '3', '1', 3],
    [15, '5', '2', 6],
  ])(
    '%i players in groups of %s, %s qualifier(s) each: exactly %i enter the bracket',
    (count, size, qualifiers, expected) => {
      const { rescored, byeUnits } = playGroupStage(count, size, qualifiers);
      const cutoffRound = rescored.curRound;
      const displayed = computeStandingsCutoffAdvancing(rescored, cutoffRound) as Set<string>;
      const next = advance(rescored);
      const entered = enteredNames(next, cutoffRound + 1);
      expect(entered).toHaveLength(expected);
      for (const name of byeUnits) expect(entered).not.toContain(name);
      // What the screen calls "advancing" is exactly who entered.
      expect(new Set(entered)).toEqual(displayed);
    },
  );
});

describe('an ordinary round still advances its bye unit automatically', () => {
  const roomSize = { min: 2, max: 3, ideal: 2 };
  const withBye = () =>
    buildAssignments(['A', 'B', 'C', 'D'], [2, 2]).concat([{ name: 'E', room: null, isLucky: false }]);
  const scores = { 'r0-rm1-p0': 9, 'r0-rm1-p1': 5, 'r0-rm2-p0': 8, 'r0-rm2-p1': 4 };

  it('a no-elimination round outside any standings cut-off', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['A', 'B', 'C', 'D', 'E'],
      cfg: { poolingPhase: 'none' },
      gamemodeConfig: { roomSize },
      rounds: [
        buildRound({ roundNum: 1, isNoElim: true, rooms: [2, 2], players: 5, byeCount: 1, advTotal: 5 }),
        buildRound({ roundNum: 2, isNoElim: true, rooms: [3, 2], players: 5, advTotal: 5 }),
      ],
      assignments: [withBye()],
      byes: [['E'], []],
      scores,
    });
    expect(enteredNames(advance(state), 1)).toContain('E');
  });

  it('an elimination round with a bye unit', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'individual-1v1',
      players: ['A', 'B', 'C', 'D', 'E'],
      cfg: { poolingPhase: 'none' },
      gamemodeConfig: { roomSize },
      rounds: [
        buildRound({ roundNum: 1, rooms: [2, 2], players: 5, byeCount: 1, advPerRoom: 1, advTotal: 3 }),
        buildRound({ roundNum: 2, rooms: [3], players: 3, advPerRoom: 1, advTotal: 1 }),
      ],
      assignments: [withBye()],
      byes: [['E'], []],
      scores,
    });
    expect(enteredNames(advance(state), 1).sort()).toEqual(['A', 'C', 'E']);
  });
});
