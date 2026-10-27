import { bracketRoundLabels, storedRoundLabels } from './bracket';
import type { RoundNotes, TournamentInfo, TournamentState } from './types';

export interface RoundNoteRow {
  name: string;
  /** The name the Bracket shows, when it differs from the stored one (a double elimination numbers by column). */
  shown?: string;
  /** The stored text, '' when there is none. */
  note: string;
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

/** The stored notes that are text: a value of another shape (the stage notes of an earlier build) is no note. */
function storedNotes(notes: RoundNotes | undefined): Array<[string, string]> {
  return Object.entries(notes ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

/** What the editor calls a row: the round's name, marked when no round of the schedule has it now. */
export function roundNoteRowLabel(row: RoundNoteRow): string {
  return row.orphan ? `${row.name} · not in the schedule` : (row.shown ?? row.name);
}

/** The note of the round with this name, trimmed; '' for none. */
export function roundNote(notes: RoundNotes | undefined, name: string): string {
  const note = notes && Object.hasOwn(notes, name) ? notes[name] : '';
  return typeof note === 'string' ? note.trim() : '';
}

/** One row per round of the schedule, in order, then one per stored name that no round has now. */
export function roundNoteRows(
  state: Pick<TournamentState, 'rounds'>,
  notes: RoundNotes | undefined,
): RoundNoteRow[] {
  const names = roundNoteNames(state);
  if (names.length === 0) return [];
  const shown = uniqueNames(bracketRoundLabels(state).map(({ label }) => label));
  const rows = names.map((name, index): RoundNoteRow => ({
    name,
    note: roundNote(notes, name),
    ...(shown[index] !== name && { shown: shown[index] }),
  }));
  for (const [name, note] of storedNotes(notes)) {
    if (!names.includes(name) && note.trim()) rows.push({ name, note: note.trim(), orphan: true });
  }
  return rows;
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
