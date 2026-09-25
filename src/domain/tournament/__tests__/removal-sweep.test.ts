import { describe, expect, it } from 'vitest';
import { buildState, playThrough, type SweepConfig } from './play-through';
import type { TournamentState } from '../types';

/**
 * Regression sweep: removing one unit must never make "Next Round" throw.
 * Every config is played through with the real transition code, scoring
 * every room with distinct values, once with no removal (to skip configs
 * that fail for unrelated reasons), then with one removal in the first round
 * and again with one in the first elimination round. Head-to-head fields
 * run at 13, 33 and 40 units (up to 20 rooms per wave).
 */

const SCHEDULES_ANY = ['single-elimination', 'double-elimination-shared-final', 'kings-valley'] as const;

function configs(): SweepConfig[] {
  const list: SweepConfig[] = [];
  const poolings = ['none', 'qual-table'] as const;
  for (const count of [37, 23]) {
    for (const scheduleLogic of SCHEDULES_ANY) {
      for (const poolingPhase of poolings) {
        list.push({
          label: `FFA ${count} ${scheduleLogic} ${poolingPhase}`,
          count,
          teams: false,
          setup: { gameFormat: 'ffa-individual', scheduleLogic, poolingPhase },
        });
      }
    }
  }
  for (const gameFormat of ['individual-1v1', 'team-3v3'] as const) {
    for (const count of [13, 33, 40]) {
      for (const scheduleLogic of [...SCHEDULES_ANY, 'double-elimination'] as const) {
        for (const poolingPhase of poolings) {
          for (const oddCountStrategy of ['', 'bye'] as const) {
            list.push({
              label: `${gameFormat} ${count} ${scheduleLogic} ${poolingPhase} strategy '${oddCountStrategy}'`,
              count,
              teams: gameFormat === 'team-3v3',
              setup: { gameFormat, scheduleLogic, poolingPhase, oddCountStrategy },
            });
          }
        }
      }
    }
  }
  for (const gameFormat of ['team-2v2v2v2', 'team-3v3v3'] as const) {
    for (const scheduleLogic of SCHEDULES_ANY) {
      for (const poolingPhase of poolings) {
        list.push({
          label: `${gameFormat} 13 ${scheduleLogic} ${poolingPhase}`,
          count: 13,
          teams: true,
          setup: { gameFormat, scheduleLogic, poolingPhase },
        });
      }
    }
  }
  return list;
}

describe('removing one unit never makes Next Round throw', () => {
  it.each(configs().map((config) => [config.label, config] as const))(
    '%s',
    (_label, config) => {
      const state = buildState(config);
      if (!state) {
        if (process.env.SWEEP_LOG) console.log(`SKIP(generation) ${config.label}`);
        return;
      }
      const teamSize = config.teams ? 3 : 0;
      const baseline = playThrough(state, teamSize, null);
      // Configs that already fail without a removal do so for unrelated reasons.
      if (baseline.kind !== 'ok') {
        if (process.env.SWEEP_LOG)
          console.log(`SKIP(baseline ${baseline.kind}) ${config.label}: ${baseline.message}`);
        return;
      }
      const isDoubleElimination = String(config.setup?.scheduleLogic).startsWith('double-elimination');
      for (const removeAt of ['first', 'elimination'] as const) {
        const outcome = playThrough(state, teamSize, removeAt);
        expect(outcome.kind === 'threw' ? `threw: ${outcome.message}` : 'no throw').toBe('no throw');
        if (outcome.kind === 'blocked' && process.env.SWEEP_LOG)
          console.log(`BLOCKED ${config.label} @${removeAt}: ${outcome.message}`);
        // Double elimination may still block cleanly (losers-bracket counts), never throw.
        if (!isDoubleElimination) expect(outcome.kind).toBe('ok');
      }
    },
    60_000,
  );
});

describe('a hand-authored waterfall bracket stays exact-headcount', () => {
  it('blocks (with the waterfall message) instead of reshaping or throwing when a removal leaves its first round short', () => {
    const state = buildState({
      label: 'waterfall',
      count: 16,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'waterfall-bracket',
        poolingPhase: 'qual-table',
        qualAdv: '16',
        waterfallGraph:
          'ROUNDS:\nR1 = 2x8\nSemiB = 8\nFinal = 8 FINAL\n\nROUTES:\nR1.A: 1-3->Final, 4-7->SemiB, 8->eliminated\nR1.B: 1-3->Final, 4-7->SemiB, 8->eliminated\nSemiB: 1-2->Final, 3-8->eliminated',
      },
    });
    expect(state).not.toBeNull();
    expect(playThrough(state as TournamentState, 0, null).kind).toBe('ok');
    const outcome = playThrough(state as TournamentState, 0, 'first');
    expect(outcome.kind).toBe('blocked');
    expect(outcome.kind === 'blocked' && outcome.message).toContain('15 entrant');
  });
});
