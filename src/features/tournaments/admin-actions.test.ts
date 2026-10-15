import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { setFinalScore } from '../../domain/tournament/mutations';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import type { TournamentState } from '../../domain/tournament/types';
import {
  adminActions,
  FINISH_REMINDER,
  finishReminderFor,
  publishMissing,
  stateSubject,
  statusExplanation,
} from './admin-actions';
import type { LifecycleSubject } from './tournament-lifecycle';

const draft: LifecycleSubject = {
  status: 'draft',
  started: false,
  testRun: false,
  title: 'Autumn Cup',
  scheduledAt: 1_790_000_000_000,
};
const upcoming: LifecycleSubject = { ...draft, status: 'published' };
const ongoing: LifecycleSubject = { ...upcoming, started: true };
const finished: LifecycleSubject = { ...ongoing, status: 'finished' };

const names = (subject: LifecycleSubject, finalComplete = false) =>
  adminActions(subject, finalComplete).actions.map((entry) => entry.action);

describe('adminActions', () => {
  it('offers Publish and Delete for a draft', () => {
    expect(names(draft)).toEqual(['publish', 'delete']);
    expect(adminActions(draft, false).actions[0].refusal).toBeNull();
  });

  it('keeps Publish for a draft that cannot be published yet, with the reason', () => {
    const untitled = adminActions({ ...draft, title: '' }, false).actions[0];
    expect(untitled).toMatchObject({ action: 'publish' });
    expect(untitled.refusal).toMatch(/title/);
    const undated = adminActions({ ...draft, scheduledAt: null }, false).actions[0];
    expect(undated.refusal).toMatch(/date and time/);
  });

  it('offers Unpublish for a published tournament that has not started, and no Delete', () => {
    expect(names(upcoming)).toEqual(['unpublish']);
  });

  it('offers Finish for an ongoing tournament, and Delete only for a test run', () => {
    expect(names(ongoing)).toEqual(['finish']);
    expect(names({ ...ongoing, testRun: true })).toEqual(['finish', 'delete']);
  });

  it('offers Reopen for a finished tournament, and Delete only for a test run', () => {
    expect(names(finished)).toEqual(['reopen']);
    expect(names({ ...finished, testRun: true })).toEqual(['reopen', 'delete']);
  });

  it('offers Unpublish and Delete for a published test run that has not started', () => {
    expect(names({ ...upcoming, testRun: true })).toEqual(['unpublish', 'delete']);
  });

  it('reminds to finish once the Final is complete and the tournament is ongoing', () => {
    expect(adminActions(ongoing, true).finishReminder).toBe(true);
    expect(adminActions(ongoing, false).finishReminder).toBe(false);
  });

  it('does not remind a finished, unstarted or draft tournament', () => {
    expect(adminActions(finished, true).finishReminder).toBe(false);
    expect(adminActions(upcoming, true).finishReminder).toBe(false);
    expect(adminActions(draft, true).finishReminder).toBe(false);
  });
});

describe('finishReminderFor a played 37-player tournament', () => {
  function atTheFinal(): TournamentState {
    let state = buildState({
      label: 'ffa 37',
      count: 37,
      teams: false,
      setup: { gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination', poolingPhase: 'none' },
    })!;
    state = { ...state, lifecycle: { status: 'published', testRun: true, createdAt: 1, finishedAt: null } };
    while (!state.rounds[state.curRound].isFinal) {
      const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
      if (advanced.status !== 'advanced') throw new Error('could not reach the Final');
      state = advanced.state;
    }
    return state;
  }

  it('is false while the Final is unscored, and true once every Final score is in', () => {
    let state = atTheFinal();
    expect(finishReminderFor(state)).toBe(false);
    const games = state.rounds[state.curRound].numGames ?? 1;
    for (const { name } of state.assignments[state.curRound]) {
      for (let game = 1; game <= games; game += 1)
        state = setFinalScore(state, `game${game}-${name}`, 10 + game);
    }
    expect(finishReminderFor(state)).toBe(true);
  });

  it('is false once the tournament is finished', () => {
    let state = atTheFinal();
    const games = state.rounds[state.curRound].numGames ?? 1;
    for (const { name } of state.assignments[state.curRound]) {
      for (let game = 1; game <= games; game += 1)
        state = setFinalScore(state, `game${game}-${name}`, 10 + game);
    }
    const finished = { ...state, lifecycle: { ...state.lifecycle!, status: 'finished' as const } };
    expect(finishReminderFor(finished)).toBe(false);
  });

  it('is false for a tournament stored before statuses existed', () => {
    const { lifecycle: _lifecycle, ...legacy } = atTheFinal();
    expect(stateSubject(legacy)).toBeNull();
    expect(finishReminderFor(legacy)).toBe(false);
  });
});

describe('statusExplanation', () => {
  const explain = (subject: LifecycleSubject, finalComplete = false, startedText: string | null = null) =>
    statusExplanation(subject, { finalComplete, startedText });

  it('says a draft is visible to admins only, and what it still lacks to be published', () => {
    expect(explain(draft)).toEqual({ text: 'Visible to admins only.', hint: null, reminder: false });
    expect(explain({ ...draft, scheduledAt: null }).hint).toBe('To publish, add a scheduled date and time.');
    expect(explain({ ...draft, title: ' ' }).hint).toBe('To publish, give it a name.');
    expect(explain({ ...draft, title: '', scheduledAt: null }).hint).toBe(
      'To publish, give it a name and add a scheduled date and time.',
    );
  });

  it('says where a published tournament shows and when it is starting soon', () => {
    expect(explain(upcoming).text).toBe(
      'On the Tournaments page. "Starting soon" from 1 hour before the scheduled time.',
    );
  });

  it('says when an ongoing tournament started, and to finish it once the Final is checked', () => {
    expect(explain(ongoing, false, 'Sat 20 Sep, 20:00').text).toBe(
      'Started Sat 20 Sep, 20:00. Finish it once the Final is complete and its scores are checked.',
    );
    expect(explain(ongoing).text).toMatch(/^Started\. Finish it/);
  });

  it('replaces that with the reminder once the Final is complete, never for a finished tournament', () => {
    expect(explain(ongoing, true)).toEqual({ text: FINISH_REMINDER, hint: null, reminder: true });
    expect(explain(finished, true).reminder).toBe(false);
    expect(explain(upcoming, true).reminder).toBe(false);
  });

  it('says a finished tournament is read-only and can be reopened', () => {
    expect(explain(finished).text).toMatch(/Read-only.*Reopen/);
  });
});

describe('publishMissing', () => {
  it('lists what a draft lacks, name first', () => {
    expect(publishMissing(draft)).toEqual([]);
    expect(publishMissing({ ...draft, scheduledAt: null })).toEqual(['date']);
    expect(publishMissing({ ...draft, title: '', scheduledAt: null })).toEqual(['title', 'date']);
  });
});
