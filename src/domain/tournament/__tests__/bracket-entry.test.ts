import { describe, expect, it } from 'vitest';
import {
  bracketEntryCountFromSetup,
  clampAdvanceToBracket,
  parseAdvanceToBracket,
  resolveBracketEntryCount,
} from '../bracket-entry';
import { createDefaultSetup } from '../state-defaults';
import { parseWaterfallDraft, serializeWaterfallDraft } from '../waterfall-draft';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';

describe('parseAdvanceToBracket', () => {
  it.each([
    ['16', 16],
    [' 8 ', 8],
    ['12abc', 12],
    ['1', 1],
  ])('reads "%s" as %i', (raw, expected) => {
    expect(parseAdvanceToBracket(raw)).toBe(expected);
  });

  it.each(['', '0', '-3', 'abc'])('rejects "%s"', (raw) => {
    expect(parseAdvanceToBracket(raw)).toBeNull();
  });
});

describe('clampAdvanceToBracket', () => {
  it('caps the request at the confirmed count and never raises it', () => {
    expect(clampAdvanceToBracket(16, 24)).toBe(16);
    expect(clampAdvanceToBracket(40, 24)).toBe(24);
    expect(clampAdvanceToBracket(2, 24)).toBe(2);
  });
});

describe('resolveBracketEntryCount', () => {
  const base = { confirmedCount: 24, qualAdv: 16, groupSize: 4, qualifiersPerGroup: 2 };

  it('is everyone with no pooling phase', () => {
    expect(resolveBracketEntryCount({ ...base, poolingPhase: 'none' })).toBe(24);
  });

  it.each(['qual-table', 'swiss'] as const)('is the clamped "advance" count for %s', (poolingPhase) => {
    expect(resolveBracketEntryCount({ ...base, poolingPhase })).toBe(16);
  });

  it('is groups times qualifiers per group for Group Stage, ignoring the advance count', () => {
    // 16 players in groups of up to 5, ideal 4: 4 groups, 2 qualifiers each.
    expect(resolveBracketEntryCount({ ...base, confirmedCount: 16, poolingPhase: 'group-stage' })).toBe(8);
    // 10 players: 3 groups (4, 3, 3), 2 qualifiers each.
    expect(resolveBracketEntryCount({ ...base, confirmedCount: 10, poolingPhase: 'group-stage' })).toBe(6);
  });

  it('is the advance count for a Group Stage that sends a total, and groups times qualifiers when the mode is absent', () => {
    const groups = { ...base, confirmedCount: 13, poolingPhase: 'group-stage' as const, qualAdv: 8 };
    expect(resolveBracketEntryCount({ ...groups, groupExit: 'fair-cut' })).toBe(8);
    expect(resolveBracketEntryCount({ ...groups, groupExit: 'even-split' })).toBe(8);
    expect(resolveBracketEntryCount({ ...groups, groupExit: 'per-group' })).toBe(6);
    expect(resolveBracketEntryCount(groups)).toBe(6);
  });
});

describe('bracketEntryCountFromSetup', () => {
  const setup = (overrides: Parameters<typeof createDefaultSetup>[0]) => createDefaultSetup(overrides);

  it('is unknown until a roster is loaded', () => {
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'none' }), null, 1)).toBeNull();
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'none' }), undefined, 1)).toBeNull();
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'none' }), 0, 1)).toBeNull();
  });

  it('matches the reported configuration: 24 players, qualification table, 16 advance', () => {
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'qual-table', qualAdv: '16' }), 24, 1)).toBe(16);
  });

  it('clamps an advance count larger than the roster', () => {
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'swiss', qualAdv: '99' }), 24, 1)).toBe(24);
  });

  it('is everyone with no pooling phase, whatever "advance" says', () => {
    expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'none', qualAdv: '' }), 31, 1)).toBe(31);
  });

  it('is unknown while "advance" is not a positive whole number', () => {
    for (const qualAdv of ['', '0', 'x']) {
      expect(bracketEntryCountFromSetup(setup({ poolingPhase: 'qual-table', qualAdv }), 24, 1)).toBeNull();
    }
  });

  it('follows Group Stage settings, and is unknown when generation would reject them', () => {
    const groups = { poolingPhase: 'group-stage' as const, qualAdv: '8' };
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupSize: '4', qualifiersPerGroup: '2' }), 16, 1),
    ).toBe(8);
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupSize: '2', qualifiersPerGroup: '1' }), 16, 1),
    ).toBeNull();
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupSize: '6', qualifiersPerGroup: '1' }), 16, 1),
    ).toBeNull();
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupSize: '4', qualifiersPerGroup: '4' }), 16, 1),
    ).toBeNull();
  });

  it('is unknown when qualifiers per group would take a whole real group, which is smaller than the group size', () => {
    const groups = {
      poolingPhase: 'group-stage' as const,
      qualAdv: '8',
      groupSize: '4',
      qualifiersPerGroup: '3',
    };
    expect(bracketEntryCountFromSetup(setup(groups), 15, 1)).toBeNull();
    expect(bracketEntryCountFromSetup(setup(groups), 16, 1)).toBe(12);
    expect(bracketEntryCountFromSetup(setup(groups), 13, 1)).toBe(9);
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupSize: '5', qualifiersPerGroup: '4' }), 11, 1),
    ).toBeNull();
  });

  it('a total group exit is the advance count; a setup without the field is per group, as everywhere else', () => {
    const groups = {
      poolingPhase: 'group-stage' as const,
      qualAdv: '8',
      groupSize: '4',
      qualifiersPerGroup: '2',
    };
    expect(bracketEntryCountFromSetup(setup({ ...groups, groupExit: 'fair-cut' }), 13, 1)).toBe(8);
    expect(
      bracketEntryCountFromSetup(setup({ ...groups, groupExit: 'fair-cut', qualifiersPerGroup: '9' }), 13, 1),
    ).toBe(8);
    const withoutField = { ...setup(groups), groupExit: undefined } as unknown as ReturnType<
      typeof createDefaultSetup
    >;
    expect(bracketEntryCountFromSetup(withoutField, 13, 1)).toBe(6);
    expect(bracketEntryCountFromSetup({ ...withoutField, qualifiersPerGroup: '9' }, 13, 1)).toBeNull();
  });
});

describe('WATERFALL_EXAMPLES', () => {
  it.each(WATERFALL_EXAMPLES.map((example) => [example.id, example] as const))(
    '%s is a complete graph for exactly its own entrant count',
    (_id, example) => {
      const parsed = parseWaterfallGraph(example.text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      const result = validateAndOrderWaterfallGraph(parsed.value, {
        roomSize: { min: 6, max: 8, ideal: 8 },
        entrantCount: example.entrants,
      });
      expect(result.ok).toBe(true);
    },
  );

  it('loads into the editor draft and writes back as the same draft (out ranks are no longer written)', () => {
    for (const example of WATERFALL_EXAMPLES) {
      const draft = parseWaterfallDraft(example.text);
      expect(draft.ok).toBe(true);
      if (draft.ok) expect(parseWaterfallDraft(serializeWaterfallDraft(draft.value))).toEqual(draft);
    }
  });
});
