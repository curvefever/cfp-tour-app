import { absentInRoom } from './absences';
import { type RoundOutcome, roomOutcomes, roundHasBegun } from './advancement';
import type { TournamentState } from './types';

type NamedOutcome = RoundOutcome & { name: string };

/** Who holds a seat now, and whether its unit was removed: the two questions a group's past matches ask of the names recorded in their rooms. */
export interface GroupSeats {
  holderOf: (name: string) => string;
  isRemoved: (name: string) => boolean;
}

/** The switch for the group stage's per-match standings: asked by `computeGroupStandings`, nowhere else. */
export function usesGroupAverages(state: Pick<TournamentState, 'gamemodeConfig'>): boolean {
  return state.gamemodeConfig.groupAverageVersion === 2;
}

/**
 * A room of a past round still names the unit that played it. A swap hands that seat's line to the replacement
 * (`WithdrawnUnit.replacedBy`, followed through further swaps); a removal takes the unit, and so its matches, out of
 * the group.
 */
export function groupSeats(state: Pick<TournamentState, 'withdrawnUnits'>): GroupSeats {
  const successors = new Map<string, string>();
  const removed = new Set<string>();
  for (const unit of state.withdrawnUnits) {
    if (unit.reason === 'removed') removed.add(unit.name);
    else if (unit.replacedBy !== undefined) successors.set(unit.name, unit.replacedBy);
  }
  const holderOf = (name: string) => {
    let holder = name;
    for (let step = 0; step <= successors.size && successors.has(holder); step += 1) {
      holder = successors.get(holder) ?? holder;
    }
    return holder;
  };
  return { holderOf, isRemoved: (name) => removed.has(holderOf(name)) };
}

/** A no-show's match: counted, worth nothing whatever the points table, with no score and no room share. */
function absenceOutcome(roundIndex: number, name: string): NamedOutcome {
  return { name, roundIndex, score: null, rank: null, points: 0, bye: false, share: null };
}

/**
 * What one group room gives each line, under the per-match rules. A room that lost a unit (a removal, in this round
 * or an earlier one) is void for the other unit, whatever was typed. A room with an absent unit is void for the unit
 * that turned up and a counted 0 for the one that did not (both, if both did not). Any other room is played as
 * usual. A bye is no room at all, so it gives nothing. Names are the seat's holder today.
 * `heldBack` is a live round's room not fully scored yet.
 */
export function groupRoomOutcomes(
  state: TournamentState,
  roundIndex: number,
  room: number,
  seats: GroupSeats,
  heldBack: boolean,
): NamedOutcome[] {
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room);
  if (seated.length < 2 || seated.some((entry) => seats.isRemoved(entry.name))) return [];
  const absent = roundHasBegun(state, roundIndex) ? absentInRoom(state, roundIndex, room) : [];
  if (absent.length > 0) return absent.map((name) => absenceOutcome(roundIndex, seats.holderOf(name)));
  if (heldBack) return [];
  return roomOutcomes(state, roundIndex, room).map((outcome) => ({
    ...outcome,
    name: seats.holderOf(outcome.name),
  }));
}
