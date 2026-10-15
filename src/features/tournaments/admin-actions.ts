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

/** What a draft still lacks before it can be published, in the order the Setup form asks for it. */
export type PublishMissing = 'title' | 'date';

export function publishMissing(subject: LifecycleSubject): PublishMissing[] {
  const missing: PublishMissing[] = [];
  if (!subject.title.trim()) missing.push('title');
  if (subject.scheduledAt === null) missing.push('date');
  return missing;
}

/** The sentence under a draft's status when it cannot be published yet; null when nothing is missing. */
function publishHint(missing: PublishMissing[]): string | null {
  if (missing.length === 2) return 'To publish, give it a name and add a scheduled date and time.';
  if (missing[0] === 'title') return 'To publish, give it a name.';
  if (missing[0] === 'date') return 'To publish, add a scheduled date and time.';
  return null;
}

export interface StatusExplanation {
  /** What the status means for who sees the tournament and what comes next. */
  text: string;
  /** An orange follow-up, such as what a draft still lacks. */
  hint: string | null;
  /** The reminder to finish a tournament whose Final is complete, which replaces the text and reads in green. */
  reminder: boolean;
}

/**
 * The one line next to the status pill. `startedText` is the start as the admin reads it ("Sat 20 Sep, 20:00"; the
 * caller formats it, because that depends on the browser), null when unknown.
 */
export function statusExplanation(
  subject: LifecycleSubject,
  options: { finalComplete: boolean; startedText: string | null },
): StatusExplanation {
  if (subject.started && subject.status !== 'finished' && options.finalComplete) {
    return { text: FINISH_REMINDER, hint: null, reminder: true };
  }
  const explain = (text: string, hint: string | null = null): StatusExplanation => ({
    text,
    hint,
    reminder: false,
  });
  if (subject.status === 'draft') {
    return explain('Visible to admins only.', publishHint(publishMissing(subject)));
  }
  if (subject.status === 'finished') {
    return explain('Read-only for everyone. Reopen it to change scores or settings.');
  }
  if (subject.started) {
    const started = options.startedText ? `Started ${options.startedText}. ` : 'Started. ';
    return explain(`${started}Finish it once the Final is complete and its scores are checked.`);
  }
  return explain('On the Tournaments page. "Starting soon" from 1 hour before the scheduled time.');
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
