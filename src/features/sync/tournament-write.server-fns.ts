import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { writeTournamentToFirebase } from './firebase-admin.server';
import { validateWriteInput } from './tournament-write.shared';

export const writeTournament = createServerFn({ method: 'POST' })
  .inputValidator(validateWriteInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const hostname = new URL(getRequest().url).hostname;
    await writeTournamentToFirebase(data.tournamentId, data.payload, hostname);
  });
