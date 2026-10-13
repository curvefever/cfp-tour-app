import { describe, expect, it } from 'vitest';
import type { TournamentPhase } from '../tournaments/tournament-lifecycle';
import { effectiveTab, visibleTabs, type TabContext } from './tabs';

const context = (overrides: Partial<TabContext> = {}): TabContext => ({
  canAdmin: false,
  phase: null,
  showStandings: false,
  ...overrides,
});

const keys = (overrides: Partial<TabContext> = {}) => visibleTabs(context(overrides)).map((tab) => tab.key);

describe('visibleTabs', () => {
  it('shows only Tournaments when no tournament is loaded', () => {
    expect(keys()).toEqual(['tournaments']);
  });

  it('adds the Admin tab, which lists the tournaments, for a signed-in admin with nothing loaded', () => {
    expect(keys({ canAdmin: true })).toEqual(['tournaments', 'admin']);
  });

  it('shows Info and Players, but no Bracket or Standings, before the tournament starts', () => {
    for (const phase of ['draft', 'upcoming', 'starting-soon'] as TournamentPhase[]) {
      expect(keys({ phase, showStandings: true })).toEqual(['tournaments', 'info', 'rankings']);
    }
  });

  it('shows Bracket and Rankings once it is ongoing, and Standings only in a standings phase', () => {
    expect(keys({ phase: 'ongoing' })).toEqual(['tournaments', 'info', 'bracket', 'rankings']);
    expect(keys({ phase: 'ongoing', showStandings: true })).toEqual([
      'tournaments',
      'info',
      'bracket',
      'standings',
      'rankings',
    ]);
  });

  it('keeps the same tabs for a finished tournament', () => {
    expect(keys({ phase: 'finished' })).toEqual(['tournaments', 'info', 'bracket', 'rankings']);
  });

  it('puts the Admin tab after Info for an admin with a tournament loaded', () => {
    expect(keys({ canAdmin: true, phase: 'ongoing', showStandings: true })).toEqual([
      'tournaments',
      'info',
      'admin',
      'bracket',
      'standings',
      'rankings',
    ]);
  });

  it('labels the rankings tab Players before the start and Rankings from the start', () => {
    const label = (phase: TournamentPhase) =>
      visibleTabs(context({ phase })).find((tab) => tab.key === 'rankings')?.label;
    expect(label('upcoming')).toMatch(/Players/);
    expect(label('draft')).toMatch(/Players/);
    expect(label('ongoing')).toMatch(/Rankings/);
    expect(label('finished')).toMatch(/Rankings/);
  });
});

describe('effectiveTab', () => {
  it('shows Tournaments for a stored tab when nothing is loaded', () => {
    expect(effectiveTab('bracket', context())).toBe('tournaments');
    expect(effectiveTab('info', context())).toBe('tournaments');
    expect(effectiveTab('rankings', context())).toBe('tournaments');
  });

  it('shows Tournaments for a stored Admin tab without a session, and Info for one with a tournament', () => {
    expect(effectiveTab('admin', context())).toBe('tournaments');
    expect(effectiveTab('admin', context({ phase: 'upcoming' }))).toBe('info');
  });

  it('shows Info for a stored Bracket tab before the tournament starts', () => {
    expect(effectiveTab('bracket', context({ phase: 'starting-soon' }))).toBe('info');
  });

  it('shows Bracket for a stored Standings tab without a standings phase', () => {
    expect(effectiveTab('standings', context({ phase: 'ongoing' }))).toBe('bracket');
    expect(effectiveTab('standings', context({ phase: 'upcoming' }))).toBe('info');
  });

  it('passes every available tab through', () => {
    expect(effectiveTab('admin', context({ canAdmin: true }))).toBe('admin');
    expect(effectiveTab('standings', context({ phase: 'ongoing', showStandings: true }))).toBe('standings');
    expect(effectiveTab('tournaments', context({ phase: 'ongoing' }))).toBe('tournaments');
    expect(effectiveTab('rankings', context({ phase: 'upcoming' }))).toBe('rankings');
  });
});
