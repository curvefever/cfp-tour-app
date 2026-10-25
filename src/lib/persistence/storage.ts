import type { IdSource } from '../../domain/tournament/runtime';
import {
  TOURNAMENT_PHASES,
  type ActiveTab,
  type PersistedTournamentEnvelope,
  type TournamentPhase,
} from '../../domain/tournament/types';
import { normalizeActiveTab, parseLiveEnvelope, serializeLiveEnvelope } from './live-state';
import {
  EXITED_KEY,
  LAST_VIEW_KEY,
  LEGACY_BRACKET_FOLLOW_KEY,
  LEGACY_LAST_TAB_KEY,
  LEGACY_LIVE_STATE_KEY,
  ROUND_SETTINGS_HIDDEN_KEY,
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

/** Whether this browser shows the Bracket's round settings: on unless it chose to hide them, and on when storage can't be read. */
export function readRoundSettingsShown(storage: BrowserStorage): boolean {
  try {
    return storage.getItem(ROUND_SETTINGS_HIDDEN_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export function saveRoundSettingsShown(storage: BrowserStorage, shown: boolean): void {
  try {
    if (shown) storage.removeItem(ROUND_SETTINGS_HIDDEN_KEY);
    else storage.setItem(ROUND_SETTINGS_HIDDEN_KEY, 'hidden');
  } catch {
    // Storage is blocked or full: the choice then lasts until the page is closed.
  }
}

const TOURNAMENT_TABS: readonly ActiveTab[] = ['info', 'bracket', 'standings', 'rankings'];

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
  if (legacy === null) return null;
  // Only a tab of a tournament counts: 'home', 'archive', 'admin' and anything unknown say nothing about which tab to open.
  const tab = legacy === 'scoreboard' ? 'standings' : legacy;
  return (TOURNAMENT_TABS as readonly string[]).includes(tab)
    ? { tournamentId: null, tab: tab as ActiveTab }
    : null;
}

export function saveLastView(storage: BrowserStorage, view: { tournamentId: string; tab: ActiveTab }): void {
  storage.setItem(LAST_VIEW_KEY, JSON.stringify(view));
  storage.removeItem(LEGACY_LAST_TAB_KEY);
}

/** The tournament this browser exited, and the phase it was in then. */
export interface ExitedMemory {
  tournamentId: string;
  phase: TournamentPhase;
}

function isPhase(value: unknown): value is TournamentPhase {
  return (TOURNAMENT_PHASES as readonly unknown[]).includes(value);
}

/** The tournament this browser exited; a plain id from before phases were remembered counts as exited while ongoing. */
export function readExited(storage: BrowserStorage): ExitedMemory | null {
  const stored = storage.getItem(EXITED_KEY);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed === 'object' && parsed !== null) {
      const { tournamentId, phase } = parsed as Record<string, unknown>;
      if (typeof tournamentId === 'string' && isPhase(phase)) return { tournamentId, phase };
      return null;
    }
  } catch {
    // Not JSON: the plain id of the old memory.
  }
  return stored ? { tournamentId: stored, phase: 'ongoing' } : null;
}

export function saveExited(storage: BrowserStorage, exited: ExitedMemory | null): void {
  if (exited === null) storage.removeItem(EXITED_KEY);
  else storage.setItem(EXITED_KEY, JSON.stringify(exited));
}
