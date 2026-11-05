import { MAX_ROUND_NAME_LENGTH } from '../../domain/tournament/round-notes';
import type { NotePictures } from '../../domain/tournament/types';
import { marshalForFirebase, unmarshalFromFirebase } from '../sync/firebase-marshal';
import { isValidPathSegment, validateTournamentId } from '../sync/tournament-write.shared';
import { IMAGE_ID_PATTERN, validateImageDataUrl } from './screenshots.shared';

/** The most settings pictures one tournament holds, the lobby screenshots not counted. */
export const MAX_NOTE_PICTURES = 24;

/** The box a picture belongs to: the round's own (`round`) or one of its games (`g1`…`g9`). */
export const NOTE_SLOT_PATTERN = /^(round|g[1-9])$/;

export interface NotePictureSlot {
  tournamentId: string;
  roundName: string;
  slot: string;
}

export interface UploadNotePictureInput extends NotePictureSlot {
  /** `data:image/webp;base64,…` (or png or jpeg). */
  dataUrl: string;
}

export interface CopyNotePicturesInput {
  fromTournamentId: string;
  toTournamentId: string;
}

/** One picture to put into a box of a tournament. */
export interface NotePictureEntry {
  roundName: string;
  slot: string;
  imageId: string;
}

function isStorableRoundName(name: unknown): name is string {
  return typeof name === 'string' && isValidPathSegment(name) && name.length <= MAX_ROUND_NAME_LENGTH;
}

export function validateNotePictureSlot(input: NotePictureSlot): NotePictureSlot {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings picture.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!isStorableRoundName(input.roundName)) throw new Error('Invalid round name.');
  if (typeof input.slot !== 'string' || !NOTE_SLOT_PATTERN.test(input.slot)) {
    throw new Error('Invalid settings box.');
  }
  return { tournamentId, roundName: input.roundName, slot: input.slot };
}

export function validateNotePictureUpload(input: UploadNotePictureInput): UploadNotePictureInput {
  const slot = validateNotePictureSlot(input);
  return { ...slot, dataUrl: validateImageDataUrl(input.dataUrl, 'picture') };
}

export function validateNotePicturesCopyInput(input: CopyNotePicturesInput): CopyNotePicturesInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid copy.');
  const fromTournamentId = validateTournamentId(input.fromTournamentId);
  const toTournamentId = validateTournamentId(input.toTournamentId);
  if (fromTournamentId === toTournamentId) {
    throw new Error('A tournament cannot copy settings pictures onto itself.');
  }
  return { fromTournamentId, toTournamentId };
}

/** The pictures in the stored (marshalled) map; an entry with a bad round name, box or image id is ignored. */
export function notePicturesOf(stored: unknown): NotePictures {
  const decoded = unmarshalFromFirebase(stored);
  const pictures: NotePictures = {};
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return pictures;
  for (const [roundName, slots] of Object.entries(decoded)) {
    if (!isStorableRoundName(roundName) || typeof slots !== 'object' || slots === null) continue;
    const valid = Object.entries(slots).filter(
      (entry): entry is [string, string] =>
        NOTE_SLOT_PATTERN.test(entry[0]) && typeof entry[1] === 'string' && IMAGE_ID_PATTERN.test(entry[1]),
    );
    if (valid.length > 0) pictures[roundName] = Object.fromEntries(valid);
  }
  return pictures;
}

export function notePictureCount(pictures: NotePictures): number {
  return Object.values(pictures).reduce((total, slots) => total + Object.keys(slots).length, 0);
}

/** The map as it is stored: empty values marked, so nothing is deleted by Firebase. */
export function storedNotePictures(pictures: NotePictures): unknown {
  return marshalForFirebase(pictures);
}

export interface NotePicturesChange {
  pictures: NotePictures;
  /** The id of the picture the change took out of its box, whose image can be deleted. */
  replaced?: string;
}

/**
 * The pictures with `imageId` in a box, or `undefined` when that would make more than the limit. A picture already in
 * the box is replaced (and returned as `replaced`): a replacement never goes over the limit.
 */
export function withNotePicture(
  stored: unknown,
  roundName: string,
  slot: string,
  imageId: string,
): NotePicturesChange | undefined {
  const current = notePicturesOf(stored);
  const replaced = Object.hasOwn(current, roundName) ? current[roundName][slot] : undefined;
  if (notePictureCount(current) - (replaced ? 1 : 0) + 1 > MAX_NOTE_PICTURES) return undefined;
  const pictures = { ...current, [roundName]: { ...current[roundName], [slot]: imageId } };
  return replaced ? { pictures, replaced } : { pictures };
}

/** The pictures with a box emptied; a round left without pictures is dropped. */
export function withoutNotePicture(stored: unknown, roundName: string, slot: string): NotePicturesChange {
  const current = notePicturesOf(stored);
  const removed = Object.hasOwn(current, roundName) ? current[roundName][slot] : undefined;
  if (!removed) return { pictures: current };
  const { [slot]: _removed, ...rest } = current[roundName];
  const { [roundName]: _round, ...others } = current;
  return {
    pictures: Object.keys(rest).length > 0 ? { ...others, [roundName]: rest } : others,
    replaced: removed,
  };
}

export interface NotePicturesAddition {
  pictures: NotePictures;
  /** The entries put in: those whose box was empty, as far as the limit leaves room. */
  applied: NotePictureEntry[];
}

/**
 * The pictures with `entries` added to their boxes, only where the box is empty; `undefined` when that would make
 * more than the limit.
 */
export function withNotePicturesAdded(
  stored: unknown,
  entries: NotePictureEntry[],
): NotePicturesAddition | undefined {
  const pictures = notePicturesOf(stored);
  const applied: NotePictureEntry[] = [];
  for (const entry of entries) {
    if (Object.hasOwn(pictures, entry.roundName) && pictures[entry.roundName][entry.slot]) continue;
    pictures[entry.roundName] = { ...pictures[entry.roundName], [entry.slot]: entry.imageId };
    applied.push(entry);
  }
  return notePictureCount(pictures) > MAX_NOTE_PICTURES ? undefined : { pictures, applied };
}

/** The entries of `source` whose box is empty in `target`, in order, as many as the limit leaves room for. */
export function copyableNotePictures(source: NotePictures, target: NotePictures): NotePictureEntry[] {
  const room = Math.max(MAX_NOTE_PICTURES - notePictureCount(target), 0);
  const entries = Object.entries(source).flatMap(([roundName, slots]) =>
    Object.entries(slots)
      .filter(([slot]) => !(Object.hasOwn(target, roundName) && target[roundName][slot]))
      .map(([slot, imageId]) => ({ roundName, slot, imageId })),
  );
  return entries.slice(0, room);
}
