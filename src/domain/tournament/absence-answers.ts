import { answerOf, oneScoreTeamMemberKey, withoutAbsenceAnswer, zeroScoresInPlay } from './absences';
import { invalidateStaleTieResolutions } from './room-ties';
import { isCurrentRound } from './round-columns';
import { parseScoreKey } from './scoring';
import type { AbsenceAnswer, TournamentState } from './types';

/** The edits to the absence answers that re-check ties: answering a 0, taking an answer back, and unmarking a member of a team with one score. `absences.ts` reads the answers and makes the other edits. */

/** An answer changes who is in a room's ties: the decisions of the rooms it touches are checked again. */
function invalidateTiesOfKeys(state: TournamentState, keys: string[]): TournamentState {
  const rooms = new Map<string, [number, number]>();
  for (const key of keys) {
    const parsed = parseScoreKey(key);
    if (parsed) rooms.set(`${parsed.roundIndex}:${parsed.room}`, [parsed.roundIndex, parsed.room]);
  }
  let next = state;
  for (const [roundIndex, room] of rooms.values()) {
    next = invalidateStaleTieResolutions(next, roundIndex, room);
  }
  return next;
}

/** Answers the given keys. Keys that are not a score of 0 in the rounds in play are ignored. */
export function answerAbsence(
  state: TournamentState,
  keys: string[],
  answer: AbsenceAnswer,
): TournamentState {
  const askable = new Set(
    zeroScoresInPlay(state).flatMap((room) => room.questions.map((question) => question.key)),
  );
  const answered = keys.filter((key) => askable.has(key));
  if (!answered.length) return state;
  const next = {
    ...state,
    absences: { ...state.absences, ...Object.fromEntries(answered.map((key) => [key, answer])) },
  };
  return invalidateTiesOfKeys(next, answered);
}

/** Takes an answer back (the panel's undo), so the question is asked again. Only in the rounds in play. */
export function clearAbsenceAnswer(state: TournamentState, key: string): TournamentState {
  const roundIndex = parseScoreKey(key)?.roundIndex ?? null;
  if (answerOf(state, key) === undefined || roundIndex === null || !isCurrentRound(state, roundIndex)) {
    return state;
  }
  return invalidateTiesOfKeys({ ...state, absences: withoutAbsenceAnswer(state.absences, key) }, [key]);
}

/** Takes the hand mark of a member of a team with one score back. */
export function unmarkOneScoreTeamMemberAbsent(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  memberIndex: number,
): TournamentState {
  return clearAbsenceAnswer(state, oneScoreTeamMemberKey(roundIndex, room, position, memberIndex));
}
