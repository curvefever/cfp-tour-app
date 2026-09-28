import type { TournamentSettings } from '../../../domain/tournament/types';
import { readTournamentSettings } from '../../../domain/tournament/tournament-settings';
import { loadArchiveEntry, loadArchiveIndex, type ArchiveEntry } from '../../../lib/persistence/archive';
import type { BrowserStorage } from '../../../lib/persistence/storage';
import { TOURNAMENT_ID_PATTERN } from '../../sync/tournament-write.shared';

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
  | { ok: true; settings: TournamentSettings; title: string }
  | { ok: false; reason: 'not-found' | 'no-settings' };

/** `raw` is the unmarshalled Firebase value for a tournament id (or `null` when nothing is stored there). */
export function settingsFromSnapshot(raw: unknown): SettingsSnapshotResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not-found' };
  }
  const record = raw as Record<string, unknown>;
  const settings = readTournamentSettings(record.settings);
  if (!settings) return { ok: false, reason: 'no-settings' };
  const title =
    typeof record.title === 'string' && record.title.trim() ? record.title.trim() : 'Unnamed Tournament';
  return { ok: true, settings, title };
}

export interface ArchiveEntryWithSettings {
  id: string;
  title: string;
  dateSaved: string;
}

/** The archive index filtered to entries whose snapshot has readable settings, newest first. Parses every entry, so call it only when the panel is actually opened. */
export function archiveEntriesWithSettings(storage: BrowserStorage): ArchiveEntryWithSettings[] {
  return loadArchiveIndex(storage)
    .map((summary) => loadArchiveEntry(storage, summary.id))
    .filter(
      (entry): entry is ArchiveEntry =>
        entry !== null && readTournamentSettings(entry.snapshot.settings) !== null,
    )
    .sort((a, b) => new Date(b.dateSaved).getTime() - new Date(a.dateSaved).getTime())
    .map((entry) => ({ id: entry.id, title: entry.title, dateSaved: entry.dateSaved }));
}
