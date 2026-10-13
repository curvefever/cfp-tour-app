import { createDefaultInfo, createDefaultLifecycle } from '../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentLifecycle, TournamentState } from '../../domain/tournament/types';
import type { TournamentPaths } from '../sync/firebase-paths';
import { marshalForFirebase } from '../sync/firebase-marshal';
import { transitionRefusal, type LifecycleSubject, type TournamentAction } from './tournament-lifecycle';
import {
  buildTournamentSummary,
  type TournamentDescription,
  type TournamentSummary,
} from './tournament-summary';

/**
 * The database updates that carry each lifecycle change out, as plain data: the server functions read the
 * little they need, ask for a plan, and apply it as one atomic multi-path update. Nothing here touches Firebase.
 * `now` is the time to record: a number here, the database's own timestamp placeholder when the server applies it.
 */

/** What the server reads before it changes a tournament's status. */
export interface StoredFacts {
  lifecycle: TournamentLifecycle | null;
  started: boolean;
  title: string;
  scheduledAt: number | null;
}

export type UpdatePlan = { ok: true; updates: Record<string, unknown> } | { ok: false; message: string };

const NO_LIFECYCLE = 'This tournament has no status: it was created before statuses existed.';

function refuse(message: string): UpdatePlan {
  return { ok: false, message };
}

function parseStatus(value: unknown): TournamentLifecycle['status'] | null {
  return value === 'draft' || value === 'published' || value === 'finished' ? value : null;
}

/** Reads the stored lifecycle defensively; `null` when it is missing or malformed. */
export function parseLifecycle(value: unknown): TournamentLifecycle | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const status = parseStatus(record.status);
  if (!status) return null;
  return createDefaultLifecycle({
    status,
    testRun: record.testRun === true,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    finishedAt: typeof record.finishedAt === 'number' ? record.finishedAt : null,
  });
}

export function toSubject(facts: StoredFacts): LifecycleSubject | null {
  if (!facts.lifecycle) return null;
  return {
    status: facts.lifecycle.status,
    testRun: facts.lifecycle.testRun,
    started: facts.started,
    title: facts.title,
    scheduledAt: facts.scheduledAt,
  };
}

function checked(action: TournamentAction, facts: StoredFacts): LifecycleSubject | string {
  const subject = toSubject(facts);
  if (!subject) return NO_LIFECYCLE;
  return transitionRefusal(action, subject) ?? subject;
}

function put(updates: Record<string, unknown>, path: string, value: unknown): void {
  updates[path] = marshalForFirebase(value);
}

/** Writes lifecycle fields and the same fields on the list entry. */
function putStatusFields(
  updates: Record<string, unknown>,
  paths: TournamentPaths,
  fields: Partial<Pick<TournamentLifecycle, 'status' | 'testRun' | 'finishedAt'>>,
): void {
  for (const [key, value] of Object.entries(fields)) {
    put(updates, `${paths.tournament}/lifecycle/${key}`, value);
    put(updates, `${paths.index}/${key}`, value);
  }
}

/** A client's patch, already marshalled by the sender, written under the tournament. */
function putPatch(
  updates: Record<string, unknown>,
  paths: TournamentPaths,
  patch: Record<string, unknown> | undefined,
): void {
  for (const [path, value] of Object.entries(patch ?? {})) updates[`${paths.tournament}/${path}`] = value;
}

export function planCreate(options: {
  paths: TournamentPaths;
  tournamentId: string;
  state: TournamentState;
  setup: PersistedSetup;
  testRun: boolean;
  now: number;
}): UpdatePlan {
  const { paths, tournamentId, state, setup, testRun, now } = options;
  const lifecycle = createDefaultLifecycle({ testRun, createdAt: now });
  const stored: TournamentState = {
    ...state,
    tournamentId,
    started: false,
    lifecycle,
    info: state.info ?? createDefaultInfo(),
    annotations: state.annotations ?? [],
  };
  const summary: TournamentSummary = {
    id: tournamentId,
    status: 'draft',
    started: false,
    testRun,
    createdAt: now,
    finishedAt: null,
    ...buildTournamentSummary(stored, setup),
  };
  const updates: Record<string, unknown> = {};
  put(updates, paths.tournament, stored);
  put(updates, paths.setup, setup);
  put(updates, paths.index, summary);
  return { ok: true, updates };
}

export function planPublish(paths: TournamentPaths, facts: StoredFacts): UpdatePlan {
  const subject = checked('publish', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  putStatusFields(updates, paths, { status: 'published' });
  return { ok: true, updates };
}

export function planUnpublish(paths: TournamentPaths, facts: StoredFacts): UpdatePlan {
  const subject = checked('unpublish', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  putStatusFields(updates, paths, { status: 'draft' });
  return { ok: true, updates };
}

export function planFinish(paths: TournamentPaths, facts: StoredFacts, now: number): UpdatePlan {
  const subject = checked('finish', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  putStatusFields(updates, paths, { status: 'finished', finishedAt: now });
  return { ok: true, updates };
}

export function planReopen(paths: TournamentPaths, facts: StoredFacts): UpdatePlan {
  const subject = checked('reopen', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  putStatusFields(updates, paths, { status: 'published', finishedAt: null });
  return { ok: true, updates };
}

/** Back to draft: not started any more, the played rounds cleared by `patch` in the same update. */
export function planReturnToDraft(
  paths: TournamentPaths,
  facts: StoredFacts,
  patch: Record<string, unknown> | undefined,
): UpdatePlan {
  const subject = checked('returnToDraft', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  putStatusFields(updates, paths, { status: 'draft' });
  put(updates, `${paths.tournament}/started`, false);
  put(updates, `${paths.index}/started`, false);
  putPatch(updates, paths, patch);
  return { ok: true, updates };
}

export function planDelete(paths: TournamentPaths, facts: StoredFacts): UpdatePlan {
  const subject = checked('delete', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  for (const path of Object.values(paths)) updates[path] = null;
  return { ok: true, updates };
}

/** Only a draft can change its test-run mark, and the test environment keeps every tournament a test run. */
export function planSetTestRun(
  paths: TournamentPaths,
  facts: StoredFacts,
  testRun: boolean,
  isTestEnvironment: boolean,
): UpdatePlan {
  if (!facts.lifecycle) return refuse(NO_LIFECYCLE);
  if (facts.lifecycle.status !== 'draft') return refuse('Only a draft can be marked as a test run.');
  const updates: Record<string, unknown> = {};
  if (!isTestEnvironment) putStatusFields(updates, paths, { testRun });
  return { ok: true, updates };
}

/**
 * What follows the server's claim of `started` (false → true): the generated rounds, and for a draft its
 * publication, with the scheduled time filled in when empty.
 */
export function planStart(
  paths: TournamentPaths,
  facts: StoredFacts,
  patch: Record<string, unknown>,
  now: number,
): UpdatePlan {
  const subject = checked('start', facts);
  if (typeof subject === 'string') return refuse(subject);
  const updates: Record<string, unknown> = {};
  put(updates, `${paths.index}/started`, true);
  if (subject.status === 'draft') putStatusFields(updates, paths, { status: 'published' });
  if (facts.scheduledAt === null) {
    put(updates, `${paths.tournament}/info/scheduledAt`, now);
    put(updates, `${paths.index}/scheduledAt`, now);
  }
  putPatch(updates, paths, patch);
  return { ok: true, updates };
}

/** A client patch, with the list entry's changed descriptive fields; a finished tournament only takes annotations. */
export function planPatchWrite(
  paths: TournamentPaths,
  status: TournamentLifecycle['status'] | null,
  patch: Record<string, unknown>,
  summary: Partial<TournamentDescription> | undefined,
): UpdatePlan {
  if (status === 'finished' && !Object.keys(patch).every((path) => path.split('/')[0] === 'annotations')) {
    return refuse('This tournament is finished. Reopen it to change it.');
  }
  const updates: Record<string, unknown> = {};
  putPatch(updates, paths, patch);
  // A tournament stored before statuses existed has no list entry to keep up to date.
  if (status)
    for (const [key, value] of Object.entries(summary ?? {})) put(updates, `${paths.index}/${key}`, value);
  return { ok: true, updates };
}

/** The setup form's changed fields, written as they are. */
export function planSetupWrite(paths: TournamentPaths, patch: Record<string, string>): UpdatePlan {
  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) updates[`${paths.setup}/${key}`] = value;
  return { ok: true, updates };
}
