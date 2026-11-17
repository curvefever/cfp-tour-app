import { describe, expect, it } from 'vitest';
import { GROUP_SIZE_BOUNDS, groupSettingsOf, groupSettingsOfCfg, groupSizesOf } from '../group-settings';

describe('GROUP_SIZE_BOUNDS', () => {
  it('lets a group have 3 to 5 units and falls back to 4', () => {
    expect(GROUP_SIZE_BOUNDS).toEqual({ min: 3, max: 5, ideal: 4 });
  });
});

describe('groupSettingsOf (a Setup form)', () => {
  it.each([
    ['empty fields', { groupSize: '', qualifiersPerGroup: '' }],
    ['fields that are no number', { groupSize: 'x', qualifiersPerGroup: 'abc' }],
    ['fields that are 0', { groupSize: '0', qualifiersPerGroup: '0' }],
    ['a form without the fields (a narrower Pick)', {}],
  ])('falls back to group size 4 and 2 qualifiers per group for %s', (_name, form) => {
    expect(groupSettingsOf(form)).toEqual({ groupSize: 4, qualifiersPerGroup: 2 });
  });

  it('reads a typed number', () => {
    expect(groupSettingsOf({ groupSize: '5', qualifiersPerGroup: '3' })).toEqual({
      groupSize: 5,
      qualifiersPerGroup: 3,
    });
  });

  it('reads each field on its own: one missing field does not change the other', () => {
    expect(groupSettingsOf({ groupSize: '3' })).toEqual({ groupSize: 3, qualifiersPerGroup: 2 });
    expect(groupSettingsOf({ qualifiersPerGroup: '1' })).toEqual({ groupSize: 4, qualifiersPerGroup: 1 });
  });

  it('reads loosely, as parseInt does: the number at the start counts, a negative one is kept', () => {
    expect(groupSettingsOf({ groupSize: '3abc', qualifiersPerGroup: '1.9' })).toEqual({
      groupSize: 3,
      qualifiersPerGroup: 1,
    });
    expect(groupSettingsOf({ groupSize: '-2', qualifiersPerGroup: '-1' })).toEqual({
      groupSize: -2,
      qualifiersPerGroup: -1,
    });
  });
});

describe('groupSettingsOfCfg (a stored tournament)', () => {
  it('falls back to group size 4, a single round robin and 2 qualifiers per group', () => {
    expect(groupSettingsOfCfg({})).toEqual({
      groupSize: 4,
      roundRobinMode: 'single',
      qualifiersPerGroup: 2,
    });
  });

  it('keeps the stored numbers and mode', () => {
    expect(groupSettingsOfCfg({ groupSize: 5, roundRobinMode: 'double', qualifiersPerGroup: 3 })).toEqual({
      groupSize: 5,
      roundRobinMode: 'double',
      qualifiersPerGroup: 3,
    });
  });

  it('keeps a stored 0 (unlike the form reader, which reads 0 as empty)', () => {
    expect(groupSettingsOfCfg({ groupSize: 0, qualifiersPerGroup: 0 })).toMatchObject({
      groupSize: 0,
      qualifiersPerGroup: 0,
    });
  });
});

describe('groupSizesOf', () => {
  it.each([
    [31, 3, [4, 3, 3, 3, 3, 3, 3, 3, 3, 3]],
    [31, 4, [4, 4, 4, 4, 4, 4, 4, 3]],
    [31, 5, [5, 5, 5, 4, 4, 4, 4]],
    [37, 3, [4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]],
    [37, 4, [5, 4, 4, 4, 4, 4, 4, 4, 4]],
    [37, 5, [5, 5, 5, 5, 5, 4, 4, 4]],
    [43, 3, [4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]],
    [43, 4, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3]],
    [43, 5, [5, 5, 5, 5, 5, 5, 5, 4, 4]],
    [53, 3, [4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]],
    [53, 4, [5, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]],
    [53, 5, [5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4]],
  ])('splits %i units with group size %i into %j', (unitCount, groupSize, sizes) => {
    expect(groupSizesOf(unitCount, groupSize)).toEqual(sizes);
  });

  it.each([
    [3, 4, [3]],
    [6, 3, [3, 3]],
    [9, 5, [5, 4]],
    [12, 2, [3, 3, 3, 3]],
    [12, 6, [4, 4, 4]],
  ])(
    'keeps every group within the bounds: %i units, group size %i gives %j',
    (unitCount, groupSize, sizes) => {
      expect(groupSizesOf(unitCount, groupSize)).toEqual(sizes);
      for (const size of groupSizesOf(unitCount, groupSize)) {
        expect(size).toBeGreaterThanOrEqual(GROUP_SIZE_BOUNDS.min);
        expect(size).toBeLessThanOrEqual(GROUP_SIZE_BOUNDS.max);
      }
    },
  );
});
