import { MAX_GAME_BOXES, MAX_ROUND_NAME_LENGTH } from '../../../domain/tournament/round-notes';
import type { GameNotes, RoundNotes, TournamentSettings } from '../../../domain/tournament/types';
import { readTournamentSettings } from '../../../domain/tournament/tournament-settings';
import { TOURNAMENT_ID_PATTERN, isValidPathSegment } from '../../sync/tournament-write.shared';
import { notePictureCount, notePicturesOf } from '../../tournaments/note-pictures.shared';

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

/** The info of a source tournament that is copied with its settings: the texts the Setup form's Info panel holds. */
export interface CopiedInfo {
  rulesText: string;
  roundNotes: RoundNotes | undefined;
  gameNotes: GameNotes | undefined;
}

export type SettingsSnapshotResult =
  | {
      ok: true;
      settings: TournamentSettings;
      title: string;
      rulesText: string;
      roundNotes: RoundNotes | undefined;
      gameNotes: GameNotes | undefined;
      screenshotCount: number;
      /** How many settings pictures the source holds, for the copy that follows. */
      notePictureCount: number;
    }
  | { ok: false; reason: 'not-found' | 'no-settings' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

const GAME_KEY_PATTERN = new RegExp(`^g[1-${MAX_GAME_BOXES}]$`);

/** A source tournament's game notes, keeping only well-formed entries (valid round names, keys g1-g9, non-blank text); `undefined` when none are. */
function readGameNotes(raw: unknown): GameNotes | undefined {
  if (!isRecord(raw)) return undefined;
  const rounds = Object.entries(raw).flatMap(([name, games]): Array<[string, Record<string, string>]> => {
    if (!isValidPathSegment(name) || name.length > MAX_ROUND_NAME_LENGTH || !isRecord(games)) return [];
    const notes = Object.entries(games).flatMap(([key, text]): Array<[string, string]> =>
      GAME_KEY_PATTERN.test(key) && typeof text === 'string' && text.trim() ? [[key, text.trim()]] : [],
    );
    return notes.length > 0 ? [[name, Object.fromEntries(notes)]] : [];
  });
  return rounds.length > 0 ? Object.fromEntries(rounds) : undefined;
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
    gameNotes: readGameNotes(info.gameNotes),
    screenshotCount,
    notePictureCount: notePictureCount(notePicturesOf(info.notePictures)),
  };
}
