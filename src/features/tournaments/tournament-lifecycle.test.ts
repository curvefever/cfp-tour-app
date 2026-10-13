import { describe, expect, it } from 'vitest';
import {
  canDelete,
  canFinish,
  canPublish,
  canReopen,
  canReturnToDraft,
  canUnpublish,
  isVisibleToViewers,
  STARTING_SOON_MS,
  tournamentPhase,
  transitionRefusal,
  type LifecycleSubject,
} from './tournament-lifecycle';

const MINUTE = 60 * 1000;
const SCHEDULED = Date.UTC(2026, 9, 18, 18, 0);

const published = { status: 'published', started: false, scheduledAt: SCHEDULED } as const;

describe('tournamentPhase', () => {
  it('is upcoming more than an hour before the scheduled time', () => {
    expect(tournamentPhase(published, SCHEDULED - 61 * MINUTE)).toBe('upcoming');
  });

  it('is starting soon from one hour before, including the boundary', () => {
    expect(STARTING_SOON_MS).toBe(60 * MINUTE);
    expect(tournamentPhase(published, SCHEDULED - 60 * MINUTE)).toBe('starting-soon');
    expect(tournamentPhase(published, SCHEDULED - 59 * MINUTE)).toBe('starting-soon');
    expect(tournamentPhase(published, SCHEDULED - 1 * MINUTE)).toBe('starting-soon');
  });

  it('stays starting soon after the scheduled time until it starts', () => {
    expect(tournamentPhase(published, SCHEDULED)).toBe('starting-soon');
    expect(tournamentPhase(published, SCHEDULED + 3 * 60 * MINUTE)).toBe('starting-soon');
  });

  it('is ongoing once started, at any time', () => {
    expect(tournamentPhase({ ...published, started: true }, SCHEDULED - 5 * 60 * MINUTE)).toBe('ongoing');
    expect(tournamentPhase({ ...published, started: true }, SCHEDULED + MINUTE)).toBe('ongoing');
  });

  it('is finished whenever the status says so', () => {
    expect(tournamentPhase({ ...published, status: 'finished', started: true }, SCHEDULED)).toBe('finished');
  });

  it('is a draft whatever the date', () => {
    expect(tournamentPhase({ ...published, status: 'draft' }, SCHEDULED)).toBe('draft');
  });

  it('is upcoming, never starting soon, when no time is set', () => {
    expect(tournamentPhase({ ...published, scheduledAt: null }, SCHEDULED)).toBe('upcoming');
  });
});

describe('isVisibleToViewers', () => {
  it('never shows a draft', () => {
    expect(isVisibleToViewers({ status: 'draft', testRun: false }, 'prod')).toBe(false);
    expect(isVisibleToViewers({ status: 'draft', testRun: true }, 'test')).toBe(false);
  });

  it('shows a published or finished tournament on production', () => {
    expect(isVisibleToViewers({ status: 'published', testRun: false }, 'prod')).toBe(true);
    expect(isVisibleToViewers({ status: 'finished', testRun: false }, 'prod')).toBe(true);
  });

  it('hides a test run on production but not on the test site', () => {
    expect(isVisibleToViewers({ status: 'published', testRun: true }, 'prod')).toBe(false);
    expect(isVisibleToViewers({ status: 'finished', testRun: true }, 'prod')).toBe(false);
    expect(isVisibleToViewers({ status: 'published', testRun: true }, 'test')).toBe(true);
  });
});

describe('transition guards', () => {
  const draft: LifecycleSubject = {
    status: 'draft',
    started: false,
    testRun: false,
    title: 'Autumn Cup',
    scheduledAt: SCHEDULED,
  };
  const ongoing: LifecycleSubject = { ...draft, status: 'published', started: true };
  const finished: LifecycleSubject = { ...ongoing, status: 'finished' };

  it('publishes a draft that has a title and a date', () => {
    expect(canPublish(draft)).toBe(true);
  });

  it('names what is missing when publishing is refused', () => {
    expect(transitionRefusal('publish', { ...draft, title: '  ' })).toMatch(/title/);
    expect(transitionRefusal('publish', { ...draft, scheduledAt: null })).toMatch(/date and time/);
    expect(canPublish({ ...draft, status: 'published' })).toBe(false);
  });

  it('unpublishes only a published tournament that has not started', () => {
    const upcoming = { ...draft, status: 'published' } as const;
    expect(canUnpublish(upcoming)).toBe(true);
    expect(canUnpublish(draft)).toBe(false);
    expect(canUnpublish(ongoing)).toBe(false);
    expect(canUnpublish(finished)).toBe(false);
  });

  it('deletes a draft in any case, and anything else only for a test run', () => {
    expect(canDelete(draft)).toBe(true);
    expect(canDelete(ongoing)).toBe(false);
    expect(canDelete(finished)).toBe(false);
    expect(canDelete({ ...ongoing, testRun: true })).toBe(true);
    expect(canDelete({ ...finished, testRun: true })).toBe(true);
  });

  it('finishes a started tournament that is not finished', () => {
    expect(canFinish(ongoing)).toBe(true);
    expect(canFinish(finished)).toBe(false);
    expect(canFinish({ ...draft, status: 'published' })).toBe(false);
  });

  it('reopens only a finished tournament', () => {
    expect(canReopen(finished)).toBe(true);
    expect(canReopen(ongoing)).toBe(false);
    expect(canReopen(draft)).toBe(false);
  });

  it('returns to draft only from started and not finished', () => {
    expect(canReturnToDraft(ongoing)).toBe(true);
    expect(canReturnToDraft(finished)).toBe(false);
    expect(canReturnToDraft({ ...draft, status: 'published' })).toBe(false);
  });

  it('refuses a second start', () => {
    expect(transitionRefusal('start', draft)).toBeNull();
    expect(transitionRefusal('start', ongoing)).toBe('This tournament has already started.');
  });
});
