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

/**
 * The setup with its graph marked as numbered from the current first number, when the graph has a default name
 * ("Round 4") to number: the first save of such a graph sets it, and a graph saved before this existed has none, so it
 * is never renumbered until then.
 */
export function withWaterfallNumbering(setup: PersistedSetup, entrantCount: number): PersistedSetup {
  if (setup.scheduleLogic !== 'waterfall-bracket') return setup;
  const draft = draftOfSetup(setup);
  if (!draft) return setup;
  if (!hasDefaultRoundNames(draft)) return setup;
  const first = waterfallFirstRoundNumber(setup, entrantCount);
  return { ...setup, waterfallNumberedFrom: String(first) };
}
