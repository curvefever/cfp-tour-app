/**
 * Absentees (`gamemodeConfig.absenceVersion` 1). A typed score of 0 in the column in play asks the organiser whether
 * that unit (or member) played or was absent; the answer is kept in `state.absences`, keyed by the score key the 0
 * is stored under (`r{ri}-rm{room}-p{pos}`, then `-g{n}` in a multi-game round, then `-m{i}` for a member).
 *
 * An answer counts only while its key's stored score is still 0 (`isMarkedAbsent`), so a stale answer left behind by
 * a line-up edit, Previous or a swap reads as present. The one exception is a Survival member's mark, stored under
 * the member key (which has no score): only display code reads it (`isMemberMarkedAbsent`).
 *
 * The Final and the grand final are left out: their 0s are never asked.
 */
import { invalidateStaleTieResolutions } from './advancement';
import { buildTeamMap } from './roster';
import { currentColumn } from './round-columns';
import { occupiedRooms, scoredTeamSize, scoreOrDefault } from './scoring';
import type { AbsenceAnswer, TournamentRound, TournamentState } from './types';

export const PENDING_ABSENCES_MESSAGE = 'Answer every score of 0 before advancing.';

/** One score key the bar asks about: a unit's own score, or one member's score of it, in one game. */
export interface AbsenceQuestion {
  key: string;
  roundIndex: number;
  room: number;
  position: number;
  /** The unit's key: a player's name or a team id. */
  unit: string;
  /** Set when the key is a member's score (sum of members, Save your Buddy). */
  memberIndex?: number;
  /** Set in a round of several games. */
  game?: number;
}

export interface RoomAbsenceQuestions {
  roundIndex: number;
  room: number;
  questions: AbsenceQuestion[];
}

/** The one switch: a tournament generated without `absenceVersion` behaves as before, with no questions and no marks. */
export function usesAbsences(state: Pick<TournamentState, 'gamemodeConfig'>): boolean {
  return state.gamemodeConfig.absenceVersion === 1;
}

function isSurvival(state: Pick<TournamentState, 'gamemodeConfig'>): boolean {
  return state.gamemodeConfig.teamScoringRule === 'survival-teams';
}

/** Whether a round's 0s are asked: every round but the Final and the grand final. */
function roundAsks(round: TournamentRound | undefined): round is TournamentRound {
  return round !== undefined && !round.isFinal && round.bracket !== 'grand-final';
}

/** The answer given for a key (stored tournaments from before the field existed have none). */
function answerOf(state: Pick<TournamentState, 'absences'>, key: string): AbsenceAnswer | undefined {
  return (state.absences as TournamentState['absences'] | undefined)?.[key];
}

/** Whether any answer is recorded: without one nothing is absent, which spares the scoring code the work of looking. */
function hasAnswers(state: TournamentState): boolean {
  return usesAbsences(state) && Object.keys(state.absences ?? {}).length > 0;
}

/** True when the key holds a score of 0 that the organiser answered "absent". */
export function isMarkedAbsent(state: TournamentState, key: string): boolean {
  return (
    usesAbsences(state) && scoreOrDefault(state.scores[key], null) === 0 && answerOf(state, key) === 'absent'
  );
}

/** True when a Survival member was marked absent by hand (display only; scoring never reads it). */
export function isMemberMarkedAbsent(state: TournamentState, memberKey: string): boolean {
  return usesAbsences(state) && answerOf(state, memberKey) === 'absent';
}

const teamMaps = new WeakMap<
  object,
  { players: unknown; reserves: unknown; map: ReturnType<typeof buildTeamMap> }
>();

/** The roster's teams by id, built once per state: the scoring code asks for it for every room it reads. */
function teamsOf(state: TournamentState): ReturnType<typeof buildTeamMap> {
  const cached = teamMaps.get(state);
  if (cached && cached.players === state.players && cached.reserves === state.reserves) return cached.map;
  const map = buildTeamMap(state);
  teamMaps.set(state, { players: state.players, reserves: state.reserves, map });
  return map;
}

function seatBase(roundIndex: number, room: number, position: number, game: number | null): string {
  return `r${roundIndex}-rm${room}-p${position}` + (game === null ? '' : `-g${game}`);
}

/** The key under which a Survival team's member is marked absent by hand: round-wide, whatever the number of games. */
export function survivalMemberKey(
  roundIndex: number,
  room: number,
  position: number,
  memberIndex: number,
): string {
  return `${seatBase(roundIndex, room, position, null)}-m${memberIndex}`;
}

function unitsOfRoom(state: TournamentState, roundIndex: number, room: number): string[] {
  return (state.assignments[roundIndex] ?? [])
    .filter((entry) => entry.room === room)
    .map((entry) => entry.name);
}

/** Every score key of one seat that can hold a 0: per game, the unit's own key, or one per member that exists. */
function seatQuestions(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  unit: string,
): AbsenceQuestion[] {
  const games = Math.max(state.rounds[roundIndex]?.numGames ?? 1, 1);
  const teamSize = scoredTeamSize(state);
  const members = teamSize ? teamsOf(state)[unit]?.members : undefined;
  const questions: AbsenceQuestion[] = [];
  for (let game = 1; game <= games; game += 1) {
    const base = seatBase(roundIndex, room, position, games > 1 ? game : null);
    const seat = { roundIndex, room, position, unit, ...(games > 1 ? { game } : {}) };
    if (!teamSize) {
      questions.push({ ...seat, key: base });
      continue;
    }
    for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
      if (members?.[memberIndex]) questions.push({ ...seat, key: `${base}-m${memberIndex}`, memberIndex });
    }
  }
  return questions;
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): T[][] {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups.values()];
}

/** A seat is absent from a room only if it is absent in every game; in a game, a team is absent when all its members are. */
function isSeatAbsent(state: TournamentState, questions: AbsenceQuestion[]): boolean {
  return (
    questions.length > 0 &&
    groupBy(questions, (question) => question.game ?? 0).every((game) =>
      game.every((question) => isMarkedAbsent(state, question.key)),
    )
  );
}

/** Whether the unit at `position` of the room is absent from it. Always false without `absenceVersion` and in the Final. */
export function isUnitAbsentFromRoom(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): boolean {
  const unit = unitsOfRoom(state, roundIndex, room)[position];
  if (!hasAnswers(state) || !roundAsks(state.rounds[roundIndex]) || unit === undefined) return false;
  return isSeatAbsent(state, seatQuestions(state, roundIndex, room, position, unit));
}

/** The units absent from a room, in seat order. */
export function absentInRoom(state: TournamentState, roundIndex: number, room: number): string[] {
  return unitsOfRoom(state, roundIndex, room).filter((_, position) =>
    isUnitAbsentFromRoom(state, roundIndex, room, position),
  );
}

/**
 * How many players a unit has in play, for the relative score of a sum-of-members room: the members that exist and
 * are not absent in every game. Every other format, and a tournament without `absenceVersion`, counts a unit as 1.
 */
export function playersInPlay(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
): number {
  const unit = unitsOfRoom(state, roundIndex, room)[position];
  const weighted =
    state.gamemodeConfig.teamScoringRule !== 'designated-player' && scoredTeamSize(state) !== undefined;
  if (!usesAbsences(state) || !weighted || unit === undefined) return 1;
  const members = groupBy(
    seatQuestions(state, roundIndex, room, position, unit),
    (question) => question.memberIndex,
  );
  return members.filter((member) => !member.every((question) => isMarkedAbsent(state, question.key))).length;
}

function roomQuestions(state: TournamentState, roundIndex: number, room: number): AbsenceQuestion[] {
  return unitsOfRoom(state, roundIndex, room)
    .flatMap((unit, position) => seatQuestions(state, roundIndex, room, position, unit))
    .filter((question) => scoreOrDefault(state.scores[question.key], null) === 0);
}

/**
 * The units of a room with a score of 0 still waiting for an answer, in a mode that blocks on it: their 0 may be an
 * absence, so a tie at 0 is held back until it is answered. Empty outside the column in play, in Survival Teams, and
 * for a tournament without `absenceVersion`.
 */
export function unitsAwaitingAnswer(state: TournamentState, roundIndex: number, room: number): Set<string> {
  const { start, end } = currentColumn(state);
  if (!usesAbsences(state) || isSurvival(state) || roundIndex < start || roundIndex > end) return new Set();
  if (!roundAsks(state.rounds[roundIndex])) return new Set();
  return new Set(
    roomQuestions(state, roundIndex, room)
      .filter((question) => !answerOf(state, question.key))
      .map((question) => question.unit),
  );
}

/** Every score of 0 in the column in play that the bar can ask about, answered or not, grouped by round and room. */
export function zeroScoresInPlay(state: TournamentState): RoomAbsenceQuestions[] {
  if (!usesAbsences(state)) return [];
  const { start, end } = currentColumn(state);
  const rooms: RoomAbsenceQuestions[] = [];
  for (let roundIndex = start; roundIndex <= end; roundIndex += 1) {
    if (!roundAsks(state.rounds[roundIndex])) continue;
    for (const room of occupiedRooms(state, roundIndex)) {
      const questions = roomQuestions(state, roundIndex, room);
      if (questions.length) rooms.push({ roundIndex, room, questions });
    }
  }
  return rooms;
}

/** The questions the bar still asks: each score of 0 in the column in play with no answer, by round and room. */
export function pendingAbsenceQuestions(state: TournamentState): RoomAbsenceQuestions[] {
  return zeroScoresInPlay(state)
    .map((room) => ({
      ...room,
      questions: room.questions.filter((question) => !answerOf(state, question.key)),
    }))
    .filter((room) => room.questions.length > 0);
}

/** True when Next Round must wait for an answer: Survival Teams never blocks, an unanswered 0 there counts as played. */
export function hasBlockingAbsenceQuestions(state: TournamentState): boolean {
  return !isSurvival(state) && pendingAbsenceQuestions(state).length > 0;
}

/** An answer changes who is in a room's ties: the decisions of the rooms it touches are checked again. */
function invalidateTiesOfKeys(state: TournamentState, keys: string[]): TournamentState {
  const rooms = new Map<string, [number, number]>();
  for (const key of keys) {
    const match = /^r(\d+)-rm(\d+)-/.exec(key);
    if (match) rooms.set(`${match[1]}:${match[2]}`, [Number(match[1]), Number(match[2])]);
  }
  let next = state;
  for (const [roundIndex, room] of rooms.values()) {
    next = invalidateStaleTieResolutions(next, roundIndex, room);
  }
  return next;
}

/** Answers the given keys. Keys that are not a score of 0 in the column in play are ignored. */
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

function roundOfKey(key: string): number | null {
  const match = /^r(\d+)-/.exec(key);
  return match ? Number(match[1]) : null;
}

/** The answers without one key's: a changed score drops the answer given to the earlier one. */
export function withoutAbsenceAnswer(
  absences: TournamentState['absences'] | undefined,
  key: string,
): TournamentState['absences'] {
  return withoutAbsences(absences, (candidate) => candidate === key);
}

/** Takes an answer back (the panel's undo), so the question is asked again. Only in the column in play. */
export function clearAbsenceAnswer(state: TournamentState, key: string): TournamentState {
  const roundIndex = roundOfKey(key);
  const { start, end } = currentColumn(state);
  if (answerOf(state, key) === undefined || roundIndex === null || roundIndex < start || roundIndex > end) {
    return state;
  }
  return invalidateTiesOfKeys({ ...state, absences: withoutAbsenceAnswer(state.absences, key) }, [key]);
}

/** Marks a member of a Survival team absent by hand (display only). Ignored unless the member exists in the column in play. */
export function markSurvivalMemberAbsent(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  memberIndex: number,
): TournamentState {
  const { start, end } = currentColumn(state);
  const unit = unitsOfRoom(state, roundIndex, room)[position];
  const member = unit === undefined ? undefined : teamsOf(state)[unit]?.members?.[memberIndex];
  if (!usesAbsences(state) || !isSurvival(state) || !roundAsks(state.rounds[roundIndex]) || !member)
    return state;
  if (roundIndex < start || roundIndex > end) return state;
  return {
    ...state,
    absences: { ...state.absences, [survivalMemberKey(roundIndex, room, position, memberIndex)]: 'absent' },
  };
}

/** Takes a Survival member's mark back. */
export function unmarkSurvivalMemberAbsent(
  state: TournamentState,
  roundIndex: number,
  room: number,
  position: number,
  memberIndex: number,
): TournamentState {
  return clearAbsenceAnswer(state, survivalMemberKey(roundIndex, room, position, memberIndex));
}

/** Tolerates a state cached before the field existed. */
function withoutAbsences(
  absences: TournamentState['absences'] | undefined,
  isRemoved: (key: string) => boolean,
): TournamentState['absences'] {
  return Object.fromEntries(Object.entries(absences ?? {}).filter(([key]) => !isRemoved(key)));
}

/** The answers without those of one round: for a round whose draw or line-up is thrown away. */
export function withoutRoundAbsences(
  absences: TournamentState['absences'],
  roundIndex: number,
): TournamentState['absences'] {
  const prefix = `r${roundIndex}-`;
  return withoutAbsences(absences, (key) => key.startsWith(prefix));
}

/** The answers without those of one seat (every game and member, and a Survival member's mark): for a swapped-out unit. */
export function withoutSeatAbsences(
  absences: TournamentState['absences'],
  roundIndex: number,
  room: number,
  position: number,
): TournamentState['absences'] {
  const base = seatBase(roundIndex, room, position, null);
  return withoutAbsences(absences, (key) => key === base || key.startsWith(`${base}-`));
}
