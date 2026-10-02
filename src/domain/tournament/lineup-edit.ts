import { getGameFormat } from './formats';
import { splitAdvancement, validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { roundHasAnyScore } from './scoring';
import { recordRoomHistory, rewindRoomHistory } from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

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

const isPoolingRound = (round: TournamentRound) => round.isQual || !!round.isSwiss || round.isNoElim;

function scopeRefusal(state: TournamentState): string | null {
  if (!state.started) return 'The tournament has not started.';
  if (state.scheduleLogic !== 'single-elimination' || state.cfg.poolingPhase === 'group-stage') {
    return "Line-up corrections aren't available for this format.";
  }
  const round = state.rounds[state.curRound];
  if (!round || !(state.assignments[state.curRound] ?? []).length) return 'This round has no line-up yet.';
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
    .filter((entry) => entry.room !== null && !current.has(entry.name) && roster.has(entry.name))
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
    reinstatable: state.curRound > 0 ? reinstatableUnits(state) : [],
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
    if (size < 2) return `Room ${index + 1} would have only ${size} unit — a room needs at least 2.`;
    if (size > max && size > sizesBefore[index])
      return `Room ${index + 1} would have ${size} units; the limit is ${max}.`;
    if (!round.isNoElim && size <= advPerRoom) {
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
  const byeCount = entries.filter((entry) => entry.room === null).length;
  const rooms = countByRoom(entries, round.rooms.length);
  if (format) {
    const roomCapError = validateRoomCap([{ roundNum: round.roundNum, rooms }], format);
    if (roomCapError) return { ok: false, error: roomCapError };
  }
  const split = round.advPerRoom === null ? {} : splitAdvancement(round.advTotal, byeCount, rooms.length);
  const updated: TournamentRound = {
    ...round,
    players: entries.length,
    rooms,
    byeCount,
    ...(round.isNoElim ? { advTotal: entries.length } : {}),
    ...split,
  };
  const kept = new Set(entries.map((entry) => entry.name));
  const at = <T>(list: T[], value: T) => list.map((entry, index) => (index === cur ? value : entry));
  const prefix = `r${cur}-`;
  const assignments = at(state.assignments, entries);
  return {
    ok: true,
    state: {
      ...state,
      rounds: at(state.rounds, updated),
      assignments,
      byes: at(
        state.byes,
        (state.byes[cur] ?? []).filter((name) => kept.has(name)),
      ),
      luckyLosers: at(
        state.luckyLosers,
        (state.luckyLosers[cur] ?? []).filter((name) => kept.has(name)),
      ),
      tieResolutions: Object.fromEntries(
        Object.entries(state.tieResolutions).filter(([key]) => !key.startsWith(prefix)),
      ),
      roomHistory: recordRoomHistory(rewindRoomHistory(state.roomHistory, assignments, cur), entries, cur),
      needsSave: true,
    },
  };
}
