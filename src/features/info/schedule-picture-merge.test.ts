import { describe, expect, it } from 'vitest';
import { mergedName } from './schedule-picture-merge';

describe('mergedName', () => {
  it('keeps one label as it is', () => {
    expect(mergedName(['Semi-Final A'])).toBe('Semi-Final A');
  });

  it('shares the words that do not differ and lists the last words', () => {
    expect(mergedName(['Round 6 B', 'Round 6 C'])).toBe('Round 6 · B, C');
    expect(mergedName(['Round 6 B', 'Round 6 C', 'Round 6 D'])).toBe('Round 6 · B, C, D');
  });

  it('joins the labels when they differ before the last word', () => {
    expect(mergedName(['Round 5 Lower', 'Round 6 Lower'])).toBe('Round 5 Lower · Round 6 Lower');
    expect(mergedName(['Final', 'Round 7'])).toBe('Final · Round 7');
  });
});
