import { createServerFn } from '@tanstack/react-start';
import { requireTourAdminPermission } from '../auth/server/tour-permissions.server';
import { readFirebaseOnce, transactFirebase, updateFirebase } from '../sync/firebase-admin.server';
import {
  copyableNotePictures,
  MAX_NOTE_PICTURES,
  type NotePictureEntry,
  notePicturesOf,
  storedNotePictures,
  validateNotePictureSlot,
  validateNotePicturesCopyInput,
  validateNotePictureUpload,
  withNotePicture,
  withNotePicturesAdded,
  withoutNotePicture,
} from './note-pictures.shared';
import { newImageId, requestPaths, requireEditableTournament } from './tournament-store.server';

const FULL_MESSAGE = `A tournament holds at most ${MAX_NOTE_PICTURES} settings pictures. Delete one first.`;
const CHANGING = 'settings pictures';

const picturesPath = (tournamentPath: string) => `${tournamentPath}/info/notePictures`;

/**
 * Stores one shrunk picture in a settings box, replacing the box's picture, never going over the limit even when two
 * admins upload at once. The replaced image is deleted once the new one is listed.
 */
export const uploadNotePicture = createServerFn({ method: 'POST' })
  .inputValidator(validateNotePictureUpload)
  .handler(async ({ data }): Promise<{ imageId: string }> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await requireEditableTournament(paths, CHANGING);
    const imageId = newImageId();
    await updateFirebase({ [`${paths.media}/${imageId}`]: data.dataUrl });
    let replaced: string | undefined;
    const listed = await transactFirebase(picturesPath(paths.tournament), (current) => {
      const change = withNotePicture(current, data.roundName, data.slot, imageId);
      replaced = change?.replaced;
      return change && storedNotePictures(change.pictures);
    });
    if (!listed) {
      await updateFirebase({ [`${paths.media}/${imageId}`]: null });
      throw new Error(FULL_MESSAGE);
    }
    if (replaced) await updateFirebase({ [`${paths.media}/${replaced}`]: null });
    return { imageId };
  });

/** Empties a settings box: unlists its picture, then deletes the image. */
export const deleteNotePicture = createServerFn({ method: 'POST' })
  .inputValidator(validateNotePictureSlot)
  .handler(async ({ data }): Promise<void> => {
    await requireTourAdminPermission();
    const paths = requestPaths(data.tournamentId);
    await requireEditableTournament(paths, CHANGING);
    let removed: string | undefined;
    await transactFirebase(picturesPath(paths.tournament), (current) => {
      const change = withoutNotePicture(current, data.roundName, data.slot);
      removed = change.replaced;
      return removed ? storedNotePictures(change.pictures) : undefined;
    });
    if (removed) await updateFirebase({ [`${paths.media}/${removed}`]: null });
  });

/**
 * Copies the pictures of one tournament into the same boxes of another, only into empty boxes and as far as the limit
 * leaves room; resolves with how many.
 */
export const copyNotePictures = createServerFn({ method: 'POST' })
  .inputValidator(validateNotePicturesCopyInput)
  .handler(async ({ data }): Promise<{ copied: number }> => {
    await requireTourAdminPermission();
    const from = requestPaths(data.fromTournamentId);
    const to = requestPaths(data.toTournamentId);
    await requireEditableTournament(to, CHANGING);
    const source = notePicturesOf(await readFirebaseOnce(picturesPath(from.tournament)));
    const target = notePicturesOf(await readFirebaseOnce(picturesPath(to.tournament)));
    const copies: Array<NotePictureEntry & { image: unknown }> = [];
    for (const entry of copyableNotePictures(source, target)) {
      const image = await readFirebaseOnce(`${from.media}/${entry.imageId}`);
      if (typeof image === 'string') copies.push({ ...entry, imageId: newImageId(), image });
    }
    if (!copies.length) return { copied: 0 };
    await updateFirebase(
      Object.fromEntries(copies.map(({ imageId, image }) => [`${to.media}/${imageId}`, image])),
    );
    let applied: NotePictureEntry[] = [];
    const listed = await transactFirebase(picturesPath(to.tournament), (current) => {
      const addition = withNotePicturesAdded(current, copies);
      applied = addition?.applied ?? [];
      return addition && storedNotePictures(addition.pictures);
    });
    const kept = new Set(listed ? applied.map(({ imageId }) => imageId) : []);
    const unused = copies.filter(({ imageId }) => !kept.has(imageId));
    if (unused.length) {
      await updateFirebase(Object.fromEntries(unused.map(({ imageId }) => [`${to.media}/${imageId}`, null])));
    }
    if (!listed) throw new Error(FULL_MESSAGE);
    return { copied: kept.size };
  });
