import { describe, expect, it } from 'vitest';
import { lineupEditScope, moveUnitToRoom } from '../lineup-edit';
import { addReserveUnit, benchReasonOf, setTeamDefender } from '../mutations';
import type { TournamentState } from '../types';
import { generated } from './test-fixtures';

const started = (state: TournamentState): TournamentState => ({ ...state, started: true, reserveOpen: true });

describe('setTeamDefender leaves the state it was given as it was', () => {
  it('changing a defender twice in a round does not touch the first answer', () => {
    const base = started(generated(8, { gameFormat: 'team-2v2', scheduleLogic: 'single-elimination' }));
    const first = setTeamDefender(base, 't1', 1);
    const before = JSON.stringify(first.defenderChanges);
    const second = setTeamDefender(first, 't1', 0);
    expect(JSON.stringify(first.defenderChanges)).toBe(before);
    expect(second.defenderChanges.t1).toEqual([{ round: first.curRound, memberIdx: 0 }]);
    expect(base.defenderChanges).toEqual({});
  });
});

describe('a draw that cannot take a newcomer: one answer for the bench and for the add', () => {
  const cases: Array<[string, TournamentState, string]> = [
    [
      'group stage',
      started(
        generated(16, {
          gameFormat: 'individual-1v1',
          scheduleLogic: 'single-elimination',
          poolingPhase: 'group-stage',
        }),
      ),
      'group-stage',
    ],
    [
      'fixed draw',
      started(generated(37, { scheduleLogic: 'single-elimination', drawPublication: 'fixed' })),
      'fixed-draw',
    ],
    [
      'Custom bracket with no pooling',
      started(
        generated(32, {
          scheduleLogic: 'waterfall-bracket',
          poolingPhase: 'none',
          waterfallGraph:
            'ROUNDS:\nR1 = 4x8\nF = 8 FINAL\nROUTES:\nR1.A: 1-2->F\nR1.B: 1-2->F\nR1.C: 1-2->F\nR1.D: 1-2->F',
        }),
      ),
      'waterfall-bracket',
    ],
  ];

  it.each(cases)('%s', (_name, state, reason) => {
    expect(benchReasonOf(state)).toBe(reason);
    expect(addReserveUnit({ ...state, reserves: ['Res1'] }, 'Res1')).toEqual({ status: 'blocked', reason });
  });

  it('takes the ordinary draw', () => {
    expect(benchReasonOf(started(generated(37, { scheduleLogic: 'single-elimination' })))).toBeNull();
  });
});

describe('the line-up checks: the order of the three kind refusals and the missing line-up', () => {
  const GROUP = "Line-up corrections aren't available for group stage.";

  it('names a group stage before anything else, also with no line-up for the round', () => {
    const group = started(
      generated(16, {
        gameFormat: 'individual-1v1',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'group-stage',
      }),
    );
    expect(lineupEditScope(group)).toEqual({ ok: false, reason: GROUP });
    const bare = { ...group, assignments: group.assignments.map(() => []) };
    expect(lineupEditScope(bare)).toEqual({ ok: false, reason: GROUP });
  });

  it('says a round has no line-up before it names a draw published in advance', () => {
    const fixed = started(generated(37, { scheduleLogic: 'single-elimination', drawPublication: 'fixed' }));
    const published = "This round's draw was published in advance and can't be changed.";
    expect(lineupEditScope(fixed)).toEqual({ ok: false, reason: published });
    const bare = { ...fixed, assignments: fixed.assignments.map(() => []) };
    expect(lineupEditScope(bare)).toEqual({ ok: false, reason: 'This round has no line-up yet.' });
    const unit = fixed.assignments[fixed.curRound][0].name;
    expect(moveUnitToRoom(fixed, fixed.curRound, unit, 2)).toEqual({ ok: false, error: published });
  });
});
