import { createServerFn } from '@tanstack/react-start';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { applyPlan, requestPaths } from '../tournaments/tournament-store.server';
import { parseLifecycle, planPatchWrite, planSetupWrite } from '../tournaments/tournament-updates';
import { readFirebaseOnce } from './firebase-admin.server';
import { unmarshalFromFirebase } from './firebase-marshal';
import { validatePatchInput, validateSetupPatchInput } from './tournament-write.shared';

export const writeTournamentPatch = createServerFn({ method: 'POST' })
  .inputValidator(validatePatchInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    const stored = unmarshalFromFirebase(await readFirebaseOnce(`${paths.tournament}/lifecycle`));
    const status = parseLifecycle(stored)?.status ?? null;
    await applyPlan(planPatchWrite(paths, status, data.patch, data.summary));
  });

export const writeSetupPatch = createServerFn({ method: 'POST' })
  .inputValidator(validateSetupPatchInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    await applyPlan(planSetupWrite(requestPaths(data.tournamentId), data.patch, data.summary));
  });
