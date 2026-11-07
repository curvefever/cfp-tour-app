import { roundsBeforeBracket } from './pooling-rounds';
import type { PersistedSetup } from './types';
import type { StandingsSourceKind } from './waterfall-bracket';
import {
  defaultNameShift,
  hasDefaultRoundNames,
  parseWaterfallDraft,
  renameWaterfallRounds,
  serializeWaterfallDraft,
  type WaterfallDraft,
} from './waterfall-draft';

type NumberingSetup = Pick<
  PersistedSetup,
  | 'scheduleLogic'
  | 'poolingPhase'
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'groupSize'
  | 'roundRobinMode'
  | 'waterfallGraph'
  | 'waterfallNumberedFrom'
>;

/** Which pooling exit feeds a Custom bracket graph: a qualification table (Qual line), a group stage (Groups line), or neither (or not a Custom bracket). */
export function standingsKindOfSetup(
  setup: Pick<PersistedSetup, 'scheduleLogic' | 'poolingPhase'>,
): StandingsSourceKind | null {
  if (setup.scheduleLogic !== 'waterfall-bracket') return null;
  if (setup.poolingPhase === 'qual-table') return 'qual';
  return setup.poolingPhase === 'group-stage' ? 'groups' : null;
}

/** The number the first round of the Custom bracket gets: the one after the pooling rounds played before it (`entrantCount` is the units registered). */
export function waterfallFirstRoundNumber(setup: NumberingSetup, entrantCount: number): number {
  return roundsBeforeBracket(setup, entrantCount) + 1;
}

function draftOfSetup(setup: NumberingSetup): WaterfallDraft | null {
  const kind = standingsKindOfSetup(setup);
  const parsed = parseWaterfallDraft(setup.waterfallGraph, {
    ...(kind ? { standingsSource: true, standingsKind: kind } : {}),
  });
  return parsed.ok && parsed.value.rounds.length > 0 ? parsed.value : null;
}

/** What renumbering the default names writes back: the graph text, the number it is numbered from now, and the renames to carry the notes and pictures. */
export interface WaterfallRenumbering {
  graph: string;
  numberedFrom: string;
  renames: Map<string, string>;
}

/**
 * The renumbering a Custom bracket's default round names need, or null when none does: the graph is numbered
 * (`waterfallNumberedFrom`), has rounds, reads, and its first number differs from the one the pooling rounds now
 * give. Every default name shifts by the difference, in one step (`defaultNameShift`); a shift that can't be made
 * whole leaves the names as they are and only moves the number on, so it is not tried again until the pooling changes.
 */
export function renumberWaterfallDefaults(
  setup: NumberingSetup,
  entrantCount: number,
): WaterfallRenumbering | null {
  if (setup.scheduleLogic !== 'waterfall-bracket') return null;
  // A group stage's rounds come from the head count: with none known yet, the numbering waits for the roster.
  if (setup.poolingPhase === 'group-stage' && entrantCount <= 0) return null;
  const from = Number.parseInt(setup.waterfallNumberedFrom, 10);
  if (!Number.isFinite(from)) return null;
  const to = waterfallFirstRoundNumber(setup, entrantCount);
  if (from === to) return null;
  const draft = draftOfSetup(setup);
  if (!draft) return null;
  const renames = defaultNameShift(draft, from, to);
  const graph =
    renames.size > 0 ? serializeWaterfallDraft(renameWaterfallRounds(draft, renames)) : setup.waterfallGraph;
  return { graph, numberedFrom: String(to), renames };
}

/** Whether the graph already has a number its default names are numbered from. */
export function isWaterfallNumbered(setup: Pick<PersistedSetup, 'waterfallNumberedFrom'>): boolean {
  return Number.isFinite(Number.parseInt(setup.waterfallNumberedFrom, 10));
}

/**
 * The setup with its graph marked as numbered from the current first number, when it is not numbered yet and the graph
 * has a default name ("Round 4") to number: the first save of such a graph sets it, once. A graph saved before this
 * existed has none, so it is never renumbered until then; a numbered graph keeps its number (only a renumbering moves
 * it), so a graph edited while the head count is unknown is not re-marked with the number of an empty roster.
 */
export function withWaterfallNumbering(setup: PersistedSetup, entrantCount: number): PersistedSetup {
  if (setup.scheduleLogic !== 'waterfall-bracket' || isWaterfallNumbered(setup)) return setup;
  const draft = draftOfSetup(setup);
  if (!draft || !hasDefaultRoundNames(draft)) return setup;
  return { ...setup, waterfallNumberedFrom: String(waterfallFirstRoundNumber(setup, entrantCount)) };
}

/** The graph and numbering a Setup edit rewrites, and the renames to carry the notes and pictures along. */
export interface NumberingAfterEdit {
  fields: Partial<Pick<PersistedSetup, 'waterfallGraph' | 'waterfallNumberedFrom'>>;
  renames: Map<string, string>;
}

/**
 * What a Setup edit made in this tab does to the graph's numbering: it renumbers the default names when the edit moved
 * the first number, and marks a graph whose text the edit changed (see `withWaterfallNumbering`). The numbering is a
 * consequence of a local edit, never of a Setup that arrives from another tab, which arrives already renumbered.
 */
export function numberingAfterEdit(
  before: PersistedSetup,
  after: PersistedSetup,
  entrantCount: number,
): NumberingAfterEdit {
  const renumbering = renumberWaterfallDefaults(after, entrantCount);
  if (renumbering) {
    return {
      fields: { waterfallGraph: renumbering.graph, waterfallNumberedFrom: renumbering.numberedFrom },
      renames: renumbering.renames,
    };
  }
  if (after.waterfallGraph === before.waterfallGraph) return { fields: {}, renames: new Map() };
  const marked = withWaterfallNumbering(after, entrantCount);
  const fields = marked === after ? {} : { waterfallNumberedFrom: marked.waterfallNumberedFrom };
  return { fields, renames: new Map() };
}
