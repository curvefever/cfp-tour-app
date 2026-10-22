import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import { validateTournamentId } from '../sync/tournament-write.shared';

/** How often an admin who stays in a field repeats the announcement. */
export const PRESENCE_REPEAT_MS = 15_000;

/** An announcement older than this no longer counts: the admin left, or closed the tab. */
export const PRESENCE_STALE_MS = 30_000;

/** What `presence/{tournamentId}/{userKey}` holds: who is in which field, and when (database clock) they said so. */
export interface PresenceEntry {
  name: string;
  field: string;
  at: number;
}

export type PresenceMap = Record<string, PresenceEntry>;

export interface SetPresenceInput {
  tournamentId: string;
  /** The field the admin is in, or `null` once they have left it. */
  field: string | null;
}

const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9.]{0,63}$/;
const MAX_NAME_LENGTH = 60;
const FALLBACK_NAME = 'Someone';

export function validatePresenceInput(input: SetPresenceInput): SetPresenceInput {
  if (!input || typeof input !== 'object') throw new Error('Invalid presence.');
  const tournamentId = validateTournamentId(input.tournamentId);
  if (input.field === null) return { tournamentId, field: null };
  if (typeof input.field !== 'string' || !FIELD_PATTERN.test(input.field)) throw new Error('Invalid field.');
  return { tournamentId, field: input.field };
}

/** The key of an admin under `presence/{tournamentId}`: their account id, with the characters a database key refuses replaced. */
export function presenceKey(userId: string): string {
  const key = userId.replace(/[.#$[\]/\u0000-\u001f\u007f]/g, '_');
  return key || '_';
}

/** The name shown in a tag: the account's username, trimmed and shortened. */
export function presenceName(username: string): string {
  return username.trim().slice(0, MAX_NAME_LENGTH) || FALLBACK_NAME;
}

/** The entries of a stored presence node that are well formed; anything else is ignored. */
export function parsePresence(raw: unknown): PresenceMap {
  const result: PresenceMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const { name, field, at } = value as Partial<PresenceEntry>;
    if (typeof name === 'string' && typeof field === 'string' && typeof at === 'number') {
      result[key] = { name, field, at };
    }
  }
  return result;
}

/**
 * Who is in each field right now, by field: the names of the admins other than `selfId` whose announcement is
 * younger than `PRESENCE_STALE_MS` on the database clock `serverNowMs`.
 */
export function activeEditors(
  presence: PresenceMap,
  selfId: string,
  serverNowMs: number,
): Record<string, string[]> {
  const self = presenceKey(selfId);
  const editors: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(presence)) {
    if (key === self || serverNowMs - entry.at >= PRESENCE_STALE_MS) continue;
    (editors[entry.field] ??= []).push(entry.name);
  }
  for (const names of Object.values(editors)) names.sort((a, b) => a.localeCompare(b));
  return editors;
}

/** "Alex is editing", "Alex and Sam are editing", "Alex, Sam and Kim are editing". */
export function editingText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is editing`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are editing`;
}

const CONTROL_FIELDS: Record<string, string> = {
  'cfg-title': 'title',
  'cfg-scheduled-at': 'info.scheduledAt',
  'info-rules-text': 'info.rulesText',
  // Players per team and teams per room are two more controls on the one `gameFormat` setting.
  'cfg-team-size': 'gameFormat',
  'cfg-teams-per-room': 'gameFormat',
};

const SETUP_KEYS = new Set<string>(Object.keys(createDefaultSetup()));

/**
 * The presence field a form control stands for, from its element id: the named ones, or `cfg-some-setting`
 * for the Setup key `someSetting`. `null` for a control that is no shared field (or no id).
 */
export function fieldOfControl(controlId: string | null | undefined): string | null {
  if (!controlId) return null;
  const named = CONTROL_FIELDS[controlId];
  if (named) return named;
  if (!controlId.startsWith('cfg-')) return null;
  const key = controlId.slice(4).replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
  return SETUP_KEYS.has(key) ? key : null;
}
