import { describe, expect, it } from 'vitest';
import type { TournamentSummary } from './tournament-summary';
import { tournamentSections, unitCountLabel } from './tournaments-list';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 18, 18, 0);

function summary(id: string, overrides: Partial<TournamentSummary> = {}): TournamentSummary {
  return {
    id,
    title: id,
    status: 'published',
    started: false,
    testRun: false,
    scheduledAt: NOW + 48 * HOUR,
    createdAt: 1,
    finishedAt: null,
    gameFormat: 'ffa-individual',
    poolingPhase: 'none',
    scheduleLogic: 'single-elimination',
    unitCount: 31,
    ...overrides,
  };
}

const ids = (cards: { summary: TournamentSummary }[]) => cards.map((card) => card.summary.id);
const sections = (list: TournamentSummary[], env: 'prod' | 'test' = 'prod', isAdmin = false) =>
  tournamentSections(list, { env, nowMs: NOW, isAdmin });

describe('tournamentSections', () => {
  it('puts each tournament in the section of its phase', () => {
    const result = sections([
      summary('live', { started: true, scheduledAt: NOW - HOUR }),
      summary('soon', { scheduledAt: NOW + 30 * 60 * 1000 }),
      summary('later'),
      summary('done', { status: 'finished', started: true, finishedAt: NOW - 5 * HOUR }),
    ]);
    expect(ids(result.ongoing)).toEqual(['live']);
    expect(ids(result.upcoming)).toEqual(['soon', 'later']);
    expect(ids(result.finished)).toEqual(['done']);
  });

  it('sorts Upcoming soonest first and Finished newest first', () => {
    const result = sections([
      summary('c', { scheduledAt: NOW + 72 * HOUR }),
      summary('a', { scheduledAt: NOW + 24 * HOUR }),
      summary('b', { scheduledAt: NOW + 48 * HOUR }),
      summary('old', { status: 'finished', started: true, scheduledAt: null, finishedAt: NOW - 100 * HOUR }),
      summary('new', { status: 'finished', started: true, scheduledAt: null, finishedAt: NOW - 2 * HOUR }),
      summary('mid', { status: 'finished', started: true, scheduledAt: null, finishedAt: NOW - 30 * HOUR }),
    ]);
    expect(ids(result.upcoming)).toEqual(['a', 'b', 'c']);
    expect(ids(result.finished)).toEqual(['new', 'mid', 'old']);
  });

  it('orders finished tournaments by their scheduled date, not by when they were finished', () => {
    const result = sections([
      summary('oct15', {
        status: 'finished',
        started: true,
        scheduledAt: NOW - 72 * HOUR,
        finishedAt: NOW - 2 * HOUR,
      }),
      summary('oct18', {
        status: 'finished',
        started: true,
        scheduledAt: NOW - 24 * HOUR,
        finishedAt: NOW - 20 * HOUR,
      }),
      summary('undated', {
        status: 'finished',
        started: true,
        scheduledAt: null,
        finishedAt: NOW - 48 * HOUR,
      }),
    ]);
    expect(ids(result.finished)).toEqual(['oct18', 'undated', 'oct15']);
  });

  it('marks an upcoming tournament within the hour before its start, with no section of its own', () => {
    const result = sections([summary('soon', { scheduledAt: NOW + 59 * 60 * 1000 }), summary('later')]);
    expect(result.upcoming.map((card) => [card.summary.id, card.startingSoon])).toEqual([
      ['soon', true],
      ['later', false],
    ]);
  });

  it('keeps a starting-soon tournament in Upcoming after its scheduled time, until it starts', () => {
    const result = sections([summary('late', { scheduledAt: NOW - 20 * 60 * 1000 })]);
    expect(ids(result.upcoming)).toEqual(['late']);
    expect(result.upcoming[0].startingSoon).toBe(true);
  });

  it('puts an undated upcoming tournament last', () => {
    const result = sections([summary('undated', { scheduledAt: null }), summary('dated')]);
    expect(ids(result.upcoming)).toEqual(['dated', 'undated']);
  });

  it('never lists a draft', () => {
    const result = sections([summary('draft', { status: 'draft' })], 'test', true);
    expect([...result.ongoing, ...result.upcoming, ...result.finished]).toEqual([]);
  });

  it('does not list a draft to an admin either', () => {
    const result = sections([summary('draft', { status: 'draft' }), summary('real')], 'prod', true);
    expect(
      [...result.ongoing, ...result.upcoming, ...result.finished].map((card) => card.summary.id),
    ).toEqual(['real']);
  });

  it('hides test runs from viewers on production', () => {
    const rehearsal = summary('rehearsal', { testRun: true, started: true, scheduledAt: NOW - HOUR });
    expect(ids(sections([rehearsal, summary('real')], 'prod').upcoming)).toEqual(['real']);
    expect(sections([rehearsal], 'prod').ongoing).toEqual([]);
  });

  it('shows test runs to viewers on the test site, and to admins on production', () => {
    const rehearsal = summary('rehearsal', { testRun: true, started: true, scheduledAt: NOW - HOUR });
    expect(ids(sections([rehearsal], 'test').ongoing)).toEqual(['rehearsal']);
    expect(ids(sections([rehearsal], 'prod', true).ongoing)).toEqual(['rehearsal']);
  });

  it('is empty for no tournament', () => {
    expect(sections([])).toEqual({ ongoing: [], upcoming: [], finished: [] });
  });
});

describe('unitCountLabel', () => {
  it('counts the players of a 31-player FFA tournament on its card', () => {
    const [card] = sections([summary('ffa', { unitCount: 31 })]).upcoming;
    expect(card.unitLabel).toBe('31 players');
  });

  it('counts teams, not players, for a team format', () => {
    expect(unitCountLabel({ gameFormat: 'team-3v3v3', unitCount: 12 })).toBe('12 teams');
    expect(unitCountLabel({ gameFormat: 'team-2v2v2v2', unitCount: 12 })).toBe('12 teams');
    expect(unitCountLabel({ gameFormat: 'team-3v3', unitCount: 8 })).toBe('8 teams');
  });

  it('counts players for 1v1, and uses the singular for one', () => {
    expect(unitCountLabel({ gameFormat: 'individual-1v1', unitCount: 16 })).toBe('16 players');
    expect(unitCountLabel({ gameFormat: 'individual-1v1', unitCount: 1 })).toBe('1 player');
    expect(unitCountLabel({ gameFormat: 'team-3v3v3', unitCount: 1 })).toBe('1 team');
  });
});
