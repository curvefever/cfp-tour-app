import { computeRankings } from './rankings';
import type { TournamentState } from './types';

/** The places a ranking room decides, as Rankings numbers them. */
export interface RankingRoomPlaces {
  /** Each numbered unit's place (units level on a place share it). */
  byName: ReadonlyMap<string, number>;
  /** The places of each room (1-based), first to last, for the room's "Places 17–22" line. */
  byRoom: ReadonlyMap<number, { first: number; last: number }>;
}

/**
 * The places of the units that went out of a ranking round, taken from `computeRankings` and never worked out a
 * second time, so the Bracket and Rankings always agree. Rankings gives a unit its number once the round is sent
 * on (before that other rooms may still be playing): null until then, and for a round that is not a ranking round.
 */
export function rankingRoomPlaces(state: TournamentState, roundIndex: number): RankingRoomPlaces | null {
  if (!state.rounds[roundIndex]?.waterfallRanking) return null;
  const byName = new Map<string, number>();
  const byRoom = new Map<number, { first: number; last: number }>();
  for (const unit of computeRankings(state)?.eliminatedList ?? []) {
    if (unit.ri !== roundIndex || unit.rank === null) continue;
    byName.set(unit.name, unit.rank);
    const range = byRoom.get(unit.seat);
    byRoom.set(unit.seat, {
      first: Math.min(range?.first ?? unit.rank, unit.rank),
      last: Math.max(range?.last ?? unit.rank, unit.rank),
    });
  }
  return byName.size > 0 ? { byName, byRoom } : null;
}

/** "Places 17–22", "Place 17" for a single one. */
export function placesLine(range: { first: number; last: number }): string {
  return range.first === range.last ? `Place ${range.first}` : `Places ${range.first}–${range.last}`;
}
