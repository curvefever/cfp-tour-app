import { marshalForFirebase, unmarshalFromFirebase } from '../sync/firebase-marshal';
import { validateTournamentId } from '../sync/tournament-write.shared';

/** The most lobby screenshots one tournament holds. */
export const MAX_SCREENSHOTS = 4;

/** The most a screenshot weighs once decoded; the browser shrinks every image well below it before sending it. */
export const MAX_SCREENSHOT_BYTES = 400 * 1024;

export const IMAGE_ID_PATTERN = /^[A-Za-z0-9]{8,32}$/;

const DATA_URL_PATTERN = /^data:(image\/(?:webp|png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/;

export interface UploadScreenshotInput {
  tournamentId: string;
  /** `data:image/webp;base64,…` (or png or jpeg). */
  dataUrl: string;
}

export interface ScreenshotRef {
  tournamentId: string;
  imageId: string;
}

export interface CopyScreenshotsInput {
  fromTournamentId: string;
  toTournamentId: string;
}

/** The size of what a base64 text decodes to. */
export function decodedBase64Size(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function validateUploadInput(input: UploadScreenshotInput): UploadScreenshotInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid screenshot.');
  const tournamentId = validateTournamentId(input.tournamentId);
  const match = typeof input.dataUrl === 'string' ? DATA_URL_PATTERN.exec(input.dataUrl) : null;
  if (!match) throw new Error('The screenshot must be a WebP, PNG or JPEG image.');
  const size = decodedBase64Size(match[2]);
  if (size === 0) throw new Error('The screenshot is empty.');
  if (size > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `The screenshot is too large (${Math.ceil(size / 1024)} KB; the limit is ${MAX_SCREENSHOT_BYTES / 1024} KB).`,
    );
  }
  return { tournamentId, dataUrl: input.dataUrl };
}

export function validateImageInput(input: ScreenshotRef): ScreenshotRef {
  if (!input || typeof input !== 'object') throw new Error('Invalid screenshot.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (typeof input.imageId !== 'string' || !IMAGE_ID_PATTERN.test(input.imageId)) {
    throw new Error('Invalid screenshot ID.');
  }
  return { tournamentId, imageId: input.imageId };
}

export function validateCopyInput(input: CopyScreenshotsInput): CopyScreenshotsInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid copy.');
  const fromTournamentId = validateTournamentId(input.fromTournamentId);
  const toTournamentId = validateTournamentId(input.toTournamentId);
  if (fromTournamentId === toTournamentId)
    throw new Error('A tournament cannot copy screenshots onto itself.');
  return { fromTournamentId, toTournamentId };
}

/** The screenshot ids in the stored (marshalled) list; anything that is not an id is ignored. */
export function screenshotIdsOf(stored: unknown): string[] {
  const decoded = unmarshalFromFirebase(stored);
  if (!Array.isArray(decoded)) return [];
  return decoded.filter((id): id is string => typeof id === 'string' && IMAGE_ID_PATTERN.test(id));
}

/** The stored list with `ids` added, or `undefined` when that would make more than the limit. */
export function withScreenshotsAdded(stored: unknown, ids: string[]): unknown {
  const next = [...screenshotIdsOf(stored), ...ids];
  return next.length > MAX_SCREENSHOTS ? undefined : marshalForFirebase(next);
}

/** The stored list without `imageId`. */
export function withScreenshotRemoved(stored: unknown, imageId: string): unknown {
  return marshalForFirebase(screenshotIdsOf(stored).filter((id) => id !== imageId));
}
