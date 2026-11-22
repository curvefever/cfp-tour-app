import { QUAL_LABEL } from './waterfall-bracket';
import type { WaterfallDraft } from './waterfall-draft';

/**
 * The wins a band carries in the editor's draft: `Semi A: 1->Final WINS 1` is
 * `wins.Final['Semi A.0'] = 1`. Only a typed value is held; a band with none takes the default by column
 * (`waterfall-wins.ts`) and stays untyped in the text. The helpers here keep the record in step when the rest of the
 * draft changes (a rename, a removed round, a rerouted slot); the engine's own checks decide whether it is valid.
 */

/** The typed wins by destination round label, then by the source of the band (`sourceKey`). */
export type WaterfallDraftWins = Record<string, Record<string, number>>;

/** The key of a band's source: the round's label and its 0-based room (`Semi A.0`), or `Qual` for the standings line, whatever it is called. */
export function winsSourceKey(label: string, roomIndex: number): string {
  return label === QUAL_LABEL ? QUAL_LABEL : `${label}.${roomIndex}`;
}

/** The label a source key belongs to, and its room (0 for the standings line). */
function splitSourceKey(key: string): { label: string; roomIndex: number } {
  if (key === QUAL_LABEL) return { label: QUAL_LABEL, roomIndex: 0 };
  const dot = key.lastIndexOf('.');
  return { label: key.slice(0, dot), roomIndex: Number.parseInt(key.slice(dot + 1), 10) };
}

/** A draft with its typed wins set, or without the field when there are none. */
export function withWins<T extends { wins?: WaterfallDraftWins }>(
  draft: T,
  wins: WaterfallDraftWins | undefined,
): T {
  const { wins: _previous, ...rest } = draft;
  return (wins && Object.keys(wins).length > 0 ? { ...rest, wins } : rest) as T;
}

/** The typed wins of the band from `sourceKey` into `destination`, undefined when it has none. */
export function typedWins(
  draft: Pick<WaterfallDraft, 'wins'>,
  destination: string,
  sourceKey: string,
): number | undefined {
  return draft.wins?.[destination]?.[sourceKey];
}

/** The wins after rounds were renamed (`renamed` gives a label's new name): the destination and the source follow. */
export function renamedWins(
  wins: WaterfallDraftWins | undefined,
  renamed: (label: string) => string,
): WaterfallDraftWins | undefined {
  if (!wins) return undefined;
  const next: WaterfallDraftWins = {};
  for (const [destination, bySource] of Object.entries(wins)) {
    next[renamed(destination)] = Object.fromEntries(
      Object.entries(bySource).map(([key, value]) => {
        const { label, roomIndex } = splitSourceKey(key);
        return [winsSourceKey(renamed(label), roomIndex), value];
      }),
    );
  }
  return next;
}

/** Whether a band from the source into the destination exists in the draft. */
function hasBand(draft: WaterfallDraft, destination: string, key: string): boolean {
  const { label, roomIndex } = splitSourceKey(key);
  const slots = label === QUAL_LABEL ? draft.qualRoutes : draft.routes[label]?.[roomIndex];
  return slots?.includes(destination) ?? false;
}

/**
 * The draft with every typed value that no longer belongs to a band into a WINS round dropped: the round was
 * removed or no longer plays WINS, or the slots that sent units along the band were rerouted, resized or removed.
 */
export function settleWins<T extends WaterfallDraft>(draft: T): T {
  const kept: WaterfallDraftWins = {};
  for (const [destination, bySource] of Object.entries(draft.wins ?? {})) {
    const round = draft.rounds.find((candidate) => candidate.label === destination);
    if (round?.match?.kind !== 'wins') continue;
    const bands = Object.entries(bySource).filter(([key]) => hasBand(draft, destination, key));
    if (bands.length > 0) kept[destination] = Object.fromEntries(bands);
  }
  return withWins(draft, kept);
}

/** Types the wins of one band, or takes the value away (null) so the band takes its default again. */
export function setWaterfallWins(
  draft: WaterfallDraft,
  destination: string,
  sourceKey: string,
  wins: number | null,
): WaterfallDraft {
  const own = { ...(draft.wins?.[destination] ?? {}) };
  if (wins === null) delete own[sourceKey];
  else own[sourceKey] = wins;
  const all = { ...(draft.wins ?? {}), [destination]: own };
  if (Object.keys(own).length === 0) delete all[destination];
  return settleWins(withWins(draft, all));
}
