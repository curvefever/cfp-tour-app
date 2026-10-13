import { describe, expect, it } from 'vitest';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import { setFinalScore } from '../../domain/tournament/mutations';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import type { TournamentState } from '../../domain/tournament/types';
import { adminActions, finishReminderFor, stateSubject } from './admin-actions';
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
