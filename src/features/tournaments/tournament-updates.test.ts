import { describe, expect, it } from 'vitest';
import {
  createDefaultInfo,
  createDefaultSetup,
  createDefaultTournamentState,
} from '../../domain/tournament/state-defaults';
import { getTournamentPaths } from '../sync/firebase-paths';
import { marshalForFirebase } from '../sync/firebase-marshal';
import {
  parseLifecycle,
  planCreate,
  planDelete,
  planFinish,
  planPatchWrite,
  planPublish,
  planReopen,
  planReturnToDraft,
  planSetTestRun,
  planSetupWrite,
  planStart,
  planUnpublish,
  type StoredFacts,
  type UpdatePlan,
  wholeWriteRefusal,
} from './tournament-updates';

const paths = getTournamentPaths('t1', 'tournaments-test.curvefever.pro');
const NOW = 1_790_000_000_000;
const SCHEDULED = 1_790_100_000_000;

const lifecycle = (status: 'draft' | 'published' | 'finished', testRun = false) => ({
  status,
  testRun,
  createdAt: 1,
  finishedAt: status === 'finished' ? 2 : null,
});

const facts = (overrides: Partial<StoredFacts> = {}): StoredFacts => ({
  lifecycle: lifecycle('draft'),
  started: false,
  title: 'Autumn Cup',
  scheduledAt: SCHEDULED,
  ...overrides,
});

function updatesOf(plan: UpdatePlan): Record<string, unknown> {
  if (!plan.ok) throw new Error(`refused: ${plan.message}`);
  return plan.updates;
}

function messageOf(plan: UpdatePlan): string {
  if (plan.ok) throw new Error('expected a refusal');
  return plan.message;
}

describe('paths', () => {
  it('puts every root of the test environment under environments/test', () => {
    expect(paths).toEqual({
      tournament: 'environments/test/tournaments/t1',
      index: 'environments/test/index/t1',
      setup: 'environments/test/setups/t1',
      presence: 'environments/test/presence/t1',
      media: 'environments/test/media/t1',
    });
    expect(getTournamentPaths('t1', 'tournaments.curvefever.pro').index).toBe('environments/prod/index/t1');
  });
});

describe('parseLifecycle', () => {
  it('reads a stored lifecycle and defaults what is missing', () => {
    expect(parseLifecycle({ status: 'published', testRun: true, createdAt: 5 })).toEqual({
      status: 'published',
      testRun: true,
      createdAt: 5,
      finishedAt: null,
    });
  });

  it('is null for nothing or for an unknown status', () => {
    expect(parseLifecycle(null)).toBeNull();
    expect(parseLifecycle({ status: 'archived' })).toBeNull();
  });
});

describe('planCreate', () => {
  const state = createDefaultTournamentState({
    title: 'Autumn Cup',
    players: Array.from({ length: 37 }, (_, index) => `P${index + 1}`),
    started: true,
    tournamentId: 'wrong',
  });
  const setup = createDefaultSetup({ gameFormat: 'individual-1v1' });

  it('writes the state as a draft, the setup and the list entry in one update', () => {
    const updates = updatesOf(
      planCreate({ paths, tournamentId: 't1', state, setup, testRun: true, now: NOW }),
    );
    expect(Object.keys(updates)).toEqual([paths.tournament, paths.setup, paths.index]);
    const stored = updates[paths.tournament] as Record<string, unknown>;
    expect(stored.tournamentId).toBe('t1');
    expect(stored.started).toBe(false);
    expect(stored.lifecycle).toEqual({
      status: 'draft',
      testRun: true,
      createdAt: NOW,
      finishedAt: marshalForFirebase(null),
    });
    expect(stored.info).toEqual(marshalForFirebase(createDefaultInfo()));
    expect(stored.annotations).toEqual(marshalForFirebase([]));
    expect(updates[paths.setup]).toEqual(setup);
  });

  it('describes the tournament in its list entry', () => {
    const updates = updatesOf(
      planCreate({ paths, tournamentId: 't1', state, setup, testRun: false, now: NOW }),
    );
    expect(updates[paths.index]).toMatchObject({
      id: 't1',
      title: 'Autumn Cup',
      status: 'draft',
      started: false,
      testRun: false,
      createdAt: NOW,
      gameFormat: 'individual-1v1',
      unitCount: 37,
    });
  });

  it('keeps an info block it was given', () => {
    const withInfo = { ...state, info: createDefaultInfo({ scheduledAt: SCHEDULED, rulesText: 'No pause' }) };
    const updates = updatesOf(
      planCreate({ paths, tournamentId: 't1', state: withInfo, setup, testRun: false, now: NOW }),
    );
    expect((updates[paths.tournament] as { info: unknown }).info).toMatchObject({
      scheduledAt: SCHEDULED,
      rulesText: 'No pause',
    });
    expect((updates[paths.index] as { scheduledAt: unknown }).scheduledAt).toBe(SCHEDULED);
  });
});

describe('publish and unpublish', () => {
  it('publishes a draft in the lifecycle and the list entry', () => {
    expect(updatesOf(planPublish(paths, facts()))).toEqual({
      [`${paths.tournament}/lifecycle/status`]: 'published',
      [`${paths.index}/status`]: 'published',
    });
  });

  it('refuses to publish without a date or a title', () => {
    expect(messageOf(planPublish(paths, facts({ scheduledAt: null })))).toMatch(/date and time/);
    expect(messageOf(planPublish(paths, facts({ title: '' })))).toMatch(/title/);
  });

  it('refuses a tournament stored before statuses existed', () => {
    expect(messageOf(planPublish(paths, facts({ lifecycle: null })))).toMatch(/before statuses existed/);
  });

  it('unpublishes only before it starts', () => {
    const published = facts({ lifecycle: lifecycle('published') });
    expect(updatesOf(planUnpublish(paths, published))[`${paths.index}/status`]).toBe('draft');
    expect(messageOf(planUnpublish(paths, { ...published, started: true }))).toMatch(/started/);
  });
});

describe('finish and reopen', () => {
  const ongoing = facts({ lifecycle: lifecycle('published'), started: true });

  it('stamps the finish time on the lifecycle and the list entry', () => {
    expect(updatesOf(planFinish(paths, ongoing, NOW))).toEqual({
      [`${paths.tournament}/lifecycle/status`]: 'finished',
      [`${paths.index}/status`]: 'finished',
      [`${paths.tournament}/lifecycle/finishedAt`]: NOW,
      [`${paths.index}/finishedAt`]: NOW,
    });
  });

  it('refuses to finish a draft or a finished tournament', () => {
    expect(messageOf(planFinish(paths, facts(), NOW))).toMatch(/not started/);
    expect(messageOf(planFinish(paths, { ...ongoing, lifecycle: lifecycle('finished') }, NOW))).toMatch(
      /already finished/,
    );
  });

  it('reopens a finished tournament and clears the finish time', () => {
    const updates = updatesOf(planReopen(paths, { ...ongoing, lifecycle: lifecycle('finished') }));
    expect(updates[`${paths.tournament}/lifecycle/status`]).toBe('published');
    expect(updates[`${paths.tournament}/lifecycle/finishedAt`]).toEqual(marshalForFirebase(null));
    expect(messageOf(planReopen(paths, ongoing))).toMatch(/finished/);
  });
});

describe('planReturnToDraft', () => {
  const ongoing = facts({ lifecycle: lifecycle('published'), started: true });

  it('clears started and applies the patch in the same update', () => {
    const patch = { rounds: marshalForFirebase([]), 'assignments/0': ['x'] };
    const updates = updatesOf(planReturnToDraft(paths, ongoing, patch));
    expect(updates[`${paths.tournament}/started`]).toBe(false);
    expect(updates[`${paths.index}/started`]).toBe(false);
    expect(updates[`${paths.index}/status`]).toBe('draft');
    expect(updates[`${paths.tournament}/rounds`]).toEqual(patch.rounds);
    expect(updates[`${paths.tournament}/assignments/0`]).toEqual(['x']);
  });

  it('refuses a draft, an unstarted tournament and a finished one', () => {
    expect(messageOf(planReturnToDraft(paths, facts(), undefined))).toMatch(/not started/);
    expect(
      messageOf(planReturnToDraft(paths, { ...ongoing, lifecycle: lifecycle('finished') }, undefined)),
    ).toMatch(/Reopen/);
  });
});

describe('planDelete', () => {
  it('removes all five roots of a draft', () => {
    const updates = updatesOf(planDelete(paths, facts()));
    expect(updates).toEqual(Object.fromEntries(Object.values(paths).map((path) => [path, null])));
  });

  it('refuses a started real tournament but deletes a started test run', () => {
    const ongoing = facts({ lifecycle: lifecycle('published'), started: true });
    expect(messageOf(planDelete(paths, ongoing))).toMatch(/draft or a test run/);
    const rehearsal = { ...ongoing, lifecycle: lifecycle('published', true) };
    expect(planDelete(paths, rehearsal).ok).toBe(true);
  });
});

describe('planSetTestRun', () => {
  it('marks a draft on production, in the lifecycle and the list entry', () => {
    expect(updatesOf(planSetTestRun(paths, facts(), true, false))).toEqual({
      [`${paths.tournament}/lifecycle/testRun`]: true,
      [`${paths.index}/testRun`]: true,
    });
  });

  it('changes nothing on the test environment', () => {
    expect(updatesOf(planSetTestRun(paths, facts(), false, true))).toEqual({});
  });

  it('refuses a tournament that is no longer a draft', () => {
    expect(
      messageOf(planSetTestRun(paths, facts({ lifecycle: lifecycle('published') }), true, false)),
    ).toMatch(/draft/);
  });
});

describe('planStart', () => {
  const generated = { rounds: [{ roundNum: 1 }], curRound: 0 };

  it('publishes a draft, fills an empty date with now and writes the generated rounds', () => {
    const updates = updatesOf(planStart(paths, facts({ scheduledAt: null }), generated, NOW));
    expect(updates[`${paths.index}/started`]).toBe(true);
    expect(updates[`${paths.index}/status`]).toBe('published');
    expect(updates[`${paths.tournament}/lifecycle/status`]).toBe('published');
    expect(updates[`${paths.tournament}/info/scheduledAt`]).toBe(NOW);
    expect(updates[`${paths.index}/scheduledAt`]).toBe(NOW);
    expect(updates[`${paths.tournament}/rounds`]).toEqual(generated.rounds);
    expect(updates[`${paths.tournament}/curRound`]).toBe(0);
  });

  it('keeps the date and the status of a published tournament', () => {
    const updates = updatesOf(planStart(paths, facts({ lifecycle: lifecycle('published') }), generated, NOW));
    expect(updates[`${paths.index}/status`]).toBeUndefined();
    expect(updates[`${paths.tournament}/info/scheduledAt`]).toBeUndefined();
  });

  it('refuses to start a draft without a title', () => {
    expect(messageOf(planStart(paths, facts({ title: '' }), generated, NOW))).toBe(
      'Give the tournament a title before starting it.',
    );
  });

  it('refuses a second start', () => {
    const started = facts({ lifecycle: lifecycle('published'), started: true });
    expect(messageOf(planStart(paths, started, generated, NOW))).toBe('This tournament has already started.');
  });
});

describe('wholeWriteRefusal', () => {
  it('refuses a whole write onto a tournament that has a lifecycle', () => {
    expect(wholeWriteRefusal({ status: 'draft', testRun: false, createdAt: 1, finishedAt: null })).toMatch(
      /already has a status/,
    );
  });

  it('allows one where there is no lifecycle (nothing stored, or stored before statuses existed)', () => {
    expect(wholeWriteRefusal(null)).toBeNull();
    expect(wholeWriteRefusal(undefined)).toBeNull();
  });
});

describe('planPatchWrite', () => {
  const patch = { 'scores/r0-rm1-p0': 5, curRound: 1 };

  it('writes the patch under the tournament and the summary fields under its list entry', () => {
    const updates = updatesOf(
      planPatchWrite(paths, 'published', patch, { title: 'New title', scheduledAt: null }),
    );
    expect(updates).toEqual({
      [`${paths.tournament}/scores/r0-rm1-p0`]: 5,
      [`${paths.tournament}/curRound`]: 1,
      [`${paths.index}/title`]: 'New title',
      [`${paths.index}/scheduledAt`]: marshalForFirebase(null),
    });
  });

  it('refuses everything but annotations on a finished tournament', () => {
    expect(messageOf(planPatchWrite(paths, 'finished', patch, undefined))).toMatch(/finished/);
    expect(messageOf(planPatchWrite(paths, 'finished', { annotations: [], curRound: 2 }, undefined))).toMatch(
      /finished/,
    );
    const notes = { 'annotations/2': { text: 'Rematch', timestamp: 'now' } };
    expect(planPatchWrite(paths, 'finished', notes, undefined).ok).toBe(true);
  });

  it('leaves the list alone for a tournament stored before statuses existed', () => {
    const updates = updatesOf(planPatchWrite(paths, null, patch, { title: 'Old' }));
    expect(Object.keys(updates).some((path) => path.startsWith(paths.index))).toBe(false);
  });
});

describe('planSetupWrite with a summary', () => {
  it('also writes the changed list fields', () => {
    expect(updatesOf(planSetupWrite(paths, { poolingPhase: 'swiss' }, { poolingPhase: 'swiss' }))).toEqual({
      [`${paths.setup}/poolingPhase`]: 'swiss',
      [`${paths.index}/poolingPhase`]: 'swiss',
    });
  });
});

describe('planSetupWrite', () => {
  it('writes each field under the tournament setup', () => {
    expect(updatesOf(planSetupWrite(paths, { qualAdv: '16', roster: 'A\nB' }))).toEqual({
      [`${paths.setup}/qualAdv`]: '16',
      [`${paths.setup}/roster`]: 'A\nB',
    });
  });
});
