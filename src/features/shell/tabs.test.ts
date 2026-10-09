import { describe, expect, it } from 'vitest';
import { effectiveTab, visibleTabs } from './tabs';

const keys = (showStandings: boolean) => visibleTabs({ showStandings }).map((tab) => tab.key);

describe('visibleTabs', () => {
  it('lists Home first and leaves Standings out without a standings phase', () => {
    expect(keys(false)).toEqual(['home', 'admin', 'bracket', 'rankings', 'archive']);
  });

  it('puts Standings between Bracket and Rankings once there is a standings phase', () => {
    expect(keys(true)).toEqual(['home', 'admin', 'bracket', 'standings', 'rankings', 'archive']);
  });
});

describe('effectiveTab', () => {
  it('shows Bracket for a stored Standings tab without a standings phase', () => {
    expect(effectiveTab('standings', { showStandings: false })).toBe('bracket');
  });

  it('passes every other tab through', () => {
    expect(effectiveTab('standings', { showStandings: true })).toBe('standings');
    expect(effectiveTab('home', { showStandings: false })).toBe('home');
    expect(effectiveTab('rankings', { showStandings: false })).toBe('rankings');
  });
});
