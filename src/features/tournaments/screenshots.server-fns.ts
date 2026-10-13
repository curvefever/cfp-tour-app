import { createServerFn } from '@tanstack/react-start';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { readFirebaseOnce, transactFirebase, updateFirebase } from '../sync/firebase-admin.server';
import {
  MAX_SCREENSHOTS,
  screenshotIdsOf,
  validateCopyInput,
  validateImageInput,
  validateUploadInput,
  withScreenshotRemoved,
  withScreenshotsAdded,
} from './screenshots.shared';
import { readStoredFacts, requestPaths } from './tournament-store.server';
import type { TournamentPaths } from '../sync/firebase-paths';

const FULL_MESSAGE = `A tournament holds at most ${MAX_SCREENSHOTS} screenshots. Delete one first.`;

function newImageId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** Refuses a tournament that does not exist or is finished: the screenshots are part of what a finished tournament keeps. */
async function requireEditable(paths: TournamentPaths): Promise<void> {
  const facts = await readStoredFacts(paths);
  if (!facts.lifecycle) throw new Error('This tournament does not exist.');
  if (facts.lifecycle.status === 'finished') {
    throw new Error('This tournament is finished. Reopen it to change its screenshots.');
  }
}

/** Stores one shrunk screenshot and lists it on the tournament, never going over the limit even when two admins upload at once. */
export const uploadScreenshot = createServerFn({ method: 'POST' })
  .inputValidator(validateUploadInput)
  .handler(async ({ data }): Promise<{ imageId: string }> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await requireEditable(paths);
    const imageId = newImageId();
    await updateFirebase({ [`${paths.media}/${imageId}`]: data.dataUrl });
    const listed = await transactFirebase(`${paths.tournament}/info/screenshots`, (current) =>
      withScreenshotsAdded(current, [imageId]),
    );
    if (!listed) {
      await updateFirebase({ [`${paths.media}/${imageId}`]: null });
      throw new Error(FULL_MESSAGE);
    }
    return { imageId };
  });

export const deleteScreenshot = createServerFn({ method: 'POST' })
  .inputValidator(validateImageInput)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await requireEditable(paths);
    await transactFirebase(`${paths.tournament}/info/screenshots`, (current) =>
      withScreenshotRemoved(current, data.imageId),
    );
    await updateFirebase({ [`${paths.media}/${data.imageId}`]: null });
  });

/** Copies the screenshots of one tournament onto another, as far as the limit leaves room; resolves with how many. */
export const copyScreenshots = createServerFn({ method: 'POST' })
  .inputValidator(validateCopyInput)
  .handler(async ({ data }): Promise<{ copied: number }> => {
    await requireTourAdminPermission();
    const from = requestPaths(data.fromTournamentId);
    const to = requestPaths(data.toTournamentId);
    await requireEditable(to);
    const sourceIds = screenshotIdsOf(await readFirebaseOnce(`${from.tournament}/info/screenshots`));
    const room =
      MAX_SCREENSHOTS - screenshotIdsOf(await readFirebaseOnce(`${to.tournament}/info/screenshots`)).length;
    const copies: { id: string; image: unknown }[] = [];
    for (const sourceId of sourceIds.slice(0, Math.max(room, 0))) {
      const image = await readFirebaseOnce(`${from.media}/${sourceId}`);
      if (typeof image === 'string') copies.push({ id: newImageId(), image });
    }
    if (!copies.length) return { copied: 0 };
    await updateFirebase(Object.fromEntries(copies.map(({ id, image }) => [`${to.media}/${id}`, image])));
    const listed = await transactFirebase(`${to.tournament}/info/screenshots`, (current) =>
      withScreenshotsAdded(
        current,
        copies.map(({ id }) => id),
      ),
    );
    if (!listed) {
      await updateFirebase(Object.fromEntries(copies.map(({ id }) => [`${to.media}/${id}`, null])));
      throw new Error(FULL_MESSAGE);
    }
    return { copied: copies.length };
  });
