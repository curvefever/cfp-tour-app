import { describe, expect, it } from 'vitest';
import { LEGACY_LAST_TAB_KEY } from '../../lib/persistence/storage-keys';
import { readLastView } from '../../lib/persistence/storage';
import { createMemoryStorage } from '../../lib/persistence/test-fixtures';
import type { TournamentSummary } from './tournament-summary';
import { landingTab, RECENTLY_FINISHED_MS, resolveVisit, UNAVAILABLE_NOTICE, type VisitInput } from './visit';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = Date.UTC(2026, 9, 18, 18, 0);

function summary(id: string, overrides: Partial<TournamentSummary> = {}): TournamentSummary {
  return {
    id,
    title: id,
    status: 'published',
    started: false,
    testRun: false,
    scheduledAt: NOW + 3 * 24 * HOUR,
    createdAt: 1,
    finishedAt: null,
    gameFormat: 'ffa-individual',
    poolingPhase: 'none',
    scheduleLogic: 'single-elimination',
    unitCount: 37,
    ...overrides,
  };
}

const upcoming = (id: string) => summary(id);
const startingSoon = (id: string) => summary(id, { scheduledAt: NOW + 59 * MINUTE });
const ongoing = (id: string) => summary(id, { started: true, scheduledAt: NOW - HOUR });
const draft = (id: string) => summary(id, { status: 'draft' });
const finished = (id: string, ago: number) =>
  summary(id, { status: 'finished', started: true, finishedAt: NOW - ago, scheduledAt: NOW - 5 * HOUR });

function visit(summaries: TournamentSummary[], overrides: Partial<VisitInput> = {}) {
  return resolveVisit({
    urlId: null,
    summaries,
    env: 'prod',
    nowMs: NOW,
    memory: { lastView: null, exited: null },
    isAdmin: false,
    ...overrides,
  });
}

describe('a link to a tournament', () => {
  it('opens a published tournament on Info', () => {
    expect(visit([upcoming('a')], { urlId: 'a' })).toEqual({ tournamentId: 'a', tab: 'info' });
  });

  it('opens one on the landing tab of its phase', () => {
    expect(visit([startingSoon('a')], { urlId: 'a' }).tab).toBe('info');
    expect(visit([ongoing('a')], { urlId: 'a' }).tab).toBe('bracket');
    expect(visit([finished('a', 30 * HOUR)], { urlId: 'a' }).tab).toBe('rankings');
  });

  it('wins over the tournament that would load by itself', () => {
    expect(visit([ongoing('live'), upcoming('a')], { urlId: 'a' }).tournamentId).toBe('a');
  });

  it('says the tournament is not available for a draft, for a viewer', () => {
    expect(visit([draft('a')], { urlId: 'a' })).toEqual({
      tournamentId: null,
      tab: 'tournaments',
      notice: UNAVAILABLE_NOTICE,
    });
  });

  it('says the same for a test run on production, and for an id nobody knows', () => {
    const rehearsal = { ...ongoing('a'), testRun: true };
    expect(visit([rehearsal], { urlId: 'a' }).notice).toBe(UNAVAILABLE_NOTICE);
    expect(visit([upcoming('a')], { urlId: 'missing' }).notice).toBe(UNAVAILABLE_NOTICE);
    expect(visit([], { urlId: 'a' }).tournamentId).toBeNull();
  });

  it('lets an admin open a draft, on Admin, and a production test run', () => {
    expect(visit([draft('a')], { urlId: 'a', isAdmin: true })).toEqual({ tournamentId: 'a', tab: 'admin' });
    const rehearsal = { ...ongoing('b'), testRun: true };
    expect(visit([rehearsal], { urlId: 'b', isAdmin: true }).tournamentId).toBe('b');
  });

  it('still says unknown for an id nobody knows, even to an admin', () => {
    expect(visit([], { urlId: 'a', isAdmin: true }).notice).toBe(UNAVAILABLE_NOTICE);
  });

  it('shows a test run on the test site like any tournament', () => {
    const rehearsal = { ...ongoing('a'), testRun: true };
    expect(visit([rehearsal], { urlId: 'a', env: 'test' }).tournamentId).toBe('a');
  });
});

describe('a visit without a link', () => {
  it('loads the only tournament that is ongoing, on Bracket', () => {
    expect(visit([ongoing('a'), upcoming('b')])).toEqual({ tournamentId: 'a', tab: 'bracket' });
  });

  it('loads the only tournament that is starting soon, on Info', () => {
    expect(visit([startingSoon('a'), upcoming('b')])).toEqual({ tournamentId: 'a', tab: 'info' });
  });

  it('opens Tournaments when two are starting soon or ongoing, not the first of them', () => {
    expect(visit([ongoing('a'), ongoing('b')])).toEqual({ tournamentId: null, tab: 'tournaments' });
    expect(visit([ongoing('a'), startingSoon('b')]).tournamentId).toBeNull();
  });

  it('opens Tournaments when nothing is ongoing, starting soon or recently finished', () => {
    expect(visit([upcoming('a'), draft('b')])).toEqual({ tournamentId: null, tab: 'tournaments' });
    expect(visit([])).toEqual({ tournamentId: null, tab: 'tournaments' });
  });

  it('ignores a draft and a tournament that is more than an hour from its start', () => {
    const sixtyOneMinutes = summary('late', { scheduledAt: NOW + 61 * MINUTE });
    expect(visit([draft('a'), sixtyOneMinutes]).tournamentId).toBeNull();
  });

  it('hides a test run on production but loads it on the test site', () => {
    const rehearsal = { ...ongoing('a'), testRun: true };
    expect(visit([rehearsal]).tournamentId).toBeNull();
    expect(visit([rehearsal], { env: 'test' }).tournamentId).toBe('a');
  });

  it('does not count a hidden test run among several on production', () => {
    const rehearsal = { ...ongoing('x'), testRun: true };
    expect(visit([ongoing('a'), rehearsal]).tournamentId).toBe('a');
    expect(visit([ongoing('a'), rehearsal], { env: 'test' }).tournamentId).toBeNull();
  });

  it('does not load a draft for an admin either', () => {
    expect(visit([draft('a')], { isAdmin: true }).tournamentId).toBeNull();
  });
});

describe('the tournament finished most recently', () => {
  it('loads on Rankings when it finished less than 24 hours ago', () => {
    expect(visit([finished('a', 23 * HOUR)])).toEqual({ tournamentId: 'a', tab: 'rankings' });
  });

  it('is not loaded when it finished more than 24 hours ago', () => {
    expect(RECENTLY_FINISHED_MS).toBe(24 * HOUR);
    expect(visit([finished('a', 25 * HOUR)])).toEqual({ tournamentId: null, tab: 'tournaments' });
  });

  it('is the newest of several finished tournaments', () => {
    expect(visit([finished('old', 10 * HOUR), finished('new', 2 * HOUR)]).tournamentId).toBe('new');
  });

  it('gives way to a tournament that is ongoing', () => {
    expect(visit([finished('a', HOUR), ongoing('b')]).tournamentId).toBe('b');
  });

  it('stays unloaded after Exit, while it is the one that would load', () => {
    const memory = { lastView: null, exited: { tournamentId: 'a', phase: 'ongoing' as const } };
    expect(visit([finished('a', HOUR)], { memory })).toEqual({ tournamentId: null, tab: 'tournaments' });
  });
});

describe('Exit', () => {
  const exitedWhile = (phase: 'upcoming' | 'starting-soon' | 'ongoing', tournamentId = 'a') => ({
    lastView: null,
    exited: { tournamentId, phase },
  });

  it('sticks: a tournament exited while ongoing is not loaded again by a visit without a link', () => {
    expect(visit([ongoing('a')], { memory: exitedWhile('ongoing') })).toEqual({
      tournamentId: null,
      tab: 'tournaments',
    });
  });

  it('sticks for a tournament exited while starting soon, as long as it is still starting soon', () => {
    expect(visit([startingSoon('a')], { memory: exitedWhile('starting-soon') }).tournamentId).toBeNull();
  });

  it('loads again, forgetting the exit, when it is starting soon after being exited as upcoming', () => {
    expect(visit([startingSoon('a')], { memory: exitedWhile('upcoming') })).toMatchObject({
      tournamentId: 'a',
      tab: 'info',
      forgetExited: true,
    });
  });

  it('loads again, forgetting the exit, when it is ongoing after being exited as upcoming or starting soon', () => {
    expect(visit([ongoing('a')], { memory: exitedWhile('upcoming') })).toMatchObject({
      tournamentId: 'a',
      forgetExited: true,
    });
    expect(visit([ongoing('a')], { memory: exitedWhile('starting-soon') })).toMatchObject({
      tournamentId: 'a',
      tab: 'bracket',
      forgetExited: true,
    });
  });

  it('never pulls back a visitor who exited while the tournament was ongoing', () => {
    expect(visit([ongoing('a')], { memory: exitedWhile('ongoing') }).tournamentId).toBeNull();
  });

  it('does not stop a link to the exited tournament', () => {
    expect(visit([ongoing('a')], { memory: exitedWhile('ongoing'), urlId: 'a' }).tournamentId).toBe('a');
  });

  it('is forgotten once a different tournament is the one that would load', () => {
    const result = visit([startingSoon('b'), upcoming('a')], { memory: exitedWhile('ongoing') });
    expect(result).toMatchObject({ tournamentId: 'b', forgetExited: true });
  });

  it('keeps the exit while the exited tournament is not the one that would load', () => {
    expect(
      visit([ongoing('a'), upcoming('b')], { memory: exitedWhile('ongoing') }).forgetExited,
    ).toBeUndefined();
  });

  it('is kept while several tournaments are starting soon or ongoing', () => {
    const result = visit([ongoing('a'), ongoing('b')], { memory: exitedWhile('upcoming') });
    expect(result).toEqual({ tournamentId: null, tab: 'tournaments' });
  });

  it('has nothing to forget when nothing was exited', () => {
    expect(visit([ongoing('a')]).forgetExited).toBeUndefined();
  });
});

describe('the last tab', () => {
  const lastView = (tournamentId: string | null, tab: 'rankings' | 'info' | 'tournaments') => ({
    lastView: { tournamentId, tab },
    exited: null,
  });

  it('is restored when the same unfinished tournament loads again', () => {
    expect(visit([ongoing('a')], { memory: lastView('a', 'rankings') })).toEqual({
      tournamentId: 'a',
      tab: 'rankings',
    });
    expect(visit([upcoming('a')], { urlId: 'a', memory: lastView('a', 'rankings') }).tab).toBe('rankings');
  });

  it('is not restored for another tournament', () => {
    expect(visit([ongoing('a')], { memory: lastView('other', 'rankings') }).tab).toBe('bracket');
  });

  it('is never restored for a finished tournament', () => {
    expect(visit([finished('a', HOUR)], { memory: lastView('a', 'info') }).tab).toBe('rankings');
    expect(visit([finished('a', 30 * HOUR)], { urlId: 'a', memory: lastView('a', 'info') }).tab).toBe(
      'rankings',
    );
  });

  it('counts the old tab-only memory for any unfinished tournament', () => {
    expect(visit([ongoing('a')], { memory: lastView(null, 'rankings') }).tab).toBe('rankings');
    expect(visit([finished('a', HOUR)], { memory: lastView(null, 'info') }).tab).toBe('rankings');
  });

  it('is not used for a legacy Home tab, which opens the tournament on its landing tab', () => {
    const storage = createMemoryStorage({ [LEGACY_LAST_TAB_KEY]: 'home' });
    const memory = { lastView: readLastView(storage), exited: null };
    expect(visit([ongoing('a')], { memory })).toEqual({ tournamentId: 'a', tab: 'bracket' });
  });

  it('is not used when nothing loads', () => {
    expect(visit([], { memory: lastView('a', 'rankings') })).toEqual({
      tournamentId: null,
      tab: 'tournaments',
    });
  });
});

describe('landingTab', () => {
  it('is Admin for a draft, Info before the start, Bracket while ongoing and Rankings once finished', () => {
    expect(landingTab('draft')).toBe('admin');
    expect(landingTab('upcoming')).toBe('info');
    expect(landingTab('starting-soon')).toBe('info');
    expect(landingTab('ongoing')).toBe('bracket');
    expect(landingTab('finished')).toBe('rankings');
  });
});
