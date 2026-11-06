import { withoutRoomAbsences, withoutRoundAbsences } from './absences';
import { getGameFormat } from './formats';
import { splitAdvancement, validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { roundHasAnyScore } from './scoring';
import { isPoolingRound } from './pooling';
import { recordRoomHistory, rewindRoomHistory } from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';
import { advancingSeats, declaredWaterfallRooms } from './waterfall-bracket';

/**
 * Line-up correction of the round about to be played: move a unit to another
 * room, eliminate a unit by hand, reinstate a unit eliminated in the
 * previous round. Applied as a whole draft, validated as a whole (a room of 2
 * can only be corrected by "eliminate X + reinstate Y" together). Only the
 * current round, and only while it has no score -- history stays as played,
 * and scores are keyed by room position, so a scored round can't be
 * re-seated. The round's `advTotal` and room count never change.
 */

export type LineupScope =
  | {
      ok: true;
      roundIndex: number;
      rooms: Array<{ room: number; units: string[] }>;
      byes: string[];
      units: string[];
      /** Units eliminated in the previous round and still in the roster. */
      reinstatable: string[];
      canEliminate: boolean;
    }
  | { ok: false; reason: string };

export type LineupEditResult = { ok: true; state: TournamentState } | { ok: false; error: string };

function scopeRefusal(state: TournamentState): string | null {
  if (!state.started) return 'The tournament has not started.';
  if (state.cfg.poolingPhase === 'group-stage')
    return "Line-up corrections aren't available for group stage.";
  const round = state.rounds[state.curRound];
  if (!round || !(state.assignments[state.curRound] ?? []).length) return 'This round has no line-up yet.';
  // Pooling rounds feed any bracket the same way; bracket rounds only exist in this form for single elimination.
  if (!isPoolingRound(round) && state.scheduleLogic !== 'single-elimination') {
    return "Line-up corrections aren't available for this bracket format.";
  }
  if (
    isPoolingRound(round) &&
    (round.fixedRoomAssignments || state.gamemodeConfig.drawPublication === 'fixed')
  ) {
    return "This round's draw was published in advance and can't be changed.";
  }
  if (roundHasAnyScore(state, state.curRound, round)) {
    return `Round ${round.roundNum} has scores — line-up locked.`;
  }
  return null;
}

function reinstatableUnits(state: TournamentState): string[] {
  const previous = state.assignments[state.curRound - 1] ?? [];
  const current = new Set((state.assignments[state.curRound] ?? []).map((entry) => entry.name));
  const roster = new Set(rosterKeys(state.players));
  return previous
    .filter((entry) => !current.has(entry.name) && roster.has(entry.name))
    .map((entry) => entry.name);
}

export function lineupEditScope(state: TournamentState): LineupScope {
  const refusal = scopeRefusal(state);
  if (refusal) return { ok: false, reason: refusal };
  const round = state.rounds[state.curRound];
  const assignments = state.assignments[state.curRound];
  const rooms = round.rooms.map((_, index) => ({
    room: index + 1,
    units: assignments.filter((entry) => entry.room === index + 1).map((entry) => entry.name),
  }));
  return {
    ok: true,
    roundIndex: state.curRound,
    rooms,
    byes: assignments.filter((entry) => entry.room === null).map((entry) => entry.name),
    units: assignments.map((entry) => entry.name),
    reinstatable: state.curRound > 0 && !isPoolingRound(round) ? reinstatableUnits(state) : [],
    canEliminate: !round.isNoElim,
  };
}

function countByRoom(entries: RoundAssignment[], roomCount: number): number[] {
  const counts = Array.from({ length: roomCount }, () => 0);
  for (const entry of entries) {
    if (entry.room !== null) counts[entry.room - 1] += 1;
  }
  return counts;
}

/** The first problem with the draft, or null. */
function draftProblem(
  state: TournamentState,
  round: TournamentRound,
  current: RoundAssignment[],
  draft: RoundAssignment[],
  reinstatable: string[],
): string | null {
  const known = new Map(current.map((entry) => [entry.name, entry]));
  const names = draft.map((entry) => entry.name);
  if (new Set(names).size !== names.length) return 'A unit appears more than once in the line-up.';
  const unknown = names.find((name) => !known.has(name) && !reinstatable.includes(name));
  if (unknown)
    return `${unknown} can't be placed: they're not in this round and weren't eliminated in the previous one.`;
  const eliminated = current.filter((entry) => !names.includes(entry.name));
  if (eliminated.length > 0 && round.isNoElim) {
    return 'Nobody can be eliminated in a pooling round — use Remove for a unit that has left.';
  }
  for (const entry of draft) {
    const placed = known.get(entry.name);
    const wasOnBye = placed !== undefined && placed.room === null;
    if ((entry.room === null) !== wasOnBye) return "Units can't be moved into or out of a bye.";
    if (entry.room !== null && (entry.room < 1 || entry.room > round.rooms.length)) {
      return `Room ${entry.room} doesn't exist.`;
    }
  }
  const sizesBefore = countByRoom(current, round.rooms.length);
  const after = countByRoom(draft, round.rooms.length);
  const max = state.gamemodeConfig.roomSize?.max ?? Infinity;
  const advPerRoom = round.advPerRoom ?? 0;
  for (const [index, size] of after.entries()) {
    if (size === 0) return `Room ${index + 1} would be empty.`;
    const shrunk = size < sizesBefore[index];
    if (size < 2 && shrunk)
      return `Room ${index + 1} would have only ${size} unit — a room needs at least 2.`;
    if (size > max && size > sizesBefore[index])
      return `Room ${index + 1} would have ${size} units; the limit is ${max}.`;
    if (!round.isNoElim && size <= advPerRoom && shrunk) {
      return `Room ${index + 1} would have ${size} units but ${advPerRoom} advance — someone must be cut.`;
    }
  }
  if (!round.isNoElim && eliminated.length > 0 && draft.length <= round.advTotal) {
    return `Eliminating that unit leaves ${draft.length} for ${round.advTotal} places — nobody would be cut. Lower the advancement count instead.`;
  }
  return null;
}

function manualEntries(current: RoundAssignment[], draft: RoundAssignment[]): RoundAssignment[] {
  const known = new Map(current.map((entry) => [entry.name, entry]));
  return draft.map((entry) => {
    const before = known.get(entry.name);
    const placedByHand = !before || before.room !== entry.room || before.manual === true;
    return {
      name: entry.name,
      room: entry.room,
      isLucky: before ? before.isLucky : false,
      ...(placedByHand ? { manual: true as const } : {}),
    };
  });
}

/**
 * Writes `entries` as the line-up of round `roundIndex`: the round's room shape and advancement follow, the room history
 * is rewound and recorded again, and the answers and tie decisions of the rooms the line-up changes are dropped (every
 * room of the round when `changedRooms` is not given).
 */
function commitLineup(
  state: TournamentState,
  roundIndex: number,
  entries: RoundAssignment[],
  changedRooms?: number[],
): TournamentState {
  const round = state.rounds[roundIndex];
  const byeCount = entries.filter((entry) => entry.room === null).length;
  const rooms = countByRoom(entries, round.rooms.length);
  const split = round.advPerRoom === null ? {} : splitAdvancement(round.advTotal, byeCount, rooms.length);
  const updated: TournamentRound = {
    ...round,
    players: entries.length,
    rooms,
    byeCount,
    ...(round.isNoElim ? { advTotal: entries.length } : {}),
    ...split,
    ...(round.isWaterfall ? { advTotal: advancingSeats(round, rooms) } : {}),
  };
  const kept = new Set(entries.map((entry) => entry.name));
  const at = <T>(list: T[], value: T) => list.map((entry, index) => (index === roundIndex ? value : entry));
  const prefixes = (changedRooms ?? [null]).map((room) =>
    room === null ? `r${roundIndex}-` : `r${roundIndex}-rm${room}-`,
  );
  const assignments = at(state.assignments, entries);
  return {
    ...state,
    rounds: at(state.rounds, updated),
    assignments,
    byes: at(
      state.byes,
      (state.byes[roundIndex] ?? []).filter((name) => kept.has(name)),
    ),
    luckyLosers: at(
      state.luckyLosers,
      (state.luckyLosers[roundIndex] ?? []).filter((name) => kept.has(name)),
    ),
    tieResolutions: Object.fromEntries(
      Object.entries(state.tieResolutions).filter(
        ([key]) => !prefixes.some((prefix) => key.startsWith(prefix)),
      ),
    ),
    absences: changedRooms
      ? withoutRoomAbsences(state.absences, roundIndex, changedRooms)
      : withoutRoundAbsences(state.absences, roundIndex),
    roomHistory: recordRoomHistory(
      rewindRoomHistory(state.roomHistory, assignments, roundIndex),
      entries,
      roundIndex,
    ),
  };
}

export function applyLineupEdit(state: TournamentState, draft: RoundAssignment[]): LineupEditResult {
  const scope = lineupEditScope(state);
  if (!scope.ok) return { ok: false, error: scope.reason };
  const format = getGameFormat(state.gameFormat);
  const cur = state.curRound;
  const round = state.rounds[cur];
  const current = state.assignments[cur];
  const problem = draftProblem(state, round, current, draft, scope.reinstatable);
  if (problem) return { ok: false, error: problem };

  const entries = manualEntries(current, draft);
  if (format) {
    const roomCapError = validateRoomCap(
      [{ roundNum: round.roundNum, rooms: countByRoom(entries, round.rooms.length) }],
      format,
    );
    if (roomCapError) return { ok: false, error: roomCapError };
  }
  return { ok: true, state: commitLineup(state, cur, entries) };
}

/** Whether any score is entered in a room (any game of any unit): its seats are keyed by position, so they cannot be re-seated. */
export function roomHasScore(state: TournamentState, roundIndex: number, room: number): boolean {
  const prefix = `r${roundIndex}-rm${room}-`;
  return Object.entries(state.scores).some(([key, value]) => key.startsWith(prefix) && value !== null);
}

/** Why a unit's room cannot be changed in a round, or null: the round's draw is fixed, or has its own mechanism. */
function moveRoundRefusal(state: TournamentState, round: TournamentRound): string | null {
  if (!state.started) return 'The tournament has not started.';
  if (round.isGroupStage || round.bracket || round.isKingsValley || round.isFinal) {
    return "A unit can't be moved in this kind of round.";
  }
  if (round.isWaterfall) return null;
  if (state.cfg.poolingPhase === 'group-stage')
    return "Line-up corrections aren't available for group stage.";
  if (!isPoolingRound(round) && state.scheduleLogic !== 'single-elimination') {
    return "Line-up corrections aren't available for this bracket format.";
  }
  if (
    isPoolingRound(round) &&
    (round.fixedRoomAssignments || state.gamemodeConfig.drawPublication === 'fixed')
  ) {
    return "This round's draw was published in advance and can't be changed.";
  }
  return null;
}

/** The room sizes a move may not break: nobody above the round's largest room (a Custom bracket room, its declared size), none below its smallest. */
function moveSizeProblem(
  state: TournamentState,
  round: TournamentRound,
  counts: number[],
  from: number,
  to: number,
): string | null {
  const [left, joined] = [counts[from - 1] - 1, counts[to - 1] + 1];
  const smallest = round.isWaterfall ? 2 : Math.max(2, state.gamemodeConfig.roomSize?.min ?? 2);
  if (left < smallest)
    return `Room ${from} would have only ${left} units — a room needs at least ${smallest}.`;
  const largest = round.isWaterfall
    ? (declaredWaterfallRooms(round)[to - 1] ?? Infinity)
    : (state.gamemodeConfig.roomSize?.max ?? Infinity);
  if (joined > largest) return `Room ${to} would have ${joined} units; the limit is ${largest}.`;
  if (!round.isNoElim && !round.isWaterfall && left <= (round.advPerRoom ?? 0)) {
    return `Room ${from} would have ${left} units but ${round.advPerRoom} advance — someone must be cut.`;
  }
  return null;
}

/**
 * Why a unit of a drawn round cannot move to `room`, or null when it can: the round allows it, neither room has a score
 * (the unit's own room loses a seat, so its positions shift), and the room sizes stay within the round's limits.
 */
export function unitMoveProblem(
  state: TournamentState,
  roundIndex: number,
  unit: string,
  room: number,
): string | null {
  const round = state.rounds[roundIndex];
  const entry = (state.assignments[roundIndex] ?? []).find((candidate) => candidate.name === unit);
  if (!round || !entry || entry.room === null) return `${unit} has no room in this round.`;
  const refusal = moveRoundRefusal(state, round);
  if (refusal) return refusal;
  if (room < 1 || room > round.rooms.length) return `Room ${room} doesn't exist.`;
  if (room === entry.room) return `${unit} is already in Room ${room}.`;
  for (const scored of [entry.room, room]) {
    if (roomHasScore(state, roundIndex, scored)) return `Room ${scored} already has scores.`;
  }
  const counts = countByRoom(state.assignments[roundIndex], round.rooms.length);
  return moveSizeProblem(state, round, counts, entry.room, room);
}

/**
 * Moves one unit of a drawn round to another room, and nobody else: every other unit keeps its room and position, and
 * the rooms with a score are never touched. The unit is marked as placed by hand, like any line-up correction.
 */
export function moveUnitToRoom(
  state: TournamentState,
  roundIndex: number,
  unit: string,
  room: number,
): LineupEditResult {
  const problem = unitMoveProblem(state, roundIndex, unit, room);
  if (problem) return { ok: false, error: problem };
  const current = state.assignments[roundIndex];
  const from = current.find((entry) => entry.name === unit)?.room ?? room;
  const draft = current.map((entry) => (entry.name === unit ? { ...entry, room } : entry));
  return { ok: true, state: commitLineup(state, roundIndex, manualEntries(current, draft), [from, room]) };
}

/** The rooms a drawn unit may be in after a move: its own, and every room it can move to (`unitMoveProblem`). */
export function lineupMoveCandidates(state: TournamentState, roundIndex: number, unit: string): number[] {
  const own = (state.assignments[roundIndex] ?? []).find((entry) => entry.name === unit)?.room;
  if (own === null || own === undefined) return [];
  return state.rounds[roundIndex].rooms
    .map((_, index) => index + 1)
    .filter((room) => room === own || unitMoveProblem(state, roundIndex, unit, room) === null);
}
