import { describe, expect, it } from 'vitest';
import { isValidPathSegment, validatePatchInput, validateWriteInput } from './tournament-write.shared';

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

describe('validatePatchInput', () => {
  it('passes through one- and two-step paths', () => {
    const patch = { curRound: 2, 'scores/r0-rm0-p0': 5, title: null };
    expect(validatePatchInput({ tournamentId: ' t1 ', patch })).toEqual({ tournamentId: 't1', patch });
  });

  it('rejects a path of more than two steps or an empty step', () => {
    for (const path of ['a/b/c', '', 'a//b', '/a', 'a/']) {
      expect(() => validatePatchInput({ tournamentId: 't1', patch: { [path]: 1 } })).toThrow(
        'Invalid tournament patch path',
      );
    }
  });

  it('rejects a step with a character Firebase refuses', () => {
    for (const path of ['a.b', 'a#', 'a$', 'a[0]', 'scores/a.b', 'x\u0001']) {
      expect(() => validatePatchInput({ tournamentId: 't1', patch: { [path]: 1 } })).toThrow(
        'Invalid tournament patch path',
      );
    }
  });

  it('rejects a patch of the tournament id, at the top level only', () => {
    expect(() => validatePatchInput({ tournamentId: 't1', patch: { tournamentId: 'x' } })).toThrow(
      'Invalid tournament patch path',
    );
    expect(() =>
      validatePatchInput({ tournamentId: 't1', patch: { 'scores/tournamentId': 1 } }),
    ).not.toThrow();
  });

  it('drops adminProof paths and rejects a patch left with nothing', () => {
    expect(validatePatchInput({ tournamentId: 't1', patch: { adminProof: 'x', curRound: 1 } }).patch).toEqual(
      { curRound: 1 },
    );
    expect(() => validatePatchInput({ tournamentId: 't1', patch: { adminProof: 'x' } })).toThrow(
      'Invalid tournament patch.',
    );
  });

  it('rejects a bad tournament id or a missing, array or empty patch', () => {
    expect(() => validatePatchInput({ tournamentId: 't1/../t2', patch: { a: 1 } })).toThrow(
      'Invalid tournament ID.',
    );
    expect(() => validatePatchInput({ tournamentId: 't1', patch: null as never })).toThrow(
      'Invalid tournament patch.',
    );
    expect(() => validatePatchInput({ tournamentId: 't1', patch: [1] as never })).toThrow(
      'Invalid tournament patch.',
    );
    expect(() => validatePatchInput({ tournamentId: 't1', patch: {} })).toThrow('Invalid tournament patch.');
    expect(() => validatePatchInput(null as never)).toThrow('Invalid tournament update.');
  });
});

describe('isValidPathSegment', () => {
  it('accepts ordinary keys and refuses empty ones', () => {
    expect(isValidPathSegment('r0-rm1-p2-m0')).toBe(true);
    expect(isValidPathSegment('')).toBe(false);
  });
});
