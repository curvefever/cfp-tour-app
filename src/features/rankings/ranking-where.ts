import type { bracketRoundLabels } from '../../domain/tournament/bracket';
import type { ActiveRanking, EliminatedRanking, FinalistRanking } from '../../domain/tournament/rankings';
import { standingsKind } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { ordinal } from '../../lib/ordinal';
import { standingsNames } from '../standings/standings-names';
import { destinationLabel } from '../bracket/exit-text';
import { placeInRoom } from '../bracket/folded-round';
import { roomTitle } from '../bracket/room-title';

type Labels = ReturnType<typeof bracketRoundLabels>;

/** What Rankings says of a unit that withdrew after playing (it is listed last, with no stripe). */
export const WITHDRAWN_WHERE = 'Withdrawn';

/** "Quarters · Room B": the round and the room, or just the round when the room's title is the round's own ("Final"). */
function roundAndRoom(state: TournamentState, roundIndex: number, room: number, labels: Labels): string {
  const roundName = destinationLabel(roundIndex, labels);
  const title = roomTitle(state.rounds[roundIndex], room - 1);
  return title === roundName ? roundName : `${roundName} · ${title}`;
}

/**
 * Where a unit that is still in stands: its room in the last drawn round and, once every score of the room is in,
 * its place there ("Quarters · Room B · 2nd"); "Waiting for Semis" while it sits in the pool of a round that is not
 * drawn yet; "Round 3 · Bye" when it sits the round out.
 */
export function stillInWhere(
  state: TournamentState,
  lastRoundIndex: number,
  entry: ActiveRanking,
  labels: Labels,
): string {
  if (entry.waitingFor !== undefined) return `Waiting for ${destinationLabel(entry.waitingFor, labels)}`;
  if (entry.room === null) return `${destinationLabel(lastRoundIndex, labels)} · Bye`;
  const where = roundAndRoom(state, lastRoundIndex, entry.room, labels);
  const place = placeInRoom(state, lastRoundIndex, entry.room, entry.name);
  return place === null ? where : `${where} · ${ordinal(place)}`;
}

/**
 * Where an eliminated unit went out: the room and its place there ("Quarters · Room B · 7th"), or, when the cut of
 * the standings sent it out, its place in them, named as the standings tab is ("Qualification · #25", "Swiss · #25")
 * or by its group ("Group B · #3").
 */
export function eliminatedWhere(state: TournamentState, entry: EliminatedRanking, labels: Labels): string {
  if (entry.atCut && entry.poolRank) {
    const { groupLabel, rank } = entry.poolRank;
    const kind = standingsKind(state);
    const table = groupLabel ? `Group ${groupLabel}` : kind ? standingsNames(kind).title : 'Standings';
    return `${table} · #${rank}`;
  }
  return `${roundAndRoom(state, entry.ri, entry.seat, labels)} · ${ordinal(entry.place)}`;
}

/** Where a finalist ended: "Final · 1st" (level totals share a place). */
export function finalistWhere(lastRoundIndex: number, entry: FinalistRanking, labels: Labels): string {
  return `${destinationLabel(lastRoundIndex, labels)} · ${ordinal(entry.rank)}`;
}
