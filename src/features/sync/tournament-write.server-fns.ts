import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { applyPlan, requestPaths } from '../tournaments/tournament-store.server';
import {
  parseLifecycle,
  planPatchWrite,
  planSetupWrite,
  wholeWriteRefusal,
} from '../tournaments/tournament-updates';
import { readFirebaseOnce, writeTournamentToFirebase } from './firebase-admin.server';
import { unmarshalFromFirebase } from './firebase-marshal';
import { validatePatchInput, validateSetupPatchInput, validateWriteInput } from './tournament-write.shared';

export const writeTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateWriteInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    const refusal = wholeWriteRefusal(await readFirebaseOnce(`${paths.tournament}/lifecycle`));
    if (refusal) throw new Error(refusal);
    const hostname = new URL(getRequest().url).hostname;
    await writeTournamentToFirebase(data.tournamentId, data.payload, hostname);
  });

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
    await applyPlan(planSetupWrite(requestPaths(data.tournamentId), data.patch));
  });
