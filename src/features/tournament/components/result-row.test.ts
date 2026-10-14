import { describe, expect, it } from 'vitest';
import { rowSurfaceClasses, standingsRowResult, stripeTone, type RowResult } from './result-row';

describe('stripeTone', () => {
  it.each<[RowResult, ReturnType<typeof stripeTone>]>([
    ['advance', 'green'],
    ['promote', 'green'],
    ['lucky', 'green'],
    ['advance-second', 'yellow'],
    ['stay', 'yellow'],
    ['demote', 'orange'],
    ['drop', 'purple'],
    ['advance-third', 'purple'],
    ['eliminate', 'red'],
    ['below-cut', 'red'],
    ['pending', 'dashed'],
    ['candidate', 'dashed'],
    ['undecided', 'dashed'],
    ['', null],
  ])('%s gives %s', (result, tone) => {
    expect(stripeTone(result)).toBe(tone);
  });
});

describe('rowSurfaceClasses', () => {
  it('alternates the two row grounds', () => {
    expect(rowSurfaceClasses(0, false)).toBe('bg-cfp-row-a');
    expect(rowSurfaceClasses(1, false)).toBe('bg-cfp-row-b');
    expect(rowSurfaceClasses(2, false)).toBe('bg-cfp-row-a');
  });

  it('gives a followed row the lighter ground and the ring, whatever its position', () => {
    for (const index of [0, 1]) {
      const classes = rowSurfaceClasses(index, true);
      expect(classes).toContain('bg-cfp-followed');
      expect(classes).toContain('--color-cfp-followed-ring');
      expect(classes).not.toContain('bg-cfp-row');
    }
  });
});

describe('standingsRowResult', () => {
  it('advances every row when there is no cut, and the rows above it', () => {
    expect(standingsRowResult(30, null, 'live')).toBe('advance');
    expect(standingsRowResult(23, 24, 'live')).toBe('advance');
  });

  it('shows rows past the cut as below it while live, and eliminated once the standings are final', () => {
    expect(standingsRowResult(24, 24, 'live')).toBe('below-cut');
    expect(standingsRowResult(24, 24, 'final')).toBe('eliminate');
    expect(standingsRowResult(36, 24, 'final')).toBe('eliminate');
  });
});
