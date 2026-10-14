import { exitBandAtRank, type RoomExitBand, type RoundExitRule } from '../../domain/tournament/room-exits';
import type { RowResult } from '../tournament/components/result-row';

export interface RoomRowInput {
  /** The round's exit rule: only a per-room rule gives a row a result of its own. */
  rule: RoundExitRule;
  /** The bands of this row's room (empty unless the rule is per-room). */
  bands: RoomExitBand[];
  /** The row's place in its room, 1-based. */
  rank: number;
  /** Named among the lucky losers of the round after this one (known once this round is advanced). */
  lucky: boolean;
  /** In a room tie that is not resolved yet. */
  pendingTie: boolean;
  /** Every unit of the room has a score. */
  roomComplete: boolean;
  /** The round has been advanced past (it is not the current round any more). */
  roundDecided: boolean;
}

export interface RoomRowResult {
  result: RowResult;
  /** The star after the name: a decided lucky loser, or a candidate while the round is still being played. */
  star: 'lucky' | 'candidate' | null;
}

/**
 * The first destination of a room's advance bands reads green, the second yellow, the third and later purple
 * (the same colours as the standings column's destination groups).
 */
export function advanceResult(bands: RoomExitBand[], destination: number): RowResult {
  const destinations: number[] = [];
  for (const band of bands) {
    if (band.kind === 'advance' && !destinations.includes(band.destination))
      destinations.push(band.destination);
  }
  const position = destinations.indexOf(destination);
  if (position <= 0) return 'advance';
  return position === 1 ? 'advance-second' : 'advance-third';
}

function bandResult(
  band: RoomExitBand | null,
  bands: RoomExitBand[],
  { lucky, roundDecided }: Pick<RoomRowInput, 'lucky' | 'roundDecided'>,
): RoomRowResult {
  if (!band) return { result: 'eliminate', star: null };
  switch (band.kind) {
    case 'advance':
      return { result: advanceResult(bands, band.destination), star: null };
    case 'lucky-chance':
      if (!roundDecided) return { result: 'candidate', star: 'candidate' };
      if (lucky) return { result: 'lucky', star: 'lucky' };
      return { result: band.otherwise === 'eliminate' ? 'eliminate' : 'drop', star: null };
    default:
      // drop, eliminate, promote, stay and demote read as their own kinds.
      return { result: band.kind, star: null };
  }
}

/**
 * What a row of a room card shows beside its name. Pooling rooms have no result of their own (the standings
 * carry it), so no stripe; a room still being scored is undecided for everyone; a room tie nobody has resolved
 * is pending; otherwise the row's band decides. Lucky-loser candidates stay undecided (with a star) until the
 * round is advanced.
 */
export function roomRowResult(input: RoomRowInput): RoomRowResult {
  const { bands, pendingTie, rank, roomComplete, rule } = input;
  if (rule.kind !== 'per-room') return { result: '', star: null };
  if (!roomComplete) return { result: 'undecided', star: null };
  if (pendingTie) return { result: 'pending', star: null };
  return bandResult(exitBandAtRank(bands, rank), bands, input);
}
