/**
 * Changing the defender of a team (Save your Buddy) while its seat in the round in play already holds a score: only the
 * defender's score is entered, so the number typed was read from "the defender" and belongs to whoever is defender now.
 * The score keys (and the absence answers under them) of the old defender's slot move to the new defender's slot.
 */
import { finalScoreKey, scoreKey, scoredMemberSlots, scoredTeamSize, scoreOrDefault } from './scoring';
import type { TournamentState } from './types';

type KeyMove = { from: string; to: string };

/** The seat's keys of the old defender's slot and where each goes: every game, in a room (`state.scores`) or the Final. */
function keyMoves(
  state: TournamentState,
  teamId: string,
  roundIndex: number,
  from: number,
  to: number,
): { final: boolean; moves: KeyMove[] } | null {
  const round = state.rounds[roundIndex];
  const entries = state.assignments[roundIndex] ?? [];
  const entry = entries.find((candidate) => candidate.name === teamId);
  if (!round || !entry) return null;
  const numGames = Math.max(round.numGames ?? 1, 1);
  const games = Array.from({ length: numGames }, (_, index) => index + 1);
  if (round.isFinal) {
    const moves = games.map((game) => ({
      from: finalScoreKey(game, teamId, from),
      to: finalScoreKey(game, teamId, to),
    }));
    return { final: true, moves };
  }
  if (entry.room === null) return null;
  const position = entries.filter((other) => other.room === entry.room).indexOf(entry);
  const moves = games.map((game) => {
    const gamePart = numGames > 1 ? game : null;
    return {
      from: scoreKey(roundIndex, entry.room as number, position, gamePart, from),
      to: scoreKey(roundIndex, entry.room as number, position, gamePart, to),
    };
  });
  return { final: false, moves };
}

/** A copy of `record` with each `from` value moved to its `to` key. */
function withMoved<Value>(record: Record<string, Value>, moves: KeyMove[]): Record<string, Value> {
  const next = { ...record };
  for (const { from, to } of moves) {
    if (next[from] === undefined) continue;
    next[to] = next[from];
    delete next[from];
  }
  return next;
}

/**
 * The state with the team's keys of the round in play moved from the old defender's slot to the new one's. Nothing moves
 * when the team's seat holds nothing under the old slot, or already holds a score or an answer under the new one.
 */
export function withDefenderKeysMoved(
  state: TournamentState,
  teamId: string,
  roundIndex: number,
  from: number,
  to: number,
): TournamentState {
  const teamSize = scoredTeamSize(state);
  if (!teamSize || from === to || scoredMemberSlots(state, teamId, roundIndex, teamSize).length !== 1) {
    return state;
  }
  const seat = keyMoves(state, teamId, roundIndex, from, to);
  if (!seat) return state;
  const scores = seat.final ? state.finalScores : state.scores;
  const held = (key: string) =>
    scoreOrDefault(scores[key], null) !== null || state.absences?.[key] !== undefined;
  if (seat.moves.some(({ to: target }) => held(target))) return state;
  if (!seat.moves.some(({ from: source }) => held(source))) return state;
  return seat.final
    ? { ...state, finalScores: withMoved(state.finalScores, seat.moves) }
    : {
        ...state,
        scores: withMoved(state.scores, seat.moves),
        absences: withMoved(state.absences ?? {}, seat.moves),
      };
}
