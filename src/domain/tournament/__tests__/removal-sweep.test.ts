import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';

/**
 * Regression sweep: removing one unit must never make "Next Round" throw.
 * Every config is played through with the real transition code, scoring
 * every room with distinct values, once with no removal (to skip configs
 * that fail for unrelated reasons), then with one removal in the first round
 * and again with one in the first elimination round. Every config keeps its
 * rooms-per-wave at 8 or fewer (assignWaveToRooms tries every permutation of
 * a wave's rooms, so bigger waves are very slow).
 */

type SetupOverrides = Parameters<typeof createDefaultSetup>[0];

interface SweepConfig {
  label: string;
  count: number;
  setup: SetupOverrides;
  teams: boolean;
}

function buildState(config: SweepConfig): TournamentState | null {
  const players = config.teams
    ? Array.from({ length: config.count }, (_, index): TournamentTeam => ({
        teamId: `t${index + 1}`,
        teamName: `Team ${index + 1}`,
        members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
      }))
    : Array.from({ length: config.count }, (_, index) => `P${index + 1}`);
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: config.count, players }),
    createDefaultSetup({ qualAdv: '8', ...config.setup }),
    createTournamentRuntime(),
  );
  // A config the generator itself refuses (e.g. an oversized Final) isn't part of the sweep.
  return result.status === 'generated' ? result.state : null;
}

/** Scores every occupied room of the current round; every score is globally distinct. */
function scoreCurrentRound(state: TournamentState, teamSize: number): TournamentState {
  const round = state.rounds[state.curRound];
  const scores = { ...state.scores };
  const seen = new Map<number, number>();
  let counter = 0;
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null) continue;
    const position = seen.get(entry.room) ?? 0;
    seen.set(entry.room, position + 1);
    counter += 1;
    const keys = scoreKeysForPosition({
      roundIndex: state.curRound,
      room: entry.room,
      position,
      numGames: round.numGames ?? 1,
      teamSize: teamSize || undefined,
    });
    // The first key carries the distinct part, any others a constant, so team
    // totals stay distinct too.
    keys.forEach((key, index) => {
      scores[key] = index === 0 ? 1000 - 10 * counter - state.curRound : 1;
    });
  }
  return { ...state, scores };
}

type Outcome = { kind: 'ok' } | { kind: 'blocked'; message: string } | { kind: 'threw'; message: string };

/** Advances to the Final (or the end of what can be advanced), removing one unit at `removeAt` if given. */
function playThrough(
  start: TournamentState,
  teamSize: number,
  removeAt: 'first' | 'elimination' | null,
): Outcome {
  let state = start;
  let removed = removeAt === null;
  try {
    for (let guard = 0; guard < 30; guard += 1) {
      const round = state.rounds[state.curRound];
      const isFirstElimination = !round.isNoElim && !round.isQual && !round.isSwiss && !round.isFinal;
      const removalDue = removeAt === 'first' ? state.curRound === 0 : isFirstElimination;
      if (!removed && removalDue) {
        const victim = (state.assignments[state.curRound] ?? []).find((entry) => entry.room !== null);
        if (victim) state = removeRosterUnit(state, victim.name);
        removed = true;
      }
      if (round.isFinal) return { kind: 'ok' };
      const result = advanceTournamentRound(scoreCurrentRound(state, teamSize));
      if (result.status === 'blocked') return { kind: 'blocked', message: result.message };
      if (result.status === 'noop') return { kind: 'ok' };
      state = result.state;
    }
    return { kind: 'threw', message: 'did not finish within 30 rounds' };
  } catch (error) {
    return { kind: 'threw', message: error instanceof Error ? error.message : String(error) };
  }
}

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
    for (const scheduleLogic of [...SCHEDULES_ANY, 'double-elimination'] as const) {
      for (const poolingPhase of poolings) {
        for (const oddCountStrategy of ['', 'bye'] as const) {
          list.push({
            label: `${gameFormat} 13 ${scheduleLogic} ${poolingPhase} strategy '${oddCountStrategy}'`,
            count: 13,
            teams: gameFormat === 'team-3v3',
            setup: { gameFormat, scheduleLogic, poolingPhase, oddCountStrategy },
          });
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
