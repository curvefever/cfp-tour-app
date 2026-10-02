import { createServerFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { readFirebaseOnce, updateFirebase } from '../sync/firebase-admin.server';
import { getArchiveRootPath } from '../sync/firebase-paths';
import { marshalForFirebase } from '../sync/live-sync';
import {
  buildArchiveDeleteUpdates,
  buildArchiveSaveUpdates,
  validateArchiveAnnotationsInput,
  validateArchiveDeleteInput,
  validateArchiveSaveInput,
} from './archive-write.shared';
import { buildSharedArchiveSummary, type SharedArchiveSummary } from './shared-archive';

function archiveRoot(): string {
  return getArchiveRootPath(new URL(getRequest().url).hostname);
}

export const saveArchiveEntry = createServerFn({ method: 'POST' })
  .inputValidator(validateArchiveSaveInput)
  .handler(async ({ data }): Promise<SharedArchiveSummary> => {
    await requireTourAdminPermission();
    const root = archiveRoot();
    const { tournamentId, snapshot } = data;
    const dateSaved = new Date().toISOString();
    await updateFirebase(buildArchiveSaveUpdates(root, tournamentId, snapshot, dateSaved));
    return buildSharedArchiveSummary(tournamentId, snapshot, dateSaved);
  });

export const deleteArchiveEntry = createServerFn({ method: 'POST' })
  .inputValidator(validateArchiveDeleteInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const root = archiveRoot();
    await updateFirebase(buildArchiveDeleteUpdates(root, data.tournamentId));
  });

export const setArchiveAnnotations = createServerFn({ method: 'POST' })
  .inputValidator(validateArchiveAnnotationsInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const root = archiveRoot();
    if ((await readFirebaseOnce(`${root}/index/${data.tournamentId}`)) === null) {
      throw new Error('This tournament is no longer in the archive.');
    }
    await updateFirebase({
      [`${root}/entries/${data.tournamentId}/annotations`]: marshalForFirebase(data.annotations),
    });
  });
