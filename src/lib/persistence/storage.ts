import type { IdSource } from '../../domain/tournament/runtime';
import type { ActiveTab, PersistedTournamentEnvelope } from '../../domain/tournament/types';
import { normalizeActiveTab, parseLiveEnvelope, serializeLiveEnvelope } from './live-state';
import {
  EXITED_KEY,
  LAST_VIEW_KEY,
  LEGACY_BRACKET_FOLLOW_KEY,
  LEGACY_LAST_TAB_KEY,
  LEGACY_LIVE_STATE_KEY,
} from './storage-keys';

export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadLiveEnvelopeResult =
  | { status: 'empty' }
  | { status: 'loaded'; envelope: PersistedTournamentEnvelope }
  | { status: 'invalid'; error: unknown };

export function loadLiveEnvelope(
  storage: BrowserStorage,
  ids: Pick<IdSource, 'tournamentId'>,
): LoadLiveEnvelopeResult {
  try {
    const raw = storage.getItem(LEGACY_LIVE_STATE_KEY);
    if (!raw) return { status: 'empty' };
    return { status: 'loaded', envelope: parseLiveEnvelope(raw, ids) };
  } catch (error) {
    return { status: 'invalid', error };
  }
}

export function saveLiveEnvelope(
  storage: BrowserStorage,
  envelope: PersistedTournamentEnvelope,
  options: { isViewer: boolean },
): { status: 'saved' | 'skipped-viewer' | 'failed'; error?: unknown } {
  if (options.isViewer) return { status: 'skipped-viewer' };
  try {
    storage.setItem(LEGACY_LIVE_STATE_KEY, serializeLiveEnvelope(envelope));
    return { status: 'saved' };
  } catch (error) {
    return { status: 'failed', error };
  }
}

export function clearLiveEnvelope(storage: BrowserStorage): void {
  storage.removeItem(LEGACY_LIVE_STATE_KEY);
}

export function readBracketFollow(storage: BrowserStorage): string | null {
  return storage.getItem(LEGACY_BRACKET_FOLLOW_KEY);
}

export function saveBracketFollow(storage: BrowserStorage, unitKey: string | null): void {
  if (unitKey === null) storage.removeItem(LEGACY_BRACKET_FOLLOW_KEY);
  else storage.setItem(LEGACY_BRACKET_FOLLOW_KEY, unitKey);
}

/** The tab this browser was last on, and the tournament it was on it for (null for one remembered before tournaments had their own). */
export interface LastView {
  tournamentId: string | null;
  tab: ActiveTab;
}

/** The last tab of this browser with its tournament; the old tab-only memory counts once, for any tournament. */
export function readLastView(storage: BrowserStorage): LastView | null {
  const stored = storage.getItem(LAST_VIEW_KEY);
  if (stored !== null) {
    try {
      const parsed: unknown = JSON.parse(stored);
      if (typeof parsed === 'object' && parsed !== null) {
        const { tournamentId, tab } = parsed as Record<string, unknown>;
        if (typeof tournamentId === 'string') return { tournamentId, tab: normalizeActiveTab(tab) };
      }
    } catch {
      // Unreadable memory is the same as none.
    }
    return null;
  }
  const legacy = storage.getItem(LEGACY_LAST_TAB_KEY);
  return legacy === null ? null : { tournamentId: null, tab: normalizeActiveTab(legacy) };
}

export function saveLastView(storage: BrowserStorage, view: { tournamentId: string; tab: ActiveTab }): void {
  storage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  storage.removeItem(LEGACY_LAST_TAB_KEY);
}

/** The id of the tournament this browser exited, so it is not loaded again by a visit without a link. */
export function readExited(storage: BrowserStorage): string | null {
  return storage.getItem(EXITED_KEY);
}

export function saveExited(storage: BrowserStorage, tournamentId: string | null): void {
  if (tournamentId === null) storage.removeItem(EXITED_KEY);
  else storage.setItem(EXITED_KEY, tournamentId);
}
