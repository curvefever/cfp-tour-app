import { UNSTORABLE_NAME_CHARACTERS } from '../../domain/tournament/roster';
import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import { parseDescriptionFields, type TournamentDescription } from '../tournaments/tournament-summary';

export type TournamentPatchInput = {
  patch: Record<string, unknown>;
  /** The descriptive fields of the tournament's list entry that this patch changes, if any. */
  summary?: Partial<TournamentDescription>;
  tournamentId: string;
};

export const TOURNAMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Whether `segment` can be one step of a Firebase path. */
export function isValidPathSegment(segment: string): boolean {
  return segment.length > 0 && !UNSTORABLE_NAME_CHARACTERS.test(segment);
}

export function validateTournamentId(value: unknown): string {
  const tournamentId = typeof value === 'string' ? value.trim() : '';
  if (!TOURNAMENT_ID_PATTERN.test(tournamentId)) throw new Error('Invalid tournament ID.');
  return tournamentId;
}

// The id never changes, and the status fields are written only by the lifecycle server functions.
const PATCH_FORBIDDEN_TOP_LEVEL_KEYS = new Set(['tournamentId', 'lifecycle', 'started']);

function isValidPatchPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.length < 1 || segments.length > 2) return false;
  if (!segments.every(isValidPathSegment)) return false;
  return !PATCH_FORBIDDEN_TOP_LEVEL_KEYS.has(segments[0]);
}

/** The screenshots are listed by the upload functions only: a patch that wrote the list could drop another admin's upload. */
function carriesScreenshots(path: string, value: unknown): boolean {
  if (path === 'info/screenshots') return true;
  return path === 'info' && typeof value === 'object' && value !== null && 'screenshots' in value;
}

/** Checks every path of a patch (the value can be anything, `null` deleting) and drops legacy `adminProof` paths. */
export function cleanPatchPaths(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('Invalid tournament patch.');
  const cleaned: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(patch)) {
    if (!isValidPatchPath(path) || carriesScreenshots(path, value)) {
      throw new Error(`Invalid tournament patch path: ${path}`);
    }
    if (path.split('/')[0] !== 'adminProof') cleaned[path] = value;
  }
  return cleaned;
}

/** A patch is a set of one- or two-step paths under the tournament, each with its new value (`null` deletes). */
export function validatePatchInput(input: TournamentPatchInput): TournamentPatchInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  const patch = cleanPatchPaths(input.patch);
  if (!Object.keys(patch).length) throw new Error('Invalid tournament patch.');
  const summary = input.summary === undefined ? undefined : parseDescriptionFields(input.summary);
  return summary ? { tournamentId, patch, summary } : { tournamentId, patch };
}

export type SetupPatchInput = {
  patch: Record<string, string>;
  /** The descriptive fields of the tournament's list entry that this patch changes, if any. */
  summary?: Partial<TournamentDescription>;
  tournamentId: string;
};

const SETUP_KEYS: ReadonlySet<string> = new Set(Object.keys(createDefaultSetup()));

/** A setup patch is a set of Setup form fields, each with its new text. */
export function validateSetupPatchInput(input: SetupPatchInput): SetupPatchInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid setup update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
    throw new Error('Invalid setup patch.');
  }
  const entries = Object.entries(input.patch);
  if (!entries.length) throw new Error('Invalid setup patch.');
  for (const [key, value] of entries) {
    if (!SETUP_KEYS.has(key)) throw new Error(`Invalid setup field: ${key}`);
    if (typeof value !== 'string') throw new Error(`Invalid value for setup field: ${key}`);
  }
  const summary = input.summary === undefined ? undefined : parseDescriptionFields(input.summary);
  return summary ? { tournamentId, patch: input.patch, summary } : { tournamentId, patch: input.patch };
}
