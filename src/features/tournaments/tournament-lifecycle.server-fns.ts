import { createServerFn } from '@tanstack/react-start';
import { tournamentWinners } from '../../domain/tournament/rankings';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { claimFirebaseFlag, readFirebaseOnce } from '../sync/firebase-admin.server';
import {
  validateCreateInput,
  validateStartInput,
  validateTestRunInput,
  validateTransitionInput,
} from './tournament-lifecycle.shared';
import {
  applyPlan,
  isTestEnvironment,
  readStoredFacts,
  readStoredState,
  requestPaths,
  serverNow,
} from './tournament-store.server';
import {
  planCreate,
  planDelete,
  planFinish,
  planPublish,
  planReopen,
  planReturnToDraft,
  planSetTestRun,
  planStart,
  planUnpublish,
} from './tournament-updates';

export const createTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateCreateInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    const [started, lifecycle] = await Promise.all([
      readFirebaseOnce(`${paths.tournament}/started`),
      readFirebaseOnce(`${paths.tournament}/lifecycle`),
    ]);
    if (started !== null || lifecycle !== null) throw new Error('A tournament with this ID already exists.');
    // The test site only ever holds rehearsals.
    const testRun = isTestEnvironment() || data.testRun;
    await applyPlan(planCreate({ ...data, paths, testRun, now: serverNow() }));
  });

export const publishTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planPublish(paths, await readStoredFacts(paths)));
  });

export const unpublishTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planUnpublish(paths, await readStoredFacts(paths)));
  });

export const finishTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    // The winners are worked out here from the stored tournament, never taken from the client.
    const winners = tournamentWinners(await readStoredState(paths, data.tournamentId));
    await applyPlan(planFinish(paths, await readStoredFacts(paths), serverNow(), winners));
  });

export const reopenTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planReopen(paths, await readStoredFacts(paths)));
  });

export const returnTournamentToDraft = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planReturnToDraft(paths, await readStoredFacts(paths), data.patch));
  });

export const deleteTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateTransitionInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planDelete(paths, await readStoredFacts(paths)));
  });

export const setTournamentTestRun = createServerFn({ method: 'POST' })
  .inputValidator(validateTestRunInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await applyPlan(planSetTestRun(paths, await readStoredFacts(paths), data.testRun, isTestEnvironment()));
  });

/** Starts a tournament exactly once: the second of two simultaneous calls is refused. */
export const startTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateStartInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    const plan = planStart(paths, await readStoredFacts(paths), data.patch, serverNow());
    if (!plan.ok) throw new Error(plan.message);
    if (!(await claimFirebaseFlag(`${paths.tournament}/started`))) {
      throw new Error('This tournament has already started.');
    }
    await applyPlan(plan);
  });
