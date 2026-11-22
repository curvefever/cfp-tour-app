import { answerAbsence } from '../absences';
import { scoreKey, scoredMemberSlots, scoredTeamSize } from '../scoring';
import type { RoundAssignment, TournamentState } from '../types';
import { scoreRound } from './dependency-play-fixtures';

/** Likely absentees made by answering a round's 0s absent: shared by the absentee pairing and absentee bye tests. */

/** Round 1 scored, with `absent` answered absent in it: they are the likely absentees of round 2. */
export function afterRoundOne(state: TournamentState, absent: string[]): TournamentState {
  return afterRound(state, 0, absent);
}

/** The round in play scored, with `absent` answered absent in it. */
export function afterRound(state: TournamentState, roundIndex: number, absent: string[]): TournamentState {
  let working = scoreRound(state, roundIndex);
  const keys: string[] = [];
  for (const unit of absent) {
    const entries = (working.assignments[roundIndex] ?? []).filter((entry) => entry.room !== null);
    const entry = entries.find((candidate) => candidate.name === unit);
    if (!entry || entry.room === null) throw new Error(`${unit} has no room in round ${roundIndex + 1}`);
    const position = entries.filter((other) => other.room === entry.room).indexOf(entry);
    const teamSize = scoredTeamSize(working);
    const slots = teamSize ? scoredMemberSlots(working, unit, roundIndex, teamSize) : [undefined];
    for (const slot of slots) {
      const key = scoreKey(roundIndex, entry.room, position, null, slot ?? null);
      working = { ...working, scores: { ...working.scores, [key]: 0 } };
      keys.push(key);
    }
  }
  return answerAbsence(working, keys, 'absent');
}

/** The first units of round 1's rooms: a mix of rooms and standings for the absentees. */
export function pickAbsent(state: TournamentState, count: number): string[] {
  const rooms = new Map<number, string[]>();
  for (const entry of state.assignments[0] ?? []) {
    if (entry.room !== null) rooms.set(entry.room, [...(rooms.get(entry.room) ?? []), entry.name]);
  }
  return [...rooms.values()].slice(0, count).map((names) => names[1]);
}

export const roomsOf = (assignments: RoundAssignment[]): string[][] => {
  const byRoom = new Map<number, string[]>();
  for (const entry of assignments) {
    if (entry.room !== null) byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), entry.name]);
  }
  return [...byRoom.entries()].sort(([a], [b]) => a - b).map(([, names]) => names);
};
export const byeOf = (assignments: RoundAssignment[]) => assignments.find((entry) => entry.room === null);
