/**
 * The "Best of a place" line in the editor's draft: `R4.BEST: 1 OF 6->R5` is `best.R4 = { place: 6, count: 1,
 * destination: 'R5' }`. The helpers here only reshape that record when the rest of the draft changes (a rename, a
 * removed round, a resize); the engine's own checks, in `waterfall-best.ts`, decide whether the line is valid.
 */

export interface WaterfallDraftBest {
  /** The place of each room it picks from, 1-based. */
  place: number;
  /** How many of those go to the destination. */
  count: number;
  /** A round label. */
  destination: string;
}

/** The BEST lines of a draft by the label of the round they belong to. */
export type WaterfallDraftBests = Record<string, WaterfallDraftBest>;

/** A draft with its BEST lines set, or without the field when there is none. */
export function withBests<T extends { best?: WaterfallDraftBests }>(
  draft: T,
  best: WaterfallDraftBests | undefined,
): T {
  const { best: _previous, ...rest } = draft;
  return (best && Object.keys(best).length > 0 ? { ...rest, best } : rest) as T;
}

/**
 * The lines after an edit: each one goes through `change`, which returns the line to keep or null to drop it, and
 * `relabel` renames the round a line belongs to.
 */
export function mapBests(
  best: WaterfallDraftBests | undefined,
  change: (label: string, line: WaterfallDraftBest) => WaterfallDraftBest | null,
  relabel: (label: string) => string = (label) => label,
): WaterfallDraftBests | undefined {
  const next: WaterfallDraftBests = {};
  for (const [label, line] of Object.entries(best ?? {})) {
    const kept = change(label, line);
    if (kept) next[relabel(label)] = kept;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The lines of a draft whose round was resized: dropped when the place is past the room or one room is left, the count kept under the rooms. */
export function fittedBests(
  best: WaterfallDraftBests | undefined,
  label: string,
  roomCount: number,
  roomSize: number,
): WaterfallDraftBests | undefined {
  return mapBests(best, (own, line) => {
    if (own !== label) return line;
    if (roomCount < 2 || line.place > roomSize) return null;
    return { ...line, count: Math.min(line.count, roomCount - 1) };
  });
}

/** The ROUTES line of a round's BEST: `R4.BEST: 1 OF 6->R5`. */
export function bestLine(label: string, line: WaterfallDraftBest): string {
  return `${label}.BEST: ${line.count} OF ${line.place}->${line.destination}`;
}

/** The lines after rounds were renamed (`renamed` gives a label's new name): the round and the destination both follow. */
export function renamedBests(
  best: WaterfallDraftBests | undefined,
  renamed: (label: string) => string,
): WaterfallDraftBests | undefined {
  return mapBests(best, (_label, line) => ({ ...line, destination: renamed(line.destination) }), renamed);
}

/** The lines after a round was removed: its own is gone, and so is any that sent units to it. */
export function bestsWithoutRound(
  best: WaterfallDraftBests | undefined,
  removed: string,
): WaterfallDraftBests | undefined {
  return mapBests(best, (label, line) => (label === removed || line.destination === removed ? null : line));
}

/** The lines after a round became the Final or a ranking match: its own line is gone; a line that sends units to it stays, for the engine to judge. */
export function bestsWithoutOwnLine(
  best: WaterfallDraftBests | undefined,
  label: string,
): WaterfallDraftBests | undefined {
  return mapBests(best, (own, line) => (own === label ? null : line));
}
