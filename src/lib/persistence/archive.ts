import type { TournamentState } from '../../domain/tournament/types';
import type { BrowserStorage } from './storage';
import { archiveEntryStorageKey, LEGACY_ARCHIVE_INDEX_KEY } from './storage-keys';

export interface ArchiveAnnotation {
  text: string;
  timestamp: string;
}

/** The old, browser-local archive: kept only so an admin can download what this browser still holds. */
export interface ArchiveSummary {
  id: string;
  title: string;
  dateSaved: string;
  tournamentId: string | null;
  playerCount: number;
  roundsPlayed: number;
}

export interface ArchiveEntry {
  id: string;
  title: string;
  dateSaved: string;
  tournamentId: string | null;
  snapshot: TournamentState;
  annotations: ArchiveAnnotation[];
}

export interface ArchiveBundle {
  exportedAt: string;
  tournaments: ArchiveEntry[];
}

export function loadArchiveIndex(storage: BrowserStorage): ArchiveSummary[] {
  try {
    const value = JSON.parse(storage.getItem(LEGACY_ARCHIVE_INDEX_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function loadArchiveEntry(storage: BrowserStorage, id: string): ArchiveEntry | null {
  try {
    return JSON.parse(storage.getItem(archiveEntryStorageKey(id)) ?? 'null') as ArchiveEntry | null;
  } catch {
    return null;
  }
}

export function archiveBundle(storage: BrowserStorage, exportedAt: string): ArchiveBundle {
  return {
    exportedAt,
    tournaments: loadArchiveIndex(storage)
      .map((summary) => loadArchiveEntry(storage, summary.id))
      .filter((entry): entry is ArchiveEntry => Boolean(entry)),
  };
}
