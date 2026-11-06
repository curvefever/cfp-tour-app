/**
 * A unit marked back from an absence after the round it is in was drawn (`absenceVersion` 3). Nobody is re-drawn: only
 * the returning unit may move, to the room expected to have the fewest players (the likely absentees still counted
 * as missing, the unit itself taken out of its room first). A room with a score, or one that the move would take over the
 * round's largest room or under its smallest, is not used; when nothing is better the unit stays, now counted as present.
 * Players already told their room are not moved for one player. Rooms of 2 (head to head) never lose a unit, so they keep
 * today's draw.
 */
import { clickConfirmation } from './confirmations';
import { roomLetter } from './bracket';
import { lineupMoveCandidates, moveUnitToRoom, roomHasScore } from './lineup-edit';
import { absenceMarks, likelyAbsentees, unitsOfPlayer } from './likely-absentees';
import { unitDisplay } from './roster';
import { roundInPlayOf } from './round-columns';
import { roomChoiceCost } from './seeding';
import type { TournamentState } from './types';

/** `moved` to another room, `stays` in its room (nothing better, or nowhere to go), `scored` its room has scores, `undrawn` it has no room yet. */
export type SeatOutcome = 'moved' | 'stays' | 'scored' | 'undrawn';

export interface SeatResult {
  state: TournamentState;
  outcome: SeatOutcome;
  /** The room the unit is in now (null: undrawn). */
  room: number | null;
}

/** The unit of the player seated in a room of the column in play, with the round and room. */
function seatOf(
  state: TournamentState,
  playerName: string,
): { unit: string; roundIndex: number; room: number } | null {
  for (const unit of unitsOfPlayer(state, playerName)) {
    const roundIndex = roundInPlayOf(state, unit);
    const entry = (state.assignments[roundIndex] ?? []).find((candidate) => candidate.name === unit);
    if (entry && entry.room !== null) return { unit, roundIndex, room: entry.room };
  }
  return null;
}

/** Of the rooms the unit may be in, the one the usual draw measures prefer: the fewest repeat pairs, its own room first on a tie. */
function bestOf(
  state: TournamentState,
  roundIndex: number,
  unit: string,
  own: number,
  rooms: number[],
): number {
  if (rooms.includes(own)) return own;
  const entries = state.assignments[roundIndex] ?? [];
  const weights = {
    roomHistory: state.roomHistory,
    targetRoundIndex: roundIndex,
    diversityWeight: 1,
    balanceWeight: 0,
  };
  const inRoom = new Map(
    rooms.map((room) => [
      room,
      entries.filter((entry) => entry.room === room && entry.name !== unit).map((entry) => entry.name),
    ]),
  );
  const costs = rooms.map((room) =>
    roomChoiceCost({ name: unit, tierRank: 0 }, room, inRoom, new Map(), 0, weights),
  );
  return rooms[costs.indexOf(Math.min(...costs))];
}

/**
 * Places the returning player's unit (a player, or the player's team) as above. Call it after `markBack`, so the unit is
 * no longer counted among the likely absentees. The same state comes back unless the unit moves.
 */
export function seatReturningUnit(state: TournamentState, playerName: string): SeatResult {
  const seat = seatOf(state, playerName);
  if (!seat) return { state, outcome: 'undrawn', room: null };
  const { unit, roundIndex, room: own } = seat;
  const stays = (outcome: SeatOutcome = 'stays'): SeatResult => ({ state, outcome, room: own });
  if (roomHasScore(state, roundIndex, own)) return stays('scored');

  const likely = likelyAbsentees(state, roundIndex);
  const entries = state.assignments[roundIndex] ?? [];
  const expected = (room: number) =>
    entries.filter((entry) => entry.room === room && entry.name !== unit && !likely.has(entry.name)).length;
  const eligible = lineupMoveCandidates(state, roundIndex, unit);
  const fewest = Math.min(...eligible.map(expected));
  const target = bestOf(
    state,
    roundIndex,
    unit,
    own,
    eligible.filter((room) => expected(room) === fewest),
  );
  if (target === own) return stays();
  const moved = moveUnitToRoom(state, roundIndex, unit, target);
  return moved.ok ? { state: moved.state, outcome: 'moved', room: target } : stays();
}

/** What the organiser is told after the click: where the returning unit is now; null before the draw (the toggle turning ✓ is the feedback). */
function returnNotice(state: TournamentState, unit: string, { outcome, room }: SeatResult): string | null {
  if (outcome === 'undrawn' || room === null) return null;
  const label = unitDisplay(state, unit).label;
  const where = `Room ${roomLetter(room)}`;
  if (outcome === 'moved') return `${label} is back: moved to ${where}.`;
  if (outcome === 'scored') return `${label} is back. ${where} already has scores, so ${label} stays there.`;
  return `${label} is back and stays in ${where}.`;
}

/**
 * A click on a name's toggle: what `clickConfirmation` does, and, when it marks a unit back after the round it is in
 * was drawn, the unit's seat and the notice to show. The notice is null for every other click.
 */
export function clickConfirmationAndSeat(
  state: TournamentState,
  name: string,
): { state: TournamentState; notice: string | null } {
  const absentSince = absenceMarks(state).absent.get(name);
  const clicked = clickConfirmation(state, name);
  const seat = absentSince === undefined ? null : seatOf(clicked, name);
  // The round it was absent from is not a draw it could have been moved in.
  if (!seat || absentSince === undefined || seat.roundIndex <= absentSince)
    return { state: clicked, notice: null };
  const result = seatReturningUnit(clicked, name);
  return { state: result.state, notice: returnNotice(result.state, seat.unit, result) };
}
