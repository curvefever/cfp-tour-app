import { describe, expect, it } from 'vitest';
import {
  isValidPathSegment,
  validatePatchInput,
  validateSetupPatchInput,
  validateWriteInput,
} from './tournament-write.shared';

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

describe('validatePatchInput and the status fields', () => {
  it('refuses lifecycle and started at the top level, but not deeper', () => {
    for (const path of ['lifecycle', 'lifecycle/status', 'started']) {
      expect(() => validatePatchInput({ tournamentId: 't1', patch: { [path]: 1 } })).toThrow('patch path');
    }
    expect(() => validatePatchInput({ tournamentId: 't1', patch: { 'scores/started': 1 } })).not.toThrow();
  });

  it('keeps only the known descriptive fields of a summary', () => {
    const result = validatePatchInput({
      tournamentId: 't1',
      patch: { title: 'Cup' },
      summary: { title: 'Cup', unitCount: 37, status: 'finished' } as never,
    });
    expect(result.summary).toEqual({ title: 'Cup', unitCount: 37 });
  });

  it('rejects a badly typed summary', () => {
    expect(() =>
      validatePatchInput({ tournamentId: 't1', patch: { a: 1 }, summary: { unitCount: 'many' } as never }),
    ).toThrow('unitCount');
  });

  it('leaves the summary out when none was sent', () => {
    expect(validatePatchInput({ tournamentId: 't1', patch: { a: 1 } })).not.toHaveProperty('summary');
  });
});

describe('validateSetupPatchInput', () => {
  it('passes setup fields with text values', () => {
    const patch = { qualAdv: '16', waterfallGraph: 'ROUNDS:\n1: 8' };
    expect(validateSetupPatchInput({ tournamentId: ' t1 ', patch })).toEqual({ tournamentId: 't1', patch });
  });

  it('rejects unknown fields, non-text values and paths below a field', () => {
    expect(() => validateSetupPatchInput({ tournamentId: 't1', patch: { nope: 'x' } })).toThrow('nope');
    expect(() => validateSetupPatchInput({ tournamentId: 't1', patch: { qualAdv: 16 } as never })).toThrow(
      'qualAdv',
    );
    expect(() => validateSetupPatchInput({ tournamentId: 't1', patch: { 'roster/0': 'x' } })).toThrow(
      'roster/0',
    );
  });

  it('keeps the known list fields of a summary and rejects a badly typed one', () => {
    const result = validateSetupPatchInput({
      tournamentId: 't1',
      patch: { poolingPhase: 'swiss' },
      summary: { poolingPhase: 'swiss', status: 'x' } as never,
    });
    expect(result.summary).toEqual({ poolingPhase: 'swiss' });
    expect(() =>
      validateSetupPatchInput({
        tournamentId: 't1',
        patch: { qualAdv: '1' },
        summary: { unitCount: 'a' } as never,
      }),
    ).toThrow('unitCount');
  });

  it('rejects an empty or missing patch and a bad id', () => {
    expect(() => validateSetupPatchInput({ tournamentId: 't1', patch: {} })).toThrow('Invalid setup patch.');
    expect(() => validateSetupPatchInput({ tournamentId: 't1', patch: null as never })).toThrow(
      'Invalid setup patch.',
    );
    expect(() => validateSetupPatchInput({ tournamentId: 'a b', patch: { qualAdv: '1' } })).toThrow(
      'Invalid tournament ID.',
    );
  });
});

describe('validatePatchInput and the screenshot list', () => {
  it('refuses a patch that writes the screenshot list, as a path or inside the info block', () => {
    expect(() => validatePatchInput({ tournamentId: 't1', patch: { 'info/screenshots': ['a'] } })).toThrow(
      'patch path',
    );
    expect(() =>
      validatePatchInput({ tournamentId: 't1', patch: { info: { rulesText: '', screenshots: ['a'] } } }),
    ).toThrow('patch path');
  });

  it('still accepts the other parts of the info block', () => {
    expect(() =>
      validatePatchInput({
        tournamentId: 't1',
        patch: { 'info/rulesText': 'No pause', 'info/scheduledAt': 5 },
      }),
    ).not.toThrow();
    expect(() =>
      validatePatchInput({ tournamentId: 't1', patch: { info: { rulesText: '', scheduledAt: null } } }),
    ).not.toThrow();
  });
});
