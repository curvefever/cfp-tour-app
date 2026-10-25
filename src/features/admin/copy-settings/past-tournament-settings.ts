import type { RoundNotes, TournamentSettings } from '../../../domain/tournament/types';
import { readTournamentSettings } from '../../../domain/tournament/tournament-settings';
import { TOURNAMENT_ID_PATTERN, isValidPathSegment } from '../../sync/tournament-write.shared';

export const TOURNAMENT_NOT_FOUND_MESSAGE =
  'No tournament with that id on this site. Test and production tournaments are separate.';
export const TOURNAMENT_NO_SETTINGS_MESSAGE =
  "That tournament was created before settings were saved with tournaments, so its settings can't be copied.";
export const TOURNAMENT_REFERENCE_INVALID_MESSAGE = 'Paste a tournament link or id.';

/** Accepts a bare tournament id or a viewer link (`?t=<id>`); `null` if neither yields a valid id. */
export function parseTournamentReference(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  try {
    const url = new URL(trimmed);
    const idParam = url.searchParams.get('t');
    if (idParam === null) return null;
    candidate = idParam;
  } catch {
    // Not a URL -- treat the whole trimmed input as a bare id.
  }
  return TOURNAMENT_ID_PATTERN.test(candidate) ? candidate : null;
}

export type SettingsSnapshotResult =
  | {
      ok: true;
      settings: TournamentSettings;
      title: string;
      rulesText: string;
      roundNotes: RoundNotes | undefined;
      screenshotCount: number;
    }
  | { ok: false; reason: 'not-found' | 'no-settings' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_ROUND_NAME_LENGTH = 60;

/** A source tournament's round settings notes, keeping only well-formed entries; `undefined` when none are. */
function readRoundNotes(raw: unknown): RoundNotes | undefined {
  if (!isRecord(raw)) return undefined;
  const entries = Object.entries(raw).flatMap(([name, text]): Array<[string, string]> =>
    isValidPathSegment(name) &&
    name.length <= MAX_ROUND_NAME_LENGTH &&
    typeof text === 'string' &&
    text.trim()
      ? [[name, text.trim()]]
      : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * `raw` is the unmarshalled Firebase value for a tournament id (or `null` when nothing is stored there) and
 * `setupRaw` the one for its Setup form. The stored Setup form wins; a tournament that predates it falls back
 * to the settings snapshot its schedule was generated with.
 */
export function settingsFromSnapshot(raw: unknown, setupRaw?: unknown): SettingsSnapshotResult {
  if (!isRecord(raw)) return { ok: false, reason: 'not-found' };
  const snapshotSettings = readTournamentSettings(raw.settings);
  // The "losers' bracket qualifiers" box lives outside the Setup form, so it only ever comes from the snapshot.
  const storedSettings = isRecord(setupRaw)
    ? readTournamentSettings({ ...setupRaw, lbQualifiers: snapshotSettings?.lbQualifiers })
    : null;
  const settings = storedSettings ?? snapshotSettings;
  if (!settings) return { ok: false, reason: 'no-settings' };
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Unnamed Tournament';
  const info = isRecord(raw.info) ? raw.info : {};
  const rulesText = typeof info.rulesText === 'string' ? info.rulesText : '';
  const screenshotCount = Array.isArray(info.screenshots) ? info.screenshots.length : 0;
  return {
    ok: true,
    settings,
    title,
    rulesText,
    roundNotes: readRoundNotes(info.roundNotes),
    screenshotCount,
  };
}
