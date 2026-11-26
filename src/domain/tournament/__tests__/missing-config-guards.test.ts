import { describe, expect, it } from 'vitest';
import { addWalkUpIndividual } from '../reserves';
import { removeRosterUnit } from '../unit-removal';
import type { TournamentState } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { generated } from './test-fixtures';

function withoutConfigKey(state: TournamentState, key: string): TournamentState {
  const config = { ...state.gamemodeConfig } as Record<string, unknown>;
  delete config[key];
  return { ...state, gamemodeConfig: config };
}

describe('a tournament whose settings lack the bracket kind: the future rounds are not rebuilt', () => {
  const pooling = {
    ...generated(37, { scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '24' }),
    started: true,
    reserveOpen: true,
  };
  const without = withoutConfigKey(pooling, 'bracketPhase');

  it('a removal re-plans the later rounds for the new head count, and keeps them as drawn without it', () => {
    expect(removeRosterUnit(pooling, 'P1').rounds.map((round) => round.players)).toEqual([
      37, 36, 36, 24, 20, 16, 8,
    ]);
    expect(removeRosterUnit(without, 'P1').rounds).toEqual(without.rounds);
  });

  it('a walk-up joins the draw, and is blocked as over the cap without it', () => {
    expect(addWalkUpIndividual(pooling, 'Newcomer').status).toBe('added');
    expect(addWalkUpIndividual(without, 'Newcomer')).toEqual({ status: 'blocked', reason: 'room-cap' });
  });
});

describe('a Custom bracket whose settings lack the Finals games: its graph edit is refused', () => {
  const graph = 'ROUNDS:\nR1 = 2x8\nF = 8 FINAL\nROUTES:\nR1.A: 1-4->F\nR1.B: 1-4->F';
  const custom = {
    ...generated(32, {
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      qualAdv: '16',
      waterfallGraph: graph,
    }),
    started: true,
  };

  it('edits the graph with the Finals games, and says so when they are missing', () => {
    expect(applyWaterfallGraphEdit(custom, graph).ok).toBe(true);
    expect(applyWaterfallGraphEdit(withoutConfigKey(custom, 'finalsGames'), graph)).toEqual({
      ok: false,
      error:
        "Can't save — this tournament's gamemode configuration is missing a room size or Finals format. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.",
    });
  });
});
