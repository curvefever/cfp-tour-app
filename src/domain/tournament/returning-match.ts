/**
 * A unit marked back after the draw whose room is shared with another likely absentee (`absenceVersion` 4, a head-to-head
 * pooling round not sent on): it would win by walkover if the other stays absent. The app never moves it alone ("likely
 * absent" is no reliable state): it works out the move it would make and the organiser is asked.
 *
 *  (a) swap with an absentee that faces a present unit: the returning unit takes that absentee's seat (a real match),
 *      and the two absentees now share a room;
 *  (b) take the place of the opponent against a present unit that holds a normal bye: the returning unit meets that unit
 *      and the old opponent takes the bye, as an absentee's bye (no points).
 * Neither: no question.
 */
import { roomLetter } from './bracket';
import { swapUnitSeats, roomHasScore, type LineupEditResult } from './lineup-edit';
import { likelyAbsentInRound } from './likely-absentees';
import { pairsAbsenteesInRound } from './seeding';
import { unitDisplay } from './roster';
import type { TournamentState } from './types';

export type ReturnMove =
  | {
      kind: 'swap-absentee';
      unit: string;
      room: number;
      /** The likely absentee that gives its seat, facing a present unit. */
      absentee: string;
      /** Where the returning unit ends up, and who it plays. */
      toRoom: number;
      opponent: string;
      /** The unit it shared a room with: it now shares one with `absentee`. */
      partner: string;
    }
  | {
      kind: 'take-bye';
      unit: string;
      room: number;
      /** The present unit that held a normal bye and now plays the returning unit. */
      holder: string;
      /** The old opponent, a likely absentee, who takes the bye. */
      partner: string;
    };

/** The room of the unit and its opponent in a head-to-head round, or null. */
function seatOfUnit(state: TournamentState, roundIndex: number, unit: string) {
  const entries = state.assignments[roundIndex] ?? [];
  const entry = entries.find((candidate) => candidate.name === unit);
  if (!entry || entry.room === null) return null;
  const opponent = entries.find((other) => other.room === entry.room && other.name !== unit);
  return opponent ? { room: entry.room, opponent: opponent.name } : null;
}

/** A room that holds one likely absentee and one present unit, not scored: the absentee gives its seat. */
function absenteeFacingPresent(
  state: TournamentState,
  roundIndex: number,
  likely: ReadonlySet<string>,
  own: number,
): { room: number; absentee: string; present: string } | null {
  const entries = state.assignments[roundIndex] ?? [];
  const rooms = [...new Set(entries.flatMap((entry) => (entry.room === null ? [] : [entry.room])))].sort(
    (first, second) => first - second,
  );
  for (const room of rooms) {
    if (room === own || roomHasScore(state, roundIndex, room)) continue;
    const names = entries.filter((entry) => entry.room === room).map((entry) => entry.name);
    const absentees = names.filter((name) => likely.has(name));
    if (names.length === 2 && absentees.length === 1) {
      return { room, absentee: absentees[0], present: names.find((name) => name !== absentees[0]) as string };
    }
  }
  return null;
}

/** A present unit with a normal bye (not an absentee's) in the round. */
function normalByeHolder(
  state: TournamentState,
  roundIndex: number,
  likely: ReadonlySet<string>,
  unit: string,
): string | null {
  const holder = (state.assignments[roundIndex] ?? []).find(
    (entry) => entry.room === null && !entry.absentBye && !likely.has(entry.name) && entry.name !== unit,
  );
  return holder?.name ?? null;
}

/**
 * The move the app would make for the returning `unit` of `roundIndex` (call it after the unit is marked back), or null
 * when the question does not apply: no version 4 pairing in this round, the room has a score, the opponent is not a
 * likely absentee, or no real match is free.
 */
export function returningMoveOf(state: TournamentState, roundIndex: number, unit: string): ReturnMove | null {
  const round = state.rounds[roundIndex];
  if (!round || !pairsAbsenteesInRound(state, round, roundIndex)) return null;
  const seat = seatOfUnit(state, roundIndex, unit);
  if (!seat || roomHasScore(state, roundIndex, seat.room)) return null;
  const likely = likelyAbsentInRound(state, roundIndex);
  if (!likely.has(seat.opponent) || likely.has(unit)) return null;
  const swap = absenteeFacingPresent(state, roundIndex, likely, seat.room);
  if (swap) {
    return {
      kind: 'swap-absentee',
      unit,
      room: seat.room,
      absentee: swap.absentee,
      toRoom: swap.room,
      opponent: swap.present,
      partner: seat.opponent,
    };
  }
  const holder = normalByeHolder(state, roundIndex, likely, unit);
  return holder ? { kind: 'take-bye', unit, room: seat.room, holder, partner: seat.opponent } : null;
}

/** The question asked before the move, and the words after a "no". */
export function returnQuestion(
  state: TournamentState,
  move: ReturnMove,
): { question: string; declined: string } {
  const label = (name: string) => unitDisplay(state, name).label;
  const unit = label(move.unit);
  const where = `Room ${roomLetter(move.room)}`;
  const base = `${unit} is back, but ${label(move.partner)} in ${where} is also likely absent.`;
  const question =
    move.kind === 'swap-absentee'
      ? `${base} Move ${unit} to Room ${roomLetter(move.toRoom)} to play ${label(move.opponent)}?`
      : `${base} Move ${unit} to play ${label(move.holder)}, who had the bye?`;
  return { question, declined: `${unit} is back and stays in ${where}.` };
}

/** What the organiser is told when no real match is free: the unit stays and wins by walkover if the other stays absent. */
export function noMatchFreeNotice(
  state: TournamentState,
  unit: string,
  room: number,
  partner: string,
): string {
  const label = unitDisplay(state, unit).label;
  return `${label} is back. No real match is free, so ${label} stays in Room ${roomLetter(room)} and wins by walkover if ${unitDisplay(state, partner).label} stays absent.`;
}

/** Makes the move: two seats swap, the rooms touched lose their answers and tie decisions, nothing else changes. */
export function moveReturningUnitToMatch(
  state: TournamentState,
  roundIndex: number,
  unit: string,
): LineupEditResult {
  const move = returningMoveOf(state, roundIndex, unit);
  if (!move) return { ok: false, error: 'No real match is free any more.' };
  return move.kind === 'swap-absentee'
    ? swapUnitSeats(state, roundIndex, move.unit, move.absentee)
    : swapUnitSeats(state, roundIndex, move.partner, move.holder, move.partner);
}
