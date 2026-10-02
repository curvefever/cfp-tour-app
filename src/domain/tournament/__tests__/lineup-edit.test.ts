import { describe, expect, it } from 'vitest';
import { applyLineupEdit, lineupEditScope } from '../lineup-edit';
import { generateTournament } from '../generation';
import { computeRankings } from '../rankings';
import { createTournamentRuntime } from '../runtime';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { RoundAssignment, TournamentState } from '../types';
import { scoreCurrentRound } from './play-through';
import { fixedIdSource } from './test-fixtures';

function build(count: number, overrides: Parameters<typeof createDefaultSetup>[0]): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({ scheduleLogic: 'single-elimination', ...overrides }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') {
    throw new Error(`fixture failed: ${result.status === 'invalid' ? result.message : 'unknown'}`);
  }
  return { ...result.state, started: true };
}

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status !== 'advanced')
    throw new Error(`could not advance round ${state.curRound}: ${result.status}`);
  return result.state;
}

const isPooling = (state: TournamentState) => {
  const round = state.rounds[state.curRound];
  return round.isNoElim || round.isQual;
};

function playToFirstElimination(state: TournamentState): TournamentState {
  let current = state;
  while (isPooling(current)) current = advance(current);
  return current;
}

const draftOf = (state: TournamentState): RoundAssignment[] =>
  state.assignments[state.curRound].map((entry) => ({ ...entry }));

function unwrap(result: ReturnType<typeof applyLineupEdit>): TournamentState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function inRoom(draft: RoundAssignment[], room: number) {
  return draft.filter((entry) => entry.room === room);
}

describe('line-up edit: moves', () => {
  it('moves a unit between rooms in a qual round, marking only that unit and re-recording roomHistory', () => {
    const state = advance(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const draft = draftOf(state);
    const big =
      state.rounds[state.curRound].rooms.findIndex(
        (size) => size === Math.max(...state.rounds[state.curRound].rooms),
      ) + 1;
    const small =
      state.rounds[state.curRound].rooms.findIndex(
        (size) => size === Math.min(...state.rounds[state.curRound].rooms),
      ) + 1;
    const mover = inRoom(draft, big)[0];
    const oldMate = inRoom(draft, big)[1];
    const newMate = inRoom(draft, small)[0];
    mover.room = small;

    const edited = unwrap(applyLineupEdit(state, draft));
    const round = edited.rounds[edited.curRound];
    expect(round.rooms.reduce((total, size) => total + size, 0)).toBe(37);
    expect(round.rooms[big - 1]).toBe(state.rounds[state.curRound].rooms[big - 1] - 1);
    expect(round.rooms[small - 1]).toBe(state.rounds[state.curRound].rooms[small - 1] + 1);
    const manual = edited.assignments[edited.curRound].filter((entry) => entry.manual);
    expect(manual.map((entry) => entry.name)).toEqual([mover.name]);
    expect(edited.roomHistory[roomPairKey(mover.name, newMate.name)]).toBe(state.curRound);
    expect(edited.roomHistory[roomPairKey(mover.name, oldMate.name)]).not.toBe(state.curRound);
    expect(edited.needsSave).toBe(true);
  });

  it('refuses elimination in a pooling round', () => {
    const state = advance(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const draft = draftOf(state).slice(1);
    expect(applyLineupEdit(state, draft)).toEqual({
      ok: false,
      error: expect.stringContaining('pooling round'),
    });
    expect(lineupEditScope(state)).toMatchObject({ ok: true, canEliminate: false });
  });

  it('refuses a draft that empties a room, adds a stranger, or duplicates a unit', () => {
    const state = advance(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const draft = draftOf(state);
    const first = draft.filter((entry) => entry.room === 1);
    const moved = draft.map((entry) => (entry.room === 1 ? { ...entry, room: 2 } : entry));
    expect(first.length).toBeGreaterThan(0);
    expect(applyLineupEdit(state, moved).ok).toBe(false);
    expect(applyLineupEdit(state, [...draft, { name: 'Nobody', room: 1 }]).ok).toBe(false);
    expect(applyLineupEdit(state, [...draft, { ...draft[0] }]).ok).toBe(false);
  });
});

describe('line-up edit: refusals', () => {
  it('is refused once any score exists', () => {
    const state = scoreCurrentRound(advance(build(37, { poolingPhase: 'qual-table', qualAdv: '24' })), 0);
    expect(lineupEditScope(state)).toEqual({ ok: false, reason: expect.stringContaining('scores') });
    expect(applyLineupEdit(state, draftOf(state)).ok).toBe(false);
  });

  it('is refused for a fixed-draw pooling round', () => {
    const state = build(37, { poolingPhase: 'qual-table', qualAdv: '24', drawPublication: 'fixed' });
    expect(lineupEditScope(state)).toEqual({ ok: false, reason: expect.stringContaining('published') });
  });

  it('is refused outside single elimination, in group stage and before the start', () => {
    const state = advance(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    expect(lineupEditScope({ ...state, scheduleLogic: 'kings-valley' }).ok).toBe(false);
    expect(lineupEditScope({ ...state, scheduleLogic: 'double-elimination-shared-final' }).ok).toBe(false);
    expect(lineupEditScope({ ...state, scheduleLogic: 'waterfall-bracket' }).ok).toBe(false);
    expect(lineupEditScope({ ...state, cfg: { ...state.cfg, poolingPhase: 'group-stage' } }).ok).toBe(false);
    expect(lineupEditScope({ ...state, started: false }).ok).toBe(false);
  });
});

describe('line-up edit: elimination rounds', () => {
  it('reinstates a unit cut at the pooling boundary in exchange for an elimination (37 qual-table)', () => {
    const state = playToFirstElimination(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const scope = lineupEditScope(state);
    if (!scope.ok) throw new Error(scope.reason);
    expect(scope.canEliminate).toBe(true);
    expect(scope.reinstatable).toHaveLength(13);
    const draft = draftOf(state);
    const out = draft[0];
    const back = scope.reinstatable[0];
    const edited = unwrap(applyLineupEdit(state, [{ name: back, room: out.room }, ...draft.slice(1)]));
    const names = edited.assignments[edited.curRound].map((entry) => entry.name);
    expect(names).toContain(back);
    expect(names).not.toContain(out.name);
    expect(edited.rounds[edited.curRound].advTotal).toBe(state.rounds[state.curRound].advTotal);
    expect(edited.assignments[edited.curRound].find((entry) => entry.name === back)?.manual).toBe(true);

    // Rankings: the reinstated unit is no longer listed as eliminated, the hand-eliminated one is.
    const before = computeRankings(state)?.eliminatedList.map((entry) => entry.name) ?? [];
    const after = computeRankings(edited);
    const eliminated = after?.eliminatedList.map((entry) => entry.name) ?? [];
    expect(before).toContain(back);
    expect(eliminated).not.toContain(back);
    const outEntry = after?.eliminatedList.find((entry) => entry.name === out.name);
    expect(outEntry?.ri).toBe(state.curRound - 1);
  });

  it('refuses reinstating a unit eliminated two rounds back', () => {
    const first = playToFirstElimination(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const cutAtQualification = (first.assignments[first.curRound - 1] ?? [])
      .map((entry) => entry.name)
      .find((name) => !first.assignments[first.curRound].some((entry) => entry.name === name));
    expect(cutAtQualification).toBeDefined();
    const second = advance(first);
    const scope = lineupEditScope(second);
    if (!scope.ok) throw new Error(scope.reason);
    expect(scope.reinstatable).not.toContain(cutAtQualification);
    const draft = draftOf(second);
    const result = applyLineupEdit(second, [
      { name: cutAtQualification as string, room: draft[0].room },
      ...draft.slice(1),
    ]);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("can't be placed") });
  });

  it('advances correctly after an edit, seating exactly advTotal units in the next round', () => {
    const state = playToFirstElimination(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    const scope = lineupEditScope(state);
    if (!scope.ok) throw new Error(scope.reason);
    const draft = draftOf(state);
    const edited = unwrap(
      applyLineupEdit(state, [{ name: scope.reinstatable[0], room: draft[0].room }, ...draft.slice(1)]),
    );
    const next = advance(edited);
    expect(next.assignments[next.curRound]).toHaveLength(edited.rounds[edited.curRound].advTotal);
    expect(next.assignments[next.curRound].map((entry) => entry.name)).not.toContain(draft[0].name);
  });
});

describe('line-up edit: head-to-head with byes (53 individual-1v1)', () => {
  const firstElimination = () =>
    playToFirstElimination(build(53, { gameFormat: 'individual-1v1', poolingPhase: 'none' }));

  it('eliminates a unit on a bye', () => {
    const state = firstElimination();
    const bye = draftOf(state).find((entry) => entry.room === null);
    expect(bye).toBeDefined();
    const edited = unwrap(
      applyLineupEdit(
        state,
        draftOf(state).filter((entry) => entry.name !== bye?.name),
      ),
    );
    expect(edited.rounds[edited.curRound].byeCount).toBe(0);
    expect(edited.byes[edited.curRound]).not.toContain(bye?.name);
    expect(edited.rounds[edited.curRound].players).toBe(52);
  });

  it('refuses moving into or out of a bye', () => {
    const state = firstElimination();
    const draft = draftOf(state);
    const bye = draft.find((entry) => entry.room === null);
    const seated = draft.find((entry) => entry.room !== null);
    expect(
      applyLineupEdit(
        state,
        draft.map((entry) => (entry === bye ? { ...entry, room: 1 } : entry)),
      ).ok,
    ).toBe(false);
    expect(
      applyLineupEdit(
        state,
        draft.map((entry) => (entry === seated ? { ...entry, room: null } : entry)),
      ).ok,
    ).toBe(false);
  });

  it('replaces a unit in a room of 2 atomically; a room of 1 or 3 is refused', () => {
    const state = advance(firstElimination());
    const scope = lineupEditScope(state);
    if (!scope.ok) throw new Error(scope.reason);
    const draft = draftOf(state);
    const out = draft.find((entry) => entry.room !== null) as RoundAssignment;
    const back = scope.reinstatable[0];
    const replaced = draft.map((entry) => (entry === out ? { name: back, room: out.room } : entry));
    const edited = unwrap(applyLineupEdit(state, replaced));
    expect(inRoom(edited.assignments[edited.curRound], out.room as number)).toHaveLength(2);
    expect(edited.assignments[edited.curRound].find((entry) => entry.name === back)?.manual).toBe(true);

    expect(
      applyLineupEdit(
        state,
        draft.filter((entry) => entry !== out),
      ),
    ).toEqual({
      ok: false,
      error: expect.stringContaining('only 1 unit'),
    });
    expect(applyLineupEdit(state, [...draft, { name: back, room: out.room }])).toEqual({
      ok: false,
      error: expect.stringContaining('limit is 2'),
    });
  });
});

describe('line-up edit: Semis and Final', () => {
  it('keeps at least two in the Final and allows a move-free no-op', () => {
    let state = playToFirstElimination(build(37, { poolingPhase: 'qual-table', qualAdv: '24' }));
    while (!state.rounds[state.curRound].isFinal) state = advance(state);
    const draft = draftOf(state);
    expect(applyLineupEdit(state, draft).ok).toBe(true);
    expect(applyLineupEdit(state, draft.slice(0, 1)).ok).toBe(false);
  });
});
