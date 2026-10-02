import { describe, expect, it } from 'vitest';
import { parseEliminationTargets, type EliminationTargetContext } from '../elimination-targets';

const single: EliminationTargetContext = {
  schedule: 'single-elimination',
  bracketEntryCount: 24,
  entryLabel: 'number advancing to the bracket',
  semisSize: 16,
  winnersQualifiers: 0,
  finalSize: 8,
  lbQualifiers: 0,
};

const shared: EliminationTargetContext = {
  ...single,
  schedule: 'double-elimination-shared-final',
  winnersQualifiers: 6,
  lbQualifiers: 2,
  semisSize: 0,
};

describe('parseEliminationTargets', () => {
  it('returns undefined values for blank text or a schedule without targets', () => {
    expect(parseEliminationTargets('  ', single)).toEqual({ ok: true, values: undefined });
    expect(parseEliminationTargets('20,16', { ...single, schedule: 'kings-valley' })).toEqual({
      ok: true,
      values: undefined,
    });
  });

  it('accepts the last target at exactly the Semis size and refuses one below', () => {
    expect(parseEliminationTargets('20,16', single)).toEqual({ ok: true, values: [20, 16] });
    expect(parseEliminationTargets('20,15', single).ok).toBe(false);
  });

  it('accepts a plateau and refuses an increase of exactly one', () => {
    expect(parseEliminationTargets('20,20,16', single)).toEqual({ ok: true, values: [20, 20, 16] });
    expect(parseEliminationTargets('20,21', single)).toEqual({
      ok: false,
      error: expect.stringContaining('must not increase'),
    });
  });

  it('accepts the first target at the entry count and refuses one above', () => {
    expect(parseEliminationTargets('24,16', single)).toEqual({ ok: true, values: [24, 16] });
    expect(parseEliminationTargets('25,16', single).ok).toBe(false);
  });

  it('refuses non-integers and zero', () => {
    expect(parseEliminationTargets('20,x', single).ok).toBe(false);
    expect(parseEliminationTargets('20,0', single).ok).toBe(false);
    expect(parseEliminationTargets('20,16.5', single).ok).toBe(false);
  });

  it('shared Final: the last target must be exactly the winners-bracket share', () => {
    expect(parseEliminationTargets('12,6', shared)).toEqual({ ok: true, values: [12, 6] });
    expect(parseEliminationTargets('12,5', shared).ok).toBe(false);
    expect(parseEliminationTargets('12,7', shared).ok).toBe(false);
  });
});
