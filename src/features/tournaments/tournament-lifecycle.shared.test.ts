import { describe, expect, it } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import {
  validateCreateInput,
  validateStartInput,
  validateTestRunInput,
  validateTransitionInput,
} from './tournament-lifecycle.shared';

describe('validateCreateInput', () => {
  const state = createDefaultTournamentState({ players: ['A', 'B'] });

  it('passes a valid tournament, completing the setup and dropping adminProof', () => {
    const result = validateCreateInput({
      tournamentId: ' t1 ',
      state: { ...state, adminProof: 'secret' } as never,
      setup: { qualAdv: '16' } as never,
      testRun: true,
    });
    expect(result.tournamentId).toBe('t1');
    expect(result.state).not.toHaveProperty('adminProof');
    expect(result.setup).toEqual({ ...createDefaultSetup(), qualAdv: '16' });
    expect(result.testRun).toBe(true);
  });

  it('treats anything but true as not a test run', () => {
    const base = { tournamentId: 't1', state, setup: createDefaultSetup() };
    expect(validateCreateInput({ ...base, testRun: 'yes' as never }).testRun).toBe(false);
  });

  it('drops setup fields it does not know and rejects non-text values', () => {
    const setup = { ...createDefaultSetup(), extra: 'x' } as never;
    expect(
      validateCreateInput({ tournamentId: 't1', state, setup, testRun: false }).setup,
    ).not.toHaveProperty('extra');
    expect(() =>
      validateCreateInput({ tournamentId: 't1', state, setup: { qualAdv: 16 } as never, testRun: false }),
    ).toThrow('qualAdv');
  });

  it('rejects a bad id, a missing roster or a missing setup', () => {
    const base = { tournamentId: 't1', state, setup: createDefaultSetup(), testRun: false };
    expect(() => validateCreateInput({ ...base, tournamentId: 'a/b' })).toThrow('Invalid tournament ID.');
    expect(() => validateCreateInput({ ...base, state: {} as never })).toThrow('Invalid tournament data.');
    expect(() => validateCreateInput({ ...base, setup: null as never })).toThrow('Invalid setup.');
    expect(() => validateCreateInput(null as never)).toThrow('Invalid tournament.');
  });
});

describe('validateTransitionInput', () => {
  it('passes an id alone', () => {
    expect(validateTransitionInput({ tournamentId: 't1' })).toEqual({ tournamentId: 't1' });
  });

  it('checks the paths of an optional patch', () => {
    expect(
      validateTransitionInput({ tournamentId: 't1', patch: { rounds: [], 'scores/a': null } }).patch,
    ).toEqual({
      rounds: [],
      'scores/a': null,
    });
    expect(() => validateTransitionInput({ tournamentId: 't1', patch: { 'a.b': 1 } })).toThrow('patch path');
  });

  it('refuses a patch that touches the status fields', () => {
    expect(() => validateTransitionInput({ tournamentId: 't1', patch: { started: false } })).toThrow(
      'patch path',
    );
    expect(() =>
      validateTransitionInput({ tournamentId: 't1', patch: { 'lifecycle/status': 'draft' } }),
    ).toThrow('patch path');
  });
});

describe('validateStartInput', () => {
  it('needs a patch with something in it', () => {
    expect(validateStartInput({ tournamentId: 't1', patch: { curRound: 0 } })).toEqual({
      tournamentId: 't1',
      patch: { curRound: 0 },
    });
    expect(() => validateStartInput({ tournamentId: 't1', patch: {} })).toThrow('Invalid tournament patch.');
    expect(() => validateStartInput({ tournamentId: 't1' } as never)).toThrow('Invalid tournament patch.');
  });
});

describe('validateTestRunInput', () => {
  it('needs a boolean', () => {
    expect(validateTestRunInput({ tournamentId: 't1', testRun: false })).toEqual({
      tournamentId: 't1',
      testRun: false,
    });
    expect(() => validateTestRunInput({ tournamentId: 't1', testRun: 'true' as never })).toThrow('test-run');
  });
});
