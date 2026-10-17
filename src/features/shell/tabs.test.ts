import { describe, expect, it } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentPhase, TournamentRound, TournamentState } from '../../domain/tournament/types';
import type { TournamentSummary } from '../tournaments/tournament-summary';
import { effectiveTab, loadedPhase, tabContextFor, visibleTabs, type TabContext } from './tabs';

const context = (overrides: Partial<TabContext> = {}): TabContext => ({
  canAdmin: false,
  phase: null,
  standingsTitle: null,
  scheduleDrawn: false,
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

  it('shows a viewer Info and Players, but no Bracket or Standings, before the start, even with a drawn schedule', () => {
    for (const phase of ['draft', 'upcoming', 'starting-soon'] as TournamentPhase[]) {
      for (const scheduleDrawn of [false, true]) {
        expect(keys({ phase, standingsTitle: 'Qualification', scheduleDrawn })).toEqual([
          'tournaments',
          'info',
          'rankings',
        ]);
      }
    }
  });

  it('shows an admin Bracket and Standings from schedule generation, before the start, drafts included', () => {
    for (const phase of ['draft', 'upcoming', 'starting-soon'] as TournamentPhase[]) {
      const admin = { canAdmin: true, phase, standingsTitle: 'Qualification' };
      expect(keys({ ...admin, scheduleDrawn: true })).toEqual([
        'tournaments',
        'info',
        'admin',
        'bracket',
        'standings',
        'rankings',
      ]);
      expect(keys({ ...admin, scheduleDrawn: false })).toEqual(['tournaments', 'info', 'admin', 'rankings']);
      expect(keys({ ...admin, standingsTitle: null, scheduleDrawn: true })).toContain('bracket');
      expect(keys({ ...admin, standingsTitle: null, scheduleDrawn: true })).not.toContain('standings');
    }
  });

  it('shows Bracket and Rankings once it is ongoing, and Standings only in a standings phase', () => {
    expect(keys({ phase: 'ongoing' })).toEqual(['tournaments', 'info', 'bracket', 'rankings']);
    expect(keys({ phase: 'ongoing', standingsTitle: 'Qualification' })).toEqual([
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
    expect(keys({ canAdmin: true, phase: 'ongoing', standingsTitle: 'Qualification' })).toEqual([
      'tournaments',
      'info',
      'admin',
      'bracket',
      'standings',
      'rankings',
    ]);
  });

  it('labels every tab with plain words, no emoji', () => {
    const labels = visibleTabs(
      context({ canAdmin: true, phase: 'ongoing', standingsTitle: 'Qualification' }),
    ).map((tab) => tab.label);
    expect(labels).toEqual(['Tournaments', 'Info', 'Admin', 'Bracket', 'Qualification', 'Rankings']);
  });

  it('names the standings tab after the pooling phase', () => {
    const label = (standingsTitle: string) =>
      visibleTabs(context({ phase: 'ongoing', standingsTitle })).find((tab) => tab.key === 'standings')
        ?.label;
    expect(label('Swiss')).toBe('Swiss');
    expect(label('Groups')).toBe('Groups');
  });

  it('labels the rankings tab Players before the start and Rankings from the start', () => {
    const label = (phase: TournamentPhase) =>
      visibleTabs(context({ phase })).find((tab) => tab.key === 'rankings')?.label;
    expect(label('upcoming')).toBe('Players');
    expect(label('draft')).toBe('Players');
    expect(label('ongoing')).toBe('Rankings');
    expect(label('finished')).toBe('Rankings');
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
    expect(effectiveTab('bracket', context({ phase: 'starting-soon', scheduleDrawn: true }))).toBe('info');
  });

  it('keeps a stored Bracket or Standings tab for an admin once the schedule is drawn', () => {
    const admin = context({ canAdmin: true, phase: 'draft', standingsTitle: 'Swiss', scheduleDrawn: true });
    expect(effectiveTab('bracket', admin)).toBe('bracket');
    expect(effectiveTab('standings', admin)).toBe('standings');
    expect(effectiveTab('bracket', { ...admin, scheduleDrawn: false })).toBe('info');
  });

  it('shows Bracket for a stored Standings tab without a standings phase', () => {
    expect(effectiveTab('standings', context({ phase: 'ongoing' }))).toBe('bracket');
    expect(effectiveTab('standings', context({ phase: 'upcoming' }))).toBe('info');
  });

  it('passes every available tab through', () => {
    expect(effectiveTab('admin', context({ canAdmin: true }))).toBe('admin');
    expect(effectiveTab('standings', context({ phase: 'ongoing', standingsTitle: 'Qualification' }))).toBe(
      'standings',
    );
    expect(effectiveTab('tournaments', context({ phase: 'ongoing' }))).toBe('tournaments');
    expect(effectiveTab('rankings', context({ phase: 'upcoming' }))).toBe('rankings');
  });
});

describe('loadedPhase', () => {
  const NOW = Date.UTC(2026, 9, 18, 18, 0);
  const blank = { tournamentId: 't1', lifecycle: undefined, started: false, info: undefined };
  const ongoingSummary = {
    id: 't1',
    status: 'published',
    started: true,
    scheduledAt: NOW - 3_600_000,
  } as TournamentSummary;
  const received: Pick<TournamentState, 'tournamentId' | 'lifecycle' | 'started' | 'info'> = {
    tournamentId: 't1',
    lifecycle: { status: 'published', testRun: false, createdAt: 1, finishedAt: null },
    started: false,
    info: { scheduledAt: NOW + 7 * 24 * 3_600_000, rulesText: '', screenshots: [] },
  };

  it('is null when nothing is loaded', () => {
    const nothing = { ...blank, tournamentId: null };
    expect(
      loadedPhase({ state: nothing, summary: ongoingSummary, stateReceived: false, nowMs: NOW }),
    ).toBeNull();
  });

  it('comes from the list entry until the stored state has arrived, so an ongoing tournament shows its tabs at once', () => {
    expect(loadedPhase({ state: blank, summary: ongoingSummary, stateReceived: false, nowMs: NOW })).toBe(
      'ongoing',
    );
  });

  it('comes from the state once it has arrived, whatever the list entry says', () => {
    expect(loadedPhase({ state: received, summary: ongoingSummary, stateReceived: true, nowMs: NOW })).toBe(
      'upcoming',
    );
  });

  it('falls back to the state when the list has no entry for the tournament', () => {
    expect(loadedPhase({ state: received, summary: undefined, stateReceived: false, nowMs: NOW })).toBe(
      'upcoming',
    );
  });
});

describe('tabContextFor', () => {
  const NOW = Date.UTC(2026, 9, 18, 18, 0);
  const loaded = createDefaultTournamentState({ tournamentId: 't1' });
  const input = { state: loaded, summary: undefined, canAdmin: true, stateReceived: true, nowMs: NOW };

  it('describes a loaded tournament with no schedule and no standings', () => {
    expect(tabContextFor(input)).toEqual({
      canAdmin: true,
      phase: 'upcoming',
      standingsTitle: null,
      scheduleDrawn: false,
    });
  });

  it('says the schedule is drawn once the state has rounds', () => {
    const drawn = { ...loaded, rounds: [{ isQual: true }] as TournamentRound[] };
    expect(tabContextFor({ ...input, state: drawn }).scheduleDrawn).toBe(true);
  });

  it('has no phase when no tournament is loaded', () => {
    expect(tabContextFor({ ...input, state: createDefaultTournamentState() }).phase).toBeNull();
  });
});
