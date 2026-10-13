import { computeRankings } from '../../domain/tournament/rankings';
import type { TournamentState } from '../../domain/tournament/types';
import { transitionRefusal, type LifecycleSubject } from './tournament-lifecycle';

export const FINISH_REMINDER = 'Final complete — check the last scores, then Finish tournament.';

export type StatusButton = 'publish' | 'unpublish' | 'finish' | 'reopen' | 'delete';

export interface AdminStatusAction {
  action: StatusButton;
  /** Why the action cannot be done right now, to show next to the button; null when it can. */
  refusal: string | null;
}

export interface AdminActions {
  /** The status buttons to show, in order. */
  actions: AdminStatusAction[];
  /** True once the Final is complete and the tournament still has to be finished. */
  finishReminder: boolean;
}

/**
 * What the Admin tab offers for a tournament's status: each button the status calls for (Publish is always
 * shown for a draft, with the reason when it is not yet possible), and whether to remind the admin to finish.
 */
export function adminActions(subject: LifecycleSubject, finalComplete: boolean): AdminActions {
  const refusal = (action: StatusButton) => transitionRefusal(action, subject);
  const actions: AdminStatusAction[] = [];
  if (subject.status === 'draft') actions.push({ action: 'publish', refusal: refusal('publish') });
  if (refusal('unpublish') === null) actions.push({ action: 'unpublish', refusal: null });
  if (refusal('finish') === null) actions.push({ action: 'finish', refusal: null });
  if (refusal('reopen') === null) actions.push({ action: 'reopen', refusal: null });
  if (refusal('delete') === null) actions.push({ action: 'delete', refusal: null });
  return {
    actions,
    finishReminder: finalComplete && subject.started && subject.status !== 'finished',
  };
}

/** The fields of the loaded tournament that decide what it may do next; null for one stored before statuses existed. */
export function stateSubject(state: TournamentState): LifecycleSubject | null {
  if (!state.lifecycle) return null;
  return {
    status: state.lifecycle.status,
    started: state.started,
    testRun: state.lifecycle.testRun,
    title: state.title,
    scheduledAt: state.info?.scheduledAt ?? null,
  };
}

/** Whether an admin should be reminded to finish: the Final is complete and the tournament is not finished. */
export function finishReminderFor(state: TournamentState): boolean {
  const subject = stateSubject(state);
  if (!subject) return false;
  return adminActions(subject, computeRankings(state)?.finalComplete ?? false).finishReminder;
}
