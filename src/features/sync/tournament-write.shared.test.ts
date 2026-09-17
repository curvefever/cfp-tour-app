import { describe, expect, it } from 'vitest';
import { validateWriteInput } from './tournament-write.shared';

describe('validateWriteInput', () => {
  it('passes through a valid input, stripping adminProof if present', () => {
    const result = validateWriteInput({
      tournamentId: 't1',
      payload: { curRound: 1, adminProof: 'secret' },
    });
    expect(result).toEqual({ tournamentId: 't1', payload: { curRound: 1 } });
  });

  it('trims whitespace from tournamentId before validating', () => {
    const result = validateWriteInput({ tournamentId: '  t1  ', payload: {} });
    expect(result.tournamentId).toBe('t1');
  });

  it('rejects an empty or overlong tournamentId', () => {
    expect(() => validateWriteInput({ tournamentId: '', payload: {} })).toThrow('Invalid tournament ID.');
    expect(() => validateWriteInput({ tournamentId: 'a'.repeat(129), payload: {} })).toThrow(
      'Invalid tournament ID.',
    );
  });

  it('rejects a tournamentId with disallowed characters', () => {
    expect(() => validateWriteInput({ tournamentId: 't1 t2', payload: {} })).toThrow(
      'Invalid tournament ID.',
    );
    expect(() => validateWriteInput({ tournamentId: 't1/../t2', payload: {} })).toThrow(
      'Invalid tournament ID.',
    );
  });

  it('rejects a missing, non-object, or array payload', () => {
    expect(() => validateWriteInput({ tournamentId: 't1', payload: null })).toThrow(
      'Invalid tournament data.',
    );
    expect(() => validateWriteInput({ tournamentId: 't1', payload: 'nope' })).toThrow(
      'Invalid tournament data.',
    );
    expect(() => validateWriteInput({ tournamentId: 't1', payload: [1, 2] })).toThrow(
      'Invalid tournament data.',
    );
  });

  it('rejects a non-object top-level input', () => {
    expect(() => validateWriteInput(null as never)).toThrow('Invalid tournament update.');
    expect(() => validateWriteInput('nope' as never)).toThrow('Invalid tournament update.');
  });
});
