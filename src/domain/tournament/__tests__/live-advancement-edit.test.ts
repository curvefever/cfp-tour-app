import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { applyAdvancementEdit, advancementEditScope } from '../live-advancement-edit';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { scoreCurrentRound } from './play-through';
import { fixedIdSource } from './test-fixtures';

function build(count: number, overrides: Parameters<typeof createDefaultSetup>[0]): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({ gameFormat: 'ffa-individual', ...overrides }),
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

/** Plays until the current round is the first elimination round. */
function playToFirstElimination(state: TournamentState): TournamentState {
  let current = state;
  while (current.rounds[current.curRound].isNoElim || current.rounds[current.curRound].isQual) {
    current = advance(current);
  }
  return current;
}

function unwrap(result: ReturnType<typeof applyAdvancementEdit>): TournamentState {
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

const eliminationAdvTotals = (state: TournamentState) =>
  state.rounds
    .filter((round) => !round.isNoElim && !round.isQual && !round.isSemis && !round.isFinal)
    .map((round) => round.advTotal);

function bracketScope(state: TournamentState) {
  const scope = advancementEditScope(state);
  if (scope.kind !== 'bracket') throw new Error('expected bracket scope');
  return scope;
}

describe('advancement edit: pooling', () => {
  const start = () =>
    build(37, { scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '24' });

  it('rebuilds the bracket from a new qualAdv and targets, leaving pooling rounds untouched', () => {
    const state = start();
    const edited = unwrap(
      applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '20', targetsText: '18,16' }),
    );
    const poolingCount = state.rounds.findIndex((round) => !round.isQual);
    expect(edited.rounds.slice(0, poolingCount)).toEqual(state.rounds.slice(0, poolingCount));
    expect(edited.rounds[poolingCount].players).toBe(20);
    expect(eliminationAdvTotals(edited)).toEqual([18, 16]);
    expect(edited.cfg.qualAdv).toBe(20);
    expect(edited.settings?.qualAdv).toBe('20');
    expect(edited.settings?.eliminationRoundTargets).toBe('18,16');
    expect(edited.gamemodeConfig.explicitTargets).toEqual([18, 16]);
    expect(edited.byes).toHaveLength(edited.rounds.length);
    expect(edited.luckyLosers).toHaveLength(edited.rounds.length);
  });

  it('blank targets go back to automatic', () => {
    const state = unwrap(
      applyAdvancementEdit(start(), { kind: 'pooling', qualAdv: '24', targetsText: '20,16' }),
    );
    const back = unwrap(applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '24', targetsText: '' }));
    expect(back.gamemodeConfig.explicitTargets).toBeUndefined();
    expect(back.settings?.eliminationRoundTargets).toBe('');
  });

  it('refuses an out-of-range qualAdv rather than clamping it', () => {
    const state = start();
    const high = applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '38', targetsText: '' });
    expect(high).toEqual({ ok: false, error: expect.stringContaining('between 16 and 37') });
    expect(applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '15', targetsText: '' }).ok).toBe(false);
    expect(applyAdvancementEdit(state, { kind: 'pooling', qualAdv: 'abc', targetsText: '' }).ok).toBe(false);
  });

  it('validates targets against the new qualAdv', () => {
    const result = applyAdvancementEdit(start(), { kind: 'pooling', qualAdv: '20', targetsText: '22,16' });
    expect(result.ok).toBe(false);
  });

  it('refuses a targets list of a different length when seeding overrides exist', () => {
    const state = build(37, {
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
      eliminationRoundTargets: '20,16',
      eliminationSeedingOverrides: 'balance,random',
    });
    const result = applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '24', targetsText: '20,18,16' });
    expect(result).toEqual({ ok: false, error: expect.stringContaining('exactly 2 entries') });
    expect(applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '24', targetsText: '' }).ok).toBe(false);
    expect(applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '24', targetsText: '22,16' }).ok).toBe(
      true,
    );
  });

  it('reports the scope for the pooling phase', () => {
    expect(advancementEditScope(start())).toMatchObject({
      kind: 'pooling',
      qualAdvEditable: true,
      qualAdv: 24,
      minQualAdv: 16,
      maxQualAdv: 37,
    });
  });
});

describe('advancement edit: shared-Final double elimination warm-up', () => {
  const start = () => build(43, { scheduleLogic: 'double-elimination-shared-final', poolingPhase: 'none' });

  it('keeps qualAdv fixed and requires the last target to equal the winners-bracket share', () => {
    const state = start();
    expect(advancementEditScope(state)).toMatchObject({ kind: 'pooling', qualAdvEditable: false });
    const bad = applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '', targetsText: '24,12,8' });
    expect(bad).toEqual({ ok: false, error: expect.stringContaining('exactly 6') });
    const edited = unwrap(
      applyAdvancementEdit(state, { kind: 'pooling', qualAdv: '', targetsText: '24,12,6' }),
    );
    expect(edited.gamemodeConfig.explicitTargets).toEqual([24, 12, 6]);
    expect(edited.rounds[0]).toEqual(state.rounds[0]);
  });

  it('is locked once the bracket has started', () => {
    const inBracket = playToFirstElimination(start());
    expect(advancementEditScope(inBracket).kind).toBe('none');
  });
});

describe('advancement edit: single-elimination bracket', () => {
  const inBracket = () =>
    playToFirstElimination(build(31, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }));

  it('lists the editable rounds from the current one up to Semis', () => {
    const state = inBracket();
    const scope = bracketScope(state);
    expect(scope.rounds[0]).toMatchObject({ index: state.curRound, players: 31 });
    expect(scope.rounds.map((entry) => entry.advTotal)).toEqual(eliminationAdvTotals(state));
  });

  it('edits the current round after scores are entered, reshaping the next round and dropping its tie resolutions', () => {
    const base = inBracket();
    const scope = bracketScope(base);
    const state = {
      ...scoreCurrentRound(base, 0),
      tieResolutions: { [`r${base.curRound}-room1-x`]: ['P1'], 'r0-room1-x': ['P2'] },
    };
    const values = scope.rounds.map((entry) => entry.advTotal);
    const first = values[0];
    values[0] = first - 1;
    const edited = unwrap(applyAdvancementEdit(state, { kind: 'bracket', targets: values }));
    expect(edited.rounds[state.curRound].advTotal).toBe(first - 1);
    expect(edited.rounds[state.curRound].players).toBe(31);
    expect(edited.rounds[state.curRound + 1].players).toBe(first - 1);
    expect(edited.tieResolutions).toEqual({ 'r0-room1-x': ['P2'] });
    expect(edited.settings?.eliminationRoundTargets).toBe(eliminationAdvTotals(edited).join(','));
    expect(edited.gamemodeConfig.explicitTargets).toEqual(eliminationAdvTotals(edited));
  });

  it('plays the edited shape through to the Final', () => {
    const base = inBracket();
    const scope = bracketScope(base);
    const values = scope.rounds.map((entry) => entry.advTotal);
    values[0] -= 1;
    let state = unwrap(applyAdvancementEdit(base, { kind: 'bracket', targets: values }));
    const expectedPlayers = [31, ...values];
    for (let index = 0; index < values.length; index += 1) {
      expect(state.rounds[state.curRound].players).toBe(expectedPlayers[index]);
      state = advance(state);
    }
    expect(state.rounds[state.curRound].isSemis).toBe(true);
    state = advance(state);
    expect(state.rounds[state.curRound].isFinal).toBe(true);
  });

  it('accepts a plateau value', () => {
    const base = inBracket();
    const scope = bracketScope(base);
    const last = scope.rounds[scope.rounds.length - 1].advTotal;
    expect(applyAdvancementEdit(base, { kind: 'bracket', targets: scope.rounds.map(() => last) }).ok).toBe(
      true,
    );
  });

  it('refuses wrong length, increasing values, a last value below Semis and out-of-range current values', () => {
    const base = inBracket();
    const scope = bracketScope(base);
    const values = scope.rounds.map((entry) => entry.advTotal);
    const edit = (targets: number[]) => applyAdvancementEdit(base, { kind: 'bracket', targets });
    expect(edit([...values, 16]).ok).toBe(false);
    expect(edit(values.slice(0, -1)).ok).toBe(false);
    if (values.length > 1) expect(edit([values[0] - 1, values[0]]).ok).toBe(false);
    expect(edit([...values.slice(0, -1), scope.semisSize - 1]).ok).toBe(false);
    expect(edit([32, ...values.slice(1)]).ok).toBe(false);
  });
});

describe('advancement edit: out of scope', () => {
  const base = () =>
    build(37, { scheduleLogic: 'single-elimination', poolingPhase: 'qual-table', qualAdv: '24' });

  it('is none for formats and phases that cannot be edited', () => {
    for (const patch of [
      { scheduleLogic: 'kings-valley' as const },
      { scheduleLogic: 'double-elimination' as const },
      { scheduleLogic: 'waterfall-bracket' as const },
      { cfg: { ...base().cfg, poolingPhase: 'group-stage' as const } },
      { started: false },
    ]) {
      expect(advancementEditScope({ ...base(), ...patch }).kind).toBe('none');
    }
  });

  it('is none on Semis and the Final of single elimination', () => {
    let state = playToFirstElimination(base());
    while (!state.rounds[state.curRound].isSemis) state = advance(state);
    expect(advancementEditScope(state).kind).toBe('none');
    expect(applyAdvancementEdit(state, { kind: 'bracket', targets: [8] }).ok).toBe(false);
    state = advance(state);
    expect(advancementEditScope(state).kind).toBe('none');
  });
});
