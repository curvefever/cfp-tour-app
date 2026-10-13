import type { TourEnvironment } from '../sync/firebase-paths';
import type { TournamentSummary } from './tournament-summary';

export type TournamentPhase = 'draft' | 'upcoming' | 'starting-soon' | 'ongoing' | 'finished';

/** How long before its scheduled time a published tournament counts as "Starting soon". */
export const STARTING_SOON_MS = 60 * 60 * 1000;

/** The fields of a tournament that decide what it may do next. */
export type LifecycleSubject = Pick<
  TournamentSummary,
  'status' | 'started' | 'testRun' | 'title' | 'scheduledAt'
>;

export function tournamentPhase(
  summary: Pick<TournamentSummary, 'status' | 'started' | 'scheduledAt'>,
  nowMs: number,
): TournamentPhase {
  if (summary.status === 'draft') return 'draft';
  if (summary.status === 'finished') return 'finished';
  if (summary.started) return 'ongoing';
  const startsSoon = summary.scheduledAt !== null && nowMs >= summary.scheduledAt - STARTING_SOON_MS;
  return startsSoon ? 'starting-soon' : 'upcoming';
}

/** Whether a viewer (not an admin) may see the tournament: never a draft, and on production never a test run. */
export function isVisibleToViewers(
  summary: Pick<TournamentSummary, 'status' | 'testRun'>,
  env: TourEnvironment,
): boolean {
  if (summary.status === 'draft') return false;
  return !(env === 'prod' && summary.testRun);
}

export type TournamentAction =
  'publish' | 'unpublish' | 'delete' | 'finish' | 'reopen' | 'returnToDraft' | 'start';

/** Why `action` is not allowed on the tournament right now, or `null` when it is. */
export function transitionRefusal(action: TournamentAction, subject: LifecycleSubject): string | null {
  switch (action) {
    case 'publish':
      if (subject.status !== 'draft') return 'This tournament is already published.';
      if (!subject.title.trim()) return 'Give the tournament a title before publishing it.';
      if (subject.scheduledAt === null) return 'Set a date and time before publishing the tournament.';
      return null;
    case 'unpublish':
      if (subject.status !== 'published') return 'Only a published tournament can be unpublished.';
      return subject.started ? 'A tournament that has started cannot be unpublished.' : null;
    case 'delete':
      return subject.status === 'draft' || subject.testRun
        ? null
        : 'Only a draft or a test run can be deleted.';
    case 'finish':
      if (subject.status === 'finished') return 'This tournament is already finished.';
      return subject.started ? null : 'A tournament that has not started cannot be finished.';
    case 'reopen':
      return subject.status === 'finished' ? null : 'Only a finished tournament can be reopened.';
    case 'returnToDraft':
      if (subject.status === 'finished') return 'Reopen the tournament before sending it back to draft.';
      return subject.started ? null : 'This tournament has not started.';
    case 'start':
      return subject.started ? 'This tournament has already started.' : null;
  }
}

export const canPublish = (subject: LifecycleSubject) => transitionRefusal('publish', subject) === null;
export const canUnpublish = (subject: LifecycleSubject) => transitionRefusal('unpublish', subject) === null;
export const canDelete = (subject: LifecycleSubject) => transitionRefusal('delete', subject) === null;
export const canFinish = (subject: LifecycleSubject) => transitionRefusal('finish', subject) === null;
export const canReopen = (subject: LifecycleSubject) => transitionRefusal('reopen', subject) === null;
export const canReturnToDraft = (subject: LifecycleSubject) =>
  transitionRefusal('returnToDraft', subject) === null;
