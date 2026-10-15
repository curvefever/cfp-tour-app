import { describe, expect, it } from 'vitest';
import { rosterLoadStatus } from './roster-status';

describe('rosterLoadStatus', () => {
  it('counts the reserves in the singular and the plural', () => {
    expect(rosterLoadStatus(37, 1)).toBe('37 confirmed, 1 reserve');
    expect(rosterLoadStatus(37, 0)).toBe('37 confirmed, 0 reserves');
  });

  it('adds the individual reserves of a team format', () => {
    expect(rosterLoadStatus(13, 2, 1)).toBe('13 confirmed, 2 reserves, 1 individual reserve');
  });
});
