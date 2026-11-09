import {
  ELIMINATED,
  QUAL_LABEL,
  type StandingsSourceKind,
} from '../../../domain/tournament/waterfall-bracket';
import {
  compressWaterfallRanks,
  type WaterfallDraft,
  type WaterfallDraftRound,
  type WaterfallFlowEdge,
  type WaterfallIntake,
  type WaterfallSlot,
} from '../../../domain/tournament/waterfall-draft';

const ROUND_COLORS = [
  'var(--color-cfp-purple)',
  'var(--color-cfp-yellow)',
  'var(--color-cfp-green)',
  'var(--color-cfp-sky)',
  'var(--color-cfp-orange)',
  'var(--color-cfp-teal)',
];
const ELIMINATED_COLOR = 'var(--color-cfp-red)';

/** A slot's colour (a CSS colour value from the palette) follows where it goes: one per round, red for out (eliminated, or no destination). */
export function destinationColor(draft: WaterfallDraft, destination: string | null): string {
  if (destination === null || destination === ELIMINATED) return ELIMINATED_COLOR;
  const index = draft.rounds.findIndex((round) => round.label === destination);
  return ROUND_COLORS[Math.max(index, 0) % ROUND_COLORS.length];
}

export function slotKey(room: number, rank: number): string {
  return `${room}:${rank}`;
}

export function parseSlotKey(key: string): WaterfallSlot {
  const [room, rank] = key.split(':').map(Number);
  return { room, rank };
}

/** The name shown for the Qual source of a graph. */
export const QUAL_DISPLAY_NAME = 'Qualification table';
/** The name shown for the Groups source of a graph. */
export const GROUPS_DISPLAY_NAME = 'Groups';

/** The name shown for the Qual source of a graph that follows a Swiss. */
export const SWISS_DISPLAY_NAME = 'Swiss standings';

/** The name of the pooling exit a graph is fed by: the qualification table, the Swiss standings, or the groups. */
export function standingsSourceName(kind: StandingsSourceKind | undefined, afterSwiss?: boolean): string {
  if (kind === 'groups') return GROUPS_DISPLAY_NAME;
  return afterSwiss ? SWISS_DISPLAY_NAME : QUAL_DISPLAY_NAME;
}

/** A flow edge's source: a round label, or the pooling exit (the qualification table or the groups). */
export function sourceName(source: string, kind?: StandingsSourceKind, afterSwiss?: boolean): string {
  return source === QUAL_LABEL ? standingsSourceName(kind, afterSwiss) : source;
}

/** Consecutive ranks with the same label, as "1–3 Group winners · 4–6 Runners-up" (blank labels left out). */
export function describeRankLabels(labels: readonly string[]): string {
  const runs: Array<{ label: string; first: number; last: number }> = [];
  labels.forEach((label, index) => {
    const run = runs[runs.length - 1];
    if (run && run.label === label) run.last = index + 1;
    else runs.push({ label, first: index + 1, last: index + 1 });
  });
  return runs
    .filter(({ label }) => label !== '')
    .map(({ label, first, last }) => `${first === last ? first : `${first}–${last}`} ${label}`)
    .join(' · ');
}

/** A destination as shown to the organiser: a round label, or "out" for a null or eliminated one. */
export function destinationName(destination: string | null): string {
  return destination === null || destination === ELIMINATED ? 'out' : destination;
}

/** [1,2,3,5] becomes "1–3, 5". */
export function formatRanks(ranks: number[]): string {
  return compressWaterfallRanks(ranks).join(', ').replace(/-/g, '–');
}

/** "ranks 1–3 of each room" when every room sends the same ranks along an edge, otherwise a generic note. */
export function describeFlowEdge(edge: WaterfallFlowEdge, roomCount: number): string {
  const perRoom = Array.from({ length: roomCount }, (_, room) => formatRanks(edge.ranksByRoom[room] ?? []));
  if (perRoom.every((ranks) => ranks === perRoom[0])) {
    return `ranks ${perRoom[0]}${roomCount > 1 ? ' of each room' : ''}`;
  }
  return 'ranks differ by room';
}

export interface RoundIntakeBadge {
  text: string;
  state: 'ok' | 'bad' | 'neutral';
}

/**
 * "receives / needs" for one round. The starting round is compared with the
 * players entering the bracket, which may not be known yet.
 */
export function roundIntakeBadge(
  round: WaterfallDraftRound,
  intake: WaterfallIntake,
  entrantCount: number | null,
): RoundIntakeBadge {
  const needs = round.roomCount * round.roomSize;
  if (intake.startingRound === round.label) {
    if (entrantCount === null) return { text: String(needs), state: 'neutral' };
    return { text: `${entrantCount} / ${needs}`, state: entrantCount === needs ? 'ok' : 'bad' };
  }
  const receives = intake.incoming[round.label] ?? 0;
  return { text: `${receives} / ${needs}`, state: receives === needs ? 'ok' : 'bad' };
}
