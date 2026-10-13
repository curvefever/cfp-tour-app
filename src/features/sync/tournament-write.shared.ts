export type TournamentWriteInput = {
  payload: unknown;
  tournamentId: string;
};

export type TournamentPatchInput = {
  patch: Record<string, unknown>;
  tournamentId: string;
};

export const TOURNAMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Characters Firebase refuses in a key (`. # $ [ ] /`) and ASCII control characters.
const INVALID_SEGMENT_CHARACTERS = /[.#$[\]/\u0000-\u001f\u007f]/;

/** Whether `segment` can be one step of a Firebase path. */
export function isValidPathSegment(segment: string): boolean {
  return segment.length > 0 && !INVALID_SEGMENT_CHARACTERS.test(segment);
}

function validateTournamentId(value: unknown): string {
  const tournamentId = typeof value === 'string' ? value.trim() : '';
  if (!TOURNAMENT_ID_PATTERN.test(tournamentId)) throw new Error('Invalid tournament ID.');
  return tournamentId;
}

export function validateWriteInput(input: TournamentWriteInput): TournamentWriteInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new Error('Invalid tournament data.');
  }
  const payload = { ...(input.payload as Record<string, unknown>) };
  delete payload.adminProof;
  return { tournamentId, payload };
}

const PATCH_FORBIDDEN_TOP_LEVEL_KEYS = new Set(['tournamentId']);

function isValidPatchPath(path: string): boolean {
  const segments = path.split('/');
  if (segments.length < 1 || segments.length > 2) return false;
  if (!segments.every(isValidPathSegment)) return false;
  return !PATCH_FORBIDDEN_TOP_LEVEL_KEYS.has(segments[0]);
}

/** A patch is a set of one- or two-step paths under the tournament, each with its new value (`null` deletes). */
export function validatePatchInput(input: TournamentPatchInput): TournamentPatchInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid tournament update.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
    throw new Error('Invalid tournament patch.');
  }
  const patch: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(input.patch)) {
    if (!isValidPatchPath(path)) throw new Error(`Invalid tournament patch path: ${path}`);
    if (path.split('/')[0] === 'adminProof') continue;
    patch[path] = value;
  }
  if (!Object.keys(patch).length) throw new Error('Invalid tournament patch.');
  return { tournamentId, patch };
}
