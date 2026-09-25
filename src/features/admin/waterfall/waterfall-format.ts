import { ELIMINATED } from '../../../domain/tournament/waterfall-bracket';
import {
  compressWaterfallRanks,
  type WaterfallDraft,
  type WaterfallDraftRound,
  type WaterfallFlowEdge,
  type WaterfallIntake,
  type WaterfallSlot,
} from '../../../domain/tournament/waterfall-draft';

const ROUND_COLORS = ['#b57bff', '#ffb830', '#00e096', '#00e5ff', '#ff7ab8', '#7aa8ff'];
const ELIMINATED_COLOR = '#6b7891';
export const UNSET_COLOR = '#ff4d6a';

/** A slot's colour follows where it goes: one colour per round, grey for eliminated, red while unset. */
export function destinationColor(draft: WaterfallDraft, destination: string | null): string {
  if (destination === null) return UNSET_COLOR;
  if (destination === ELIMINATED) return ELIMINATED_COLOR;
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

export function destinationName(destination: string): string {
  return destination === ELIMINATED ? 'out' : destination;
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
