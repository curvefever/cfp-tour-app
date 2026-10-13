import { createServerFn } from '@tanstack/react-start';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { readFirebaseOnce, updateFirebase } from '../sync/firebase-admin.server';
import { requestPaths, serverNow } from '../tournaments/tournament-store.server';
import { presenceKey, presenceName, validatePresenceInput } from './presence.shared';

/**
 * Says which field of the tournament's Setup the signed-in admin is in (`null`: none any more), for the other
 * admins to see. Never touches the tournament or its Setup form.
 */
export const setSetupPresence = createServerFn({ method: 'POST' })
  .inputValidator(validatePresenceInput)
  .handler(async ({ data }): Promise<void> => {
    const admin = await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    const path = `${paths.presence}/${presenceKey(admin.userId)}`;
    if (data.field === null) {
      await updateFirebase({ [path]: null });
      return;
    }
    // Nothing is written under a tournament that does not exist, so a deleted one leaves nothing behind.
    if ((await readFirebaseOnce(`${paths.tournament}/lifecycle`)) === null) {
      throw new Error('This tournament does not exist.');
    }
    await updateFirebase({
      [path]: { name: presenceName(admin.username), field: data.field, at: serverNow() },
    });
  });
