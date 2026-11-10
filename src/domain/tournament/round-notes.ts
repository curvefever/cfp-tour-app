import { bracketRoundLabels, roundGameCount, storedRoundLabels } from './bracket';
import type { GameNotes, RoundNotes, TournamentInfo, TournamentState } from './types';

/** The longest round name a note can be stored under (a Firebase key, and what the Copy settings accepts). */
export const MAX_ROUND_NAME_LENGTH = 60;

/** The most games of a round that get a settings box: `g1`…`g9`. */
export const MAX_GAME_BOXES = 9;

/** The three maps a round's settings are read from: any `TournamentInfo` has them. */
export type RoundSettingsInfo = Partial<Pick<TournamentInfo, 'roundNotes' | 'gameNotes' | 'notePictures'>>;

type RoundSettingsState = Pick<TournamentState, 'rounds' | 'gamemodeConfig'>;

export interface GameNoteRow {
  /** `g1`…`g9`. */
  key: string;
  /** 'Game 2'. */
  label: string;
  /** The stored text, '' when there is none. */
  note: string;
  /** The id of the stored picture. */
  picture?: string;
  /** A box beyond the round's games now (or of a round that is gone), holding a note or a picture. */
  orphan?: true;
}

export interface RoundNoteRow {
  name: string;
  /** The name the Bracket shows, when it differs from the stored one (a double elimination numbers by column). */
  shown?: string;
  /** The stored text, '' when there is none. */
  note: string;
  /** The id of the round box's picture. */
  picture?: string;
  /** One row per game of the round, then the boxes that hold something beyond its games. Empty for a one-game round. */
  games: GameNoteRow[];
  /** A stored name that no round of the schedule has now (a redraw changed the rounds). */
  orphan?: true;
}

/**
 * The name each round's note is keyed by, index-aligned with `state.rounds`: the round's label by its stored number
 * (`storedRoundLabels`, the same as the Bracket's except in a double elimination, which the Bracket numbers by
 * column), with " (2)", " (3)" added to a name that repeats, in schedule order. Stored numbers never change for a
 * schedule, so a note stays with its round, and they hold no "." (not storable in a key, unlike "6.1").
 */
export function roundNoteNames(state: Pick<TournamentState, 'rounds'>): string[] {
  return uniqueNames(storedRoundLabels(state).map(({ label }) => label));
}

function uniqueNames(labels: string[]): string[] {
  const seen = new Map<string, number>();
  return labels.map((label) => {
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return count === 1 ? label : `${label} (${count})`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The own entries of a stored map; none when it is not a map. */
function entriesOf(map: unknown): Array<[string, unknown]> {
  return isRecord(map) ? Object.entries(map) : [];
}

/** The stored notes that are text: a value of another shape (the stage notes of an earlier build) is no note. */
function storedNotes(notes: RoundNotes | undefined): Array<[string, string]> {
  return entriesOf(notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

/** The map stored under a round's name in a two-level map (game notes, pictures); empty when it is not one. */
function innerOf(map: unknown, name: string): Record<string, unknown> {
  if (!isRecord(map) || !Object.hasOwn(map, name)) return {};
  const inner = map[name];
  return isRecord(inner) ? inner : {};
}

function textAt(map: unknown, name: string, key: string): string {
  const inner = innerOf(map, name);
  const text = Object.hasOwn(inner, key) ? inner[key] : '';
  return typeof text === 'string' ? text.trim() : '';
}

function pictureAt(map: unknown, name: string, slot: string): string | undefined {
  const inner = innerOf(map, name);
  const id = Object.hasOwn(inner, slot) ? inner[slot] : undefined;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** The key of a game's box: `g1`…`g9`. */
export function gameKey(gameNumber: number): string {
  return `g${gameNumber}`;
}

/**
 * The most games a room of the round can play: its `numGames` (summed games, or a Best of N's maximum, which a
 * room of several units can push beyond N), or the race Grand Final's maximum. 0 or 1 for a round of one game.
 */
function mostGames(state: RoundSettingsState, roundIndex: number): number {
  const round = state.rounds[roundIndex];
  if (round?.bracket === 'grand-final') return roundGameCount(state, roundIndex)?.games ?? 0;
  return round?.numGames ?? 0;
}

/**
 * How many game boxes a round has: one per game a room can play in a round that plays several (summed games, a
 * Best of N, the race Grand Final), at most `MAX_GAME_BOXES`; none for a one-game round, which is its own game.
 */
export function noteGameCount(state: RoundSettingsState, roundIndex: number): number {
  const games = mostGames(state, roundIndex);
  return games > 1 ? Math.min(games, MAX_GAME_BOXES) : 0;
}

/** Whether a room of the round can play more games than it has boxes: the last box is then "Game 9 and after". */
function hasGamesBeyondBoxes(state: RoundSettingsState, roundIndex: number): boolean {
  return mostGames(state, roundIndex) > MAX_GAME_BOXES;
}

/** What a game box is called: 'Game 2', and 'Game 9 and after' for the last box of a round with more games than boxes. */
function gameBoxLabel(number: number, beyondBoxes: boolean): string {
  return beyondBoxes && number === MAX_GAME_BOXES ? `Game ${number} and after` : `Game ${number}`;
}

/** What the editor calls a row: the round's name, marked when no round of the schedule has it now. */
export function roundNoteRowLabel(row: RoundNoteRow): string {
  return row.orphan ? `${row.name} · not in the schedule` : (row.shown ?? row.name);
}

/** What the editor calls a game row: 'Game 2', marked when the round has no such game now. */
export function gameNoteRowLabel(row: GameNoteRow): string {
  return row.orphan ? `${row.label} · not in the schedule` : row.label;
}

/** The note of the round with this name, trimmed; '' for none. */
export function roundNote(notes: RoundNotes | undefined, name: string): string {
  const note = notes && Object.hasOwn(notes, name) ? notes[name] : '';
  return typeof note === 'string' ? note.trim() : '';
}

/** The game rows of a round: one per game box, then the boxes beyond `gameCount` that hold a note or a picture. */
function gameRowsOf(
  name: string,
  gameCount: number,
  info: RoundSettingsInfo,
  beyondBoxes = false,
): GameNoteRow[] {
  const rows: GameNoteRow[] = [];
  for (let number = 1; number <= MAX_GAME_BOXES; number++) {
    const key = gameKey(number);
    const note = textAt(info.gameNotes, name, key);
    const picture = pictureAt(info.notePictures, name, key);
    const scheduled = number <= gameCount;
    if (!scheduled && !note && !picture) continue;
    rows.push({
      key,
      label: gameBoxLabel(number, beyondBoxes && scheduled),
      note,
      ...(picture && { picture }),
      ...(!scheduled && { orphan: true as const }),
    });
  }
  return rows;
}

/** Every round name stored in any of the three maps, in the order they were found. */
function storedNames(info: RoundSettingsInfo): string[] {
  const names = [info.roundNotes, info.gameNotes, info.notePictures].flatMap((map) =>
    entriesOf(map).map(([name]) => name),
  );
  return [...new Set(names)];
}

function hasContent(row: RoundNoteRow): boolean {
  return row.note !== '' || row.picture !== undefined || row.games.length > 0;
}

/**
 * One row per round of the schedule, in order, with a row per game of a round that plays several, then one per
 * stored name that no round has now (when it holds a note, a game note or a picture).
 */
export function roundNoteRows(
  state: RoundSettingsState,
  info: RoundSettingsInfo | undefined,
): RoundNoteRow[] {
  const names = roundNoteNames(state);
  if (names.length === 0) return [];
  const stored = info ?? {};
  const shown = uniqueNames(bracketRoundLabels(state).map(({ label }) => label));
  const rowOf = (name: string, gameCount: number, beyondBoxes = false): RoundNoteRow => {
    const picture = pictureAt(stored.notePictures, name, 'round');
    return {
      name,
      note: roundNote(stored.roundNotes, name),
      ...(picture && { picture }),
      games: gameRowsOf(name, gameCount, stored, beyondBoxes),
    };
  };
  const rows = names.map((name, index): RoundNoteRow => ({
    ...rowOf(name, noteGameCount(state, index), hasGamesBeyondBoxes(state, index)),
    ...(shown[index] !== name && { shown: shown[index] }),
  }));
  for (const name of storedNames(stored)) {
    const row = rowOf(name, 0);
    if (!names.includes(name) && hasContent(row)) rows.push({ ...row, orphan: true });
  }
  return rows;
}

/** What the Bracket shows of a round's settings: its own note and picture, then the games that have either. */
export interface RoundSettings {
  note: string;
  picture?: string;
  /** Only the games with a note or a picture, in order; 'G1', 'G2'… */
  games: Array<{ label: string; name: string; note: string; picture?: string }>;
}

function settingsFor(
  state: RoundSettingsState & Pick<TournamentState, 'info'>,
  name: string,
  roundIndex: number,
): RoundSettings | null {
  const info: RoundSettingsInfo = state.info ?? {};
  const picture = pictureAt(info.notePictures, name, 'round');
  const beyondBoxes = hasGamesBeyondBoxes(state, roundIndex);
  const games = gameRowsOf(name, noteGameCount(state, roundIndex), info, beyondBoxes)
    .filter((row) => !row.orphan && (row.note || row.picture))
    .map(({ key, label, note, picture: gamePicture }) => ({
      label: beyondBoxes && key === gameKey(MAX_GAME_BOXES) ? `G${key.slice(1)}+` : `G${key.slice(1)}`,
      name: label,
      note,
      ...(gamePicture && { picture: gamePicture }),
    }));
  const note = roundNote(info.roundNotes, name);
  if (!note && !picture && games.length === 0) return null;
  return { note, ...(picture && { picture }), games };
}

/** The settings of every round for viewers, index-aligned with `state.rounds`: `null` for a round with nothing at all. */
export function roundSettingsByRound(
  state: RoundSettingsState & Pick<TournamentState, 'info'>,
): Array<RoundSettings | null> {
  return roundNoteNames(state).map((name, index) => settingsFor(state, name, index));
}

/** The settings of the round at `roundIndex` for viewers; `null` when it has nothing at all. */
export function roundSettingsOf(
  state: RoundSettingsState & Pick<TournamentState, 'info'>,
  roundIndex: number,
): RoundSettings | null {
  const name = roundNoteNames(state)[roundIndex];
  return name === undefined ? null : settingsFor(state, name, roundIndex);
}

/** The notes with one changed: blank text deletes it, and an empty map is dropped (`undefined` when nothing is left). Entries that are not text are dropped. */
export function setRoundNote(
  notes: RoundNotes | undefined,
  name: string,
  text: string,
): RoundNotes | undefined {
  const next: RoundNotes = {};
  for (const [stored, note] of storedNotes(notes)) if (stored !== name && note.trim()) next[stored] = note;
  const value = text.trim();
  if (value) next[name] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The info with one note changed. The `roundNotes` key itself is removed, not left empty, when the last note is cleared. */
export function infoWithRoundNote(info: TournamentInfo, name: string, text: string): TournamentInfo {
  const { roundNotes: previous, ...rest } = info;
  const roundNotes = setRoundNote(previous, name, text);
  return roundNotes ? { ...rest, roundNotes } : rest;
}

function textEntries(texts: unknown): Array<[string, string]> {
  return entriesOf(texts).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '',
  );
}

/**
 * The game notes with one changed: blank text deletes it, a round left without game notes is dropped, and so is an
 * empty map (`undefined` when nothing is left). Entries that are not text are dropped.
 */
export function setGameNote(
  notes: GameNotes | undefined,
  name: string,
  key: string,
  text: string,
): GameNotes | undefined {
  const next: GameNotes = {};
  for (const [round, texts] of entriesOf(notes)) {
    const kept = textEntries(texts).filter(([stored]) => round !== name || stored !== key);
    if (kept.length > 0) next[round] = Object.fromEntries(kept);
  }
  const value = text.trim();
  if (value) next[name] = { ...next[name], [key]: value };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The info with one game note changed. The `gameNotes` key itself is removed, not left empty, when the last note is cleared. */
export function infoWithGameNote(
  info: TournamentInfo,
  name: string,
  key: string,
  text: string,
): TournamentInfo {
  const { gameNotes: previous, ...rest } = info;
  const gameNotes = setGameNote(previous, name, key, text);
  return gameNotes ? { ...rest, gameNotes } : rest;
}

/**
 * `entries` with the keys in `renames` moved to their new names, all at once (so "Round 4" to "Round 5" and
 * "Round 5" to "Round 6" never collide). A name that is not renamed and already holds something keeps it: the moved
 * entry is dropped rather than overwrite it. `merge` joins two values under one name (the moved one under the kept).
 */
function withRenamedKeys<T>(
  entries: Array<[string, T]>,
  renames: ReadonlyMap<string, string>,
  merge: (kept: T, moved: T) => T,
): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [name, value] of entries) if (!renames.has(name)) next[name] = value;
  for (const [name, value] of entries) {
    const target = renames.get(name);
    if (target === undefined) continue;
    next[target] = Object.hasOwn(next, target) ? merge(next[target], value) : value;
  }
  return next;
}

/**
 * The info with rounds renamed (`renames` is old name to new name): the round notes and the game notes move to
 * the new names with their round. A name that is not itself renamed keeps the note it already has (the moved
 * one is dropped); a game box it leaves empty takes the moved one. Pictures are server-owned and move there
 * (`renameNotePictureRounds`).
 */
export function infoWithRenamedRounds(
  info: TournamentInfo,
  renames: ReadonlyMap<string, string>,
): TournamentInfo {
  if (renames.size === 0) return info;
  const { roundNotes, gameNotes, ...rest } = info;
  const movedNotes =
    roundNotes && Object.keys(roundNotes).length > 0
      ? withRenamedKeys(storedNotes(roundNotes), renames, (kept, moved) => (kept.trim() ? kept : moved))
      : undefined;
  const movedGameNotes =
    gameNotes && Object.keys(gameNotes).length > 0
      ? withRenamedKeys(
          entriesOf(gameNotes).map(([round, texts]): [string, Record<string, string>] => [
            round,
            Object.fromEntries(textEntries(texts)),
          ]),
          renames,
          (kept, moved) => ({ ...moved, ...kept }),
        )
      : undefined;
  return {
    ...rest,
    ...(movedNotes && { roundNotes: movedNotes }),
    ...(movedGameNotes && { gameNotes: movedGameNotes }),
  };
}
