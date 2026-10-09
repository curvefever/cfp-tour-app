import { describe, expect, it } from 'vitest';
import { effectiveTab, visibleTabs } from './tabs';

const keys = (canAdmin: boolean, showStandings: boolean) =>
  visibleTabs({ canAdmin, showStandings }).map((tab) => tab.key);

describe('visibleTabs', () => {
  it('shows an anonymous visitor no Admin tab, with Home first', () => {
    expect(keys(false, false)).toEqual(['home', 'bracket', 'rankings', 'archive']);
    expect(keys(false, true)).toEqual(['home', 'bracket', 'standings', 'rankings', 'archive']);
  });

  it('shows a signed-in admin the Admin tab right after Home', () => {
    expect(keys(true, false)).toEqual(['home', 'admin', 'bracket', 'rankings', 'archive']);
    expect(keys(true, true)).toEqual(['home', 'admin', 'bracket', 'standings', 'rankings', 'archive']);
  });
});

describe('effectiveTab', () => {
  it('shows Home for a stored Admin tab without a session', () => {
    expect(effectiveTab('admin', { canAdmin: false, showStandings: false })).toBe('home');
  });

  it('shows Bracket for a stored Standings tab without a standings phase', () => {
    expect(effectiveTab('standings', { canAdmin: true, showStandings: false })).toBe('bracket');
  });

  it('passes every available tab through', () => {
    expect(effectiveTab('admin', { canAdmin: true, showStandings: false })).toBe('admin');
    expect(effectiveTab('standings', { canAdmin: false, showStandings: true })).toBe('standings');
    expect(effectiveTab('home', { canAdmin: false, showStandings: false })).toBe('home');
    expect(effectiveTab('rankings', { canAdmin: false, showStandings: false })).toBe('rankings');
  });
});
