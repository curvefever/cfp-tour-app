import { exitBandAtRank, type RoomExitBand, type RoundExitRule } from '../../domain/tournament/room-exits';
import type { TournamentRound } from '../../domain/tournament/types';
import { destinationGroupResult, type RowResult } from '../tournament/components/result-row';

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
  /** The row's unit was absent: what becomes of it (see `absenteeFate`). Its `rank` is then its place after every present unit. */
  absentee?: AbsenteeFate;
}

/** What becomes of an absentee: a custom bracket and Kings Valley route it by its rank (last of its room; a v2 custom bracket cuts one whose seat does not lead where the room's last place goes), a winners round drops it to the losers bracket, every other round cuts it. */
export type AbsenteeFate = 'rank' | 'drop' | 'eliminate';

export function absenteeFate(
  round: Pick<TournamentRound, 'bracket' | 'isWaterfall' | 'isKingsValley'>,
  leavesCustomBracket = false,
): AbsenteeFate {
  if (round.bracket === 'winners') return 'drop';
  if (round.isWaterfall && leavesCustomBracket) return 'eliminate';
  return round.isWaterfall || round.isKingsValley ? 'rank' : 'eliminate';
}

export interface RoomRowResult {
  result: RowResult;
  /** The star after the name: a decided lucky loser, or a candidate while the round is still being played. */
  star: 'lucky' | 'candidate' | null;
}

/**
 * An advance band reads green, yellow or purple by its destination's group in the column (`exit-groups.ts`): the
 * same colour in every room of the column, and the same as the standings column's destination groups. A band to a
 * ranking round is neutral: the units play for places.
 */
export function advanceResult(band: Extract<RoomExitBand, { kind: 'advance' }>): RowResult {
  return band.placement ? 'advance-placement' : destinationGroupResult(band.group);
}

function bandResult(
  band: RoomExitBand | null,
  { lucky, roundDecided }: Pick<RoomRowInput, 'lucky' | 'roundDecided'>,
): RoomRowResult {
  if (!band) return { result: 'eliminate', star: null };
  switch (band.kind) {
    case 'advance':
      return { result: advanceResult(band), star: null };
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
  if (input.absentee === 'drop') return { result: 'drop', star: null };
  if (input.absentee === 'eliminate') return { result: 'eliminate', star: null };
  if (pendingTie) return { result: 'pending', star: null };
  return bandResult(exitBandAtRank(bands, rank), input);
}
