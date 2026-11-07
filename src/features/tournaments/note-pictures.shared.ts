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

/** One round renamed: its pictures move to the new name. */
export interface RoundRename {
  from: string;
  to: string;
}

export interface RenameNotePictureRoundsInput {
  tournamentId: string;
  renames: RoundRename[];
}

/** The most rounds one call renames (a graph has far fewer). */
export const MAX_ROUND_RENAMES = 100;

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

export function validateNotePictureRenames(
  input: RenameNotePictureRoundsInput,
): RenameNotePictureRoundsInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid rename.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!Array.isArray(input.renames) || input.renames.length > MAX_ROUND_RENAMES) {
    throw new Error('Invalid rename.');
  }
  const renames = input.renames.map((rename): RoundRename => {
    if (!rename || typeof rename !== 'object') throw new Error('Invalid rename.');
    if (!isStorableRoundName(rename.from) || !isStorableRoundName(rename.to)) {
      throw new Error('Invalid round name.');
    }
    return { from: rename.from, to: rename.to };
  });
  const distinct = (pick: (rename: RoundRename) => string) =>
    new Set(renames.map(pick)).size === renames.length;
  if (renames.some(({ from, to }) => from === to) || !distinct((r) => r.from) || !distinct((r) => r.to)) {
    throw new Error('Invalid rename.');
  }
  return { tournamentId, renames };
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

export interface NotePictureRemoval {
  /** What the transaction writes: the map without the box, or the stored value as it is when the box was empty. */
  value: unknown;
  /** The id of the picture taken out of its box, whose image can be deleted. */
  removed?: string;
}

/**
 * The step of a transaction that empties a box. It never aborts (returns `undefined`): the Admin SDK's first call sees
 * `null` when nothing is cached, and an aborted transaction is not retried, so a map that exists would be left as it
 * is. Writing the stored value back makes the server check it and call again with the real one.
 */
export function notePicturesAfterRemoval(
  stored: unknown,
  roundName: string,
  slot: string,
): NotePictureRemoval {
  const { pictures, replaced } = withoutNotePicture(stored, roundName, slot);
  return replaced ? { value: storedNotePictures(pictures), removed: replaced } : { value: stored ?? null };
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

export interface NotePictureRenaming {
  /** What the transaction writes: the map with the rounds moved, or the stored value as it is when nothing moved. */
  value: unknown;
  /** The ids of pictures a move left without a box (the new name already held a picture in that box): their images can be deleted. */
  dropped: string[];
}

/**
 * The step of a transaction that renames rounds: each round's boxes move to its new name, all at once (so "Round 4"
 * to "Round 5" and "Round 5" to "Round 6" never collide). A name that is not itself renamed and already holds a
 * picture in a box keeps it; the moved picture is dropped. Like `notePicturesAfterRemoval` it never returns
 * `undefined`: the first call may see `null` when nothing is cached, and an aborted transaction is not retried, so
 * the stored value goes back as it is when nothing moves and the server calls again with the real one.
 */
export function notePicturesAfterRename(stored: unknown, renames: RoundRename[]): NotePictureRenaming {
  const current = notePicturesOf(stored);
  const target = new Map(renames.map(({ from, to }) => [from, to]));
  if (!Object.keys(current).some((name) => target.has(name))) return { value: stored ?? null, dropped: [] };
  const moved: NotePictures = {};
  for (const [name, slots] of Object.entries(current)) if (!target.has(name)) moved[name] = slots;
  const dropped: string[] = [];
  for (const [name, slots] of Object.entries(current)) {
    const to = target.get(name);
    if (to === undefined) continue;
    const kept = Object.hasOwn(moved, to) ? moved[to] : {};
    dropped.push(
      ...Object.entries(slots)
        .filter(([slot]) => slot in kept)
        .map(([, imageId]) => imageId),
    );
    moved[to] = { ...slots, ...kept };
  }
  return { value: storedNotePictures(moved), dropped };
}
