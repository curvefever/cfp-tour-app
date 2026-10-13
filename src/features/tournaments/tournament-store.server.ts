import { getRequest } from '@tanstack/react-start/server';
import { ServerValue } from 'firebase-admin/database';
import { readFirebaseOnce, updateFirebase } from '../sync/firebase-admin.server';
import { unmarshalFromFirebase } from '../sync/firebase-marshal';
import { getTourEnvironment, getTournamentPaths, type TournamentPaths } from '../sync/firebase-paths';
import { parseLifecycle, type StoredFacts, type UpdatePlan } from './tournament-updates';

/** The host the request came to, which decides test or production. */
function requestHostname(): string {
  return new URL(getRequest().url).hostname;
}

export function requestPaths(tournamentId: string): TournamentPaths {
  return getTournamentPaths(tournamentId, requestHostname());
}

export function isTestEnvironment(): boolean {
  return getTourEnvironment(requestHostname()) === 'test';
}

/** The database's own clock, resolved when the update is applied. */
export function serverNow(): number {
  return ServerValue.TIMESTAMP as unknown as number;
}

async function readDecoded(path: string): Promise<unknown> {
  return unmarshalFromFirebase(await readFirebaseOnce(path));
}

/** The few small fields a status change depends on, read without the rest of the tournament. */
export async function readStoredFacts(paths: TournamentPaths): Promise<StoredFacts> {
  const [lifecycle, started, title, scheduledAt] = await Promise.all([
    readDecoded(`${paths.tournament}/lifecycle`),
    readDecoded(`${paths.tournament}/started`),
    readDecoded(`${paths.tournament}/title`),
    readDecoded(`${paths.tournament}/info/scheduledAt`),
  ]);
  return {
    lifecycle: parseLifecycle(lifecycle),
    started: started === true,
    title: typeof title === 'string' ? title : '',
    scheduledAt: typeof scheduledAt === 'number' ? scheduledAt : null,
  };
}

/** Applies a plan in one atomic update, or throws the plan's refusal message. */
export async function applyPlan(plan: UpdatePlan): Promise<void> {
  if (!plan.ok) throw new Error(plan.message);
  if (Object.keys(plan.updates).length) await updateFirebase(plan.updates);
}
