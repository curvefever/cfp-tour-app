import { detectTieBreaks, invalidateStaleTieResolutions, isTieResolved } from './advancement';
import {
  hasPlayedAnyMatch,
  isUnitAbsentFromRoom,
  withoutAbsenceAnswer,
  withoutSeatAbsences,
  withSeatsShiftedUp,
} from './absences';
import { moveConfirmation } from './confirmations';
import { withDefenderKeysMoved } from './defender-move';
import { emptySchedule } from './empty-schedule';
import { moveBackMark } from './likely-absentees';
import { isPlainFinalFullyScored, progressGrandFinalRace } from './finals';
import { generatedConfig } from './generated-config';
import { patchFutureFixedDrawRounds, rebuildFixedDrawHistory } from './fixed-draws';
import { replanUpperLower } from './upper-lower-replan';
import { getGameFormat } from './formats';
import { lateJoinersOf } from './late-joiners';
import { groupSettingsOfCfg } from './group-settings';
import { isPoolingRound, refitPoolingRound } from './pooling';
import { regenerateForRoster } from './pre-start-roster';
import { computeRankings } from './rankings';
import { MAX_ANONYMOUS_FINALISTS, withFinalistAliasesForLineup } from './anonymous-finalists';
import { renameInSchedule } from './rename-unit';
import { validateRoomCap } from './room-distribution';
import { roundInPlayOf } from './round-columns';
import {
  findUnstorableNames,
  isDisplayNameTaken,
  findUnit,
  isWithdrawnName,
  rosterKey,
  rosterKeys,
  teamNames,
  unitDisplay,
  withUnit,
  withoutUnit,
} from './roster';
import { createTournamentRuntime, type TournamentRuntime } from './runtime';
import { buildScheduleRounds } from './schedule-generation';
import {
  getDefenderIndex,
  getFinalUnitScore,
  readTieResolution,
  scoredTeamSize,
  scoreKeysForPosition,
  SHARED_TIE_MARK,
} from './scoring';
import type { GameFormatKey, TournamentRound, TournamentState, TournamentTeam, WithdrawnUnit } from './types';

// Scores must be non-negative integers. Rejects (rather than truncates)
// decimals so "5.7" doesn't silently become "5", and rejects negatives --
// 0 is a real, complete score. Number(), not parseInt, so a fractional
// part is actually detected instead of silently dropped by truncation.
function isValidNonNegativeInteger(value: string): boolean {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0;
}

export function setRoundScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
  roundIndex: number,
  room: number,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : null;
  let next = {
    ...state,
    scores: { ...state.scores, [key]: parsed },
    // A corrected 0 is asked again, and a score above 0 is no absence.
    ...(state.scores[key] === parsed ? {} : { absences: withoutAbsenceAnswer(state.absences, key) }),
  };
  next = invalidateStaleTieResolutions(next, roundIndex, room);
  return next;
}

export function setFinalScore(
  state: TournamentState,
  key: string,
  value: string | number | null,
): TournamentState {
  const raw = value === '' || value === null ? null : String(value);
  const parsed = raw !== null && isValidNonNegativeInteger(raw) ? Number.parseInt(raw, 10) : '';
  const updated: TournamentState = {
    ...state,
    finalScores: { ...state.finalScores, [key]: parsed },
  };
  return progressGrandFinalRace(updated).state;
}

// Anonymous Finals matches (v1, individual formats only -- a team-format
// alias would need its own fabricated TournamentTeam/member list, since
// getFinalUnitScore's team branch reads real roster data via buildTeamMap()
// that an alias never has; out of scope, guarded below rather than half-built).

function findFinalRoundIndex(state: TournamentState): number {
  return state.rounds.findIndex((round) => round.isFinal);
}

export function flagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  if (getGameFormat(state.gameFormat)?.teamSize) return state;
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  // Grand-final race progression (progressGrandFinalRace) decides whether to
  // open the next game by reading the two real finalists' own keys directly
  // -- an anonymous game's score living under its alias instead would stall
  // the race forever. Out of scope for v1, not a half-built workaround.
  // A Best-of Final reads its games' scores the same way, by the finalists' real keys.
  if (!round || round.bracket === 'grand-final' || round.bestOf !== undefined) return state;
  const numGames = round.numGames ?? 0;
  if (!Number.isInteger(gameNumber) || gameNumber < 1 || gameNumber > numGames) return state;
  if (round.anonymousGames?.includes(gameNumber)) return state;
  const assignments = state.assignments[roundIndex] ?? [];
  const alreadyScored = assignments.some(
    (assignment) => getFinalUnitScore(state, assignment.name, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;

  if (assignments.length === 0 || assignments.length > MAX_ANONYMOUS_FINALISTS) return state;

  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: [...(entry.anonymousGames ?? []), gameNumber] }
      : entry,
  );
  return withFinalistAliasesForLineup({ ...state, rounds });
}

export function unflagFinalGameAnonymous(state: TournamentState, gameNumber: number): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round?.anonymousGames?.includes(gameNumber)) return state;
  const alreadyScored = state.anonymousFinalists.some(
    (finalist) => getFinalUnitScore(state, finalist.alias, gameNumber, null) !== null,
  );
  if (alreadyScored) return state;
  const rounds = state.rounds.map((entry, index) =>
    index === roundIndex
      ? { ...entry, anonymousGames: (entry.anonymousGames ?? []).filter((game) => game !== gameNumber) }
      : entry,
  );
  return { ...state, rounds };
}

export function connectAnonymousFinalist(state: TournamentState, alias: string): TournamentState {
  const roundIndex = findFinalRoundIndex(state);
  const round = state.rounds[roundIndex];
  if (!round || !isPlainFinalFullyScored(state, roundIndex, round)) return state;
  const finalist = state.anonymousFinalists.find((entry) => entry.alias === alias);
  if (!finalist || finalist.connected) return state;
  const anonymousGames = round.anonymousGames ?? [];
  const finalScores = { ...state.finalScores };
  for (const gameNumber of anonymousGames) {
    const anonKey = `game${gameNumber}-${alias}`;
    const realKey = `game${gameNumber}-${finalist.realKey}`;
    if (finalScores[realKey] == null || finalScores[realKey] === '') {
      finalScores[realKey] = finalScores[anonKey] ?? null;
    }
  }
  const anonymousFinalists = state.anonymousFinalists.map((entry) =>
    entry.alias === alias ? { ...entry, connected: true } : entry,
  );
  return { ...state, finalScores, anonymousFinalists };
}

export function resolveTournamentTie(state: TournamentState, key: string, name: string): TournamentState {
  const { ranked, shared } = readTieResolution(state, key);
  if (shared.length > 0) return state;
  const list = [...ranked];
  if (!list.includes(name)) list.push(name);
  return {
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: list },
  };
}

/** The room tie behind a tie key (`r{round}-rm{room}-s{score}`) when it is a current tie of a pooling round. */
function poolingRoomTie(state: TournamentState, key: string) {
  const roundIndex = Number(/^r(\d+)-rm\d+-s/u.exec(key)?.[1]);
  const round = state.rounds[roundIndex];
  if (!round || !isPoolingRound(round)) return null;
  return detectTieBreaks(roundIndex, round, state)[key] ?? null;
}

/**
 * Share the points of the places a room tie still covers: `names` must be exactly the tied units not yet ranked
 * (two or more). Stored as the ranked picks, the shared mark, then the sharing units. Pooling rounds only.
 */
export function shareTiedPoints(state: TournamentState, key: string, names: string[]): TournamentState {
  const tie = poolingRoomTie(state, key);
  if (!tie || isTieResolved(key, tie, state)) return state;
  const { ranked } = readTieResolution(state, key);
  const unranked = tie.players.map((player) => player.name).filter((name) => !ranked.includes(name));
  const exact = names.length === unranked.length && unranked.every((name) => names.includes(name));
  if (names.length < 2 || !exact) return state;
  return {
    ...state,
    tieResolutions: { ...state.tieResolutions, [key]: [...ranked, SHARED_TIE_MARK, ...names] },
  };
}

/** Why a rename or a swap of a roster unit is refused, the first of its checks that failed. */
export type RosterEditRefusal =
  | 'empty-name'
  | 'same-name'
  | 'duplicate-name'
  | 'withdrawn-name'
  | 'unstorable-name'
  | 'swap-closed'
  | 'not-in-play'
  | 'not-a-team-format';

/** "Done, with the new state", or the reason it was refused (the state is then not changed). */
export type RosterEditResult =
  { status: 'done'; state: TournamentState } | { status: 'refused'; reason: RosterEditRefusal };

const refused = (reason: RosterEditRefusal): RosterEditResult => ({ status: 'refused', reason });

export function renameIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const result = renameIndividualResult(state, oldName, newName);
  return result.status === 'done' ? result.state : state;
}

export function renameIndividualResult(
  state: TournamentState,
  oldName: string,
  newName: string,
): RosterEditResult {
  const trimmed = newName.trim();
  if (!trimmed) return refused('empty-name');
  if (trimmed === oldName) return refused('same-name');
  if (findUnit(state.players, trimmed) !== undefined || findUnit(state.reserves, trimmed) !== undefined) {
    return refused('duplicate-name');
  }
  if (isWithdrawnName(state, trimmed)) return refused('withdrawn-name');
  if (findUnstorableNames([trimmed]).length) return refused('unstorable-name');
  const rename = (name: string) => (name === oldName ? trimmed : name);
  const finalScores: TournamentState['finalScores'] = {};
  for (const [key, score] of Object.entries(state.finalScores)) {
    const match = key.match(/^(game\d+)-(.*)$/u);
    finalScores[match?.[2] === oldName ? `${match[1]}-${trimmed}` : key] = score;
  }
  const renamed: TournamentState = {
    ...state,
    players: (state.players as string[]).map(rename),
    reserves: (state.reserves as string[]).map(rename),
    ...renameInSchedule(state, rename),
    tieResolutions: Object.fromEntries(
      Object.entries(state.tieResolutions).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(rename) : rename(value),
      ]),
    ),
    finalScores,
  };
  return {
    status: 'done',
    state: moveBackMark(moveConfirmation(renamed, oldName, trimmed), oldName, trimmed),
  };
}

function rebuildFutureRounds(state: TournamentState): TournamentState | null {
  const round = state.rounds[state.curRound];
  if (!round?.isNoElim || state.cfg.poolingPhase === 'group-stage') return state;
  const format = getGameFormat(state.gameFormat);
  if (!format) return null;
  const config = generatedConfig(state);
  if (!config || !config.bracketPhase) return null;
  const progression = buildScheduleRounds({
    bracketPhase: config.bracketPhase,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    config: {
      n: rosterKeys(state.players).length,
      qualAdv: state.cfg.qualAdv ?? rosterKeys(state.players).length,
      ...groupSettingsOfCfg(state.cfg),
      ...(state.cfg.groupExit ? { groupExit: state.cfg.groupExit } : {}),
    },
    format: config,
    roster: rosterKeys(state.players),
  });
  // A builder that refuses is not caught here, as before: the message is the builder's own.
  if (!progression.ok) throw new Error(progression.error);
  const rounds = [
    ...state.rounds.slice(0, state.curRound + 1),
    ...progression.rounds.slice(state.curRound + 1),
  ];
  if (validateRoomCap(rounds, format)) return null;
  const emptyTail = Array.from(
    { length: Math.max(0, rounds.length - state.curRound - 1) },
    () => [] as string[],
  );
  return {
    ...state,
    rounds,
    assignments: state.assignments.slice(0, state.curRound + 1),
    byes: [...state.byes.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
    luckyLosers: [...state.luckyLosers.slice(0, state.curRound + 1), ...emptyTail.map(() => [])],
  };
}

/**
 * A waterfall keeps its graph rounds (they are fitted to the real head count at each advance, and a re-plan would
 * discard live graph edits), but the pooling rounds before them are not part of the graph: reshape the ones not
 * yet reached for the roster count, so the Bracket shows the sizes the draw will use.
 */
function refitFuturePoolingRounds(state: TournamentState): TournamentState {
  const config = generatedConfig(state);
  if (!config) return state;
  const { roomSize } = config;
  const count = rosterKeys(state.players).length;
  const rounds = state.rounds.map((round, index) =>
    index > state.curRound && round.isNoElim && !round.isGroupStage && !round.isWaterfall
      ? refitPoolingRound(round, count, roomSize, state.gamemodeConfig.oddCountStrategy)
      : round,
  );
  return { ...state, rounds };
}

/**
 * Re-plans the not-yet-reached rounds for the new headcount after a removal,
 * the way a reserve join does. Skipped for fixed draws (their published rounds
 * were already patched) and waterfall brackets (an exact-headcount graph), except that the built-in upper and
 * lower bracket works its rooms out again while the bracket is not entered (`replanUpperLower`), fixed draw or not. A
 * rebuild that fails, or that would leave an elimination round meant to keep
 * more units than reach it (e.g. explicit targets above the new headcount),
 * is dropped: the rounds stay as planned and advancing fits each one when it
 * is reached. A removal is never blocked by it.
 */
function replanFutureRounds(state: TournamentState): TournamentState {
  const replanned = replanUpperLower(state);
  if (state.gamemodeConfig.drawPublication === 'fixed') return replanned;
  if (state.gamemodeConfig.bracketPhase === 'waterfall-bracket') return refitFuturePoolingRounds(replanned);
  const rebuilt = rebuildFutureRounds(state);
  if (!rebuilt) return state;
  const coherent = rebuilt.rounds.every(
    (round) => round.advPerRoom === null || round.advTotal <= round.players,
  );
  return coherent ? rebuilt : state;
}

/** Why a walk-up can't join the draw but may still wait on the bench for a ⇄ Swap. */
export type BenchReason = 'group-stage' | 'fixed-draw' | 'waterfall-bracket';

const isBenchReason = (reason: string): reason is BenchReason =>
  reason === 'group-stage' || reason === 'fixed-draw' || reason === 'waterfall-bracket';

export type ReserveAddResult =
  | { status: 'added'; state: TournamentState }
  | {
      status: 'blocked';
      reason:
        | 'closed'
        | 'group-stage'
        | 'fixed-draw'
        | 'waterfall-bracket'
        | 'strict-room'
        | 'room-cap'
        | 'duplicate-name'
        | 'withdrawn-name'
        | 'no-members'
        | 'unstorable-name';
    }
  | { status: 'blocked'; reason: 'generation'; message: string }
  | { status: 'benched'; reason: BenchReason; state: TournamentState }
  | { status: 'confirm-over-cap'; room: number; count: number }
  | { status: 'confirm-late-join'; missedRounds: number };

export interface ReserveAddOptions {
  allowOverCap?: boolean;
  allowLateJoin?: boolean;
}

/**
 * Counted pooling rounds a unit added now would miss: the qualification/Swiss
 * rounds up to and including the one in play. The leading non-counting rounds
 * (`excludeFromStandings`) are played but earn nothing, so they don't count.
 */
export function missedCountedRounds(state: Pick<TournamentState, 'rounds' | 'curRound'>): number {
  return state.rounds
    .slice(0, state.curRound + 1)
    .filter((round) => (round.isQual || round.isSwiss) && !round.excludeFromStandings).length;
}

// The count after one more unit would leave a unit out of every pooling round
// when "None" (pair everyone, no byes) is the odd-count strategy -- the same
// condition generation refuses at the start.
function breaksStrictPooling(state: TournamentState): boolean {
  const format = getGameFormat(state.gameFormat);
  const poolingPhase = state.cfg.poolingPhase ?? 'none';
  return Boolean(
    format?.supportedOddCountStrategies &&
    state.gamemodeConfig.oddCountStrategy === 'none' &&
    poolingPhase !== 'none' &&
    poolingPhase !== 'group-stage' &&
    (state.players.length + 1) % (format.idealRoomSize as number) !== 0,
  );
}

function moveReserveToPlayers(state: TournamentState, key: string): TournamentState | null {
  const format = getGameFormat(state.gameFormat);
  if (!format) return null;
  if (!format.teamSize) {
    return {
      ...state,
      players: withUnit(state.players, key),
      reserves: withoutUnit(state.reserves, key),
    };
  }
  const team = findUnit(state.reserves, key);
  if (typeof team !== 'object') return null;
  return {
    ...state,
    players: withUnit(state.players, team),
    reserves: withoutUnit(state.reserves, key),
  };
}

// A tournament without a pooling phase: the reserve window ends with its first
// bracket round, and a unit added during it is seated in that round, in the
// least-full room.
function seatInRoundInPlay(
  state: TournamentState,
  key: string,
  options: ReserveAddOptions,
): ReserveAddResult {
  const config = generatedConfig(state);
  const round = state.rounds[state.curRound];
  if (!getGameFormat(state.gameFormat) || !config || !round) return { status: 'blocked', reason: 'room-cap' };
  const { roomSize } = config;
  const assignments = state.assignments[state.curRound] ?? [];
  let room = 1;
  let count = assignments.filter((entry) => entry.room === room).length;
  for (let candidate = 2; candidate <= round.rooms.length; candidate += 1) {
    const candidateCount = assignments.filter((entry) => entry.room === candidate).length;
    if (candidateCount < count) {
      room = candidate;
      count = candidateCount;
    }
  }
  if (count >= roomSize.max && state.gamemodeConfig.oddCountStrategy === 'none') {
    return { status: 'blocked', reason: 'strict-room' };
  }
  if (count >= roomSize.max && !options.allowOverCap) {
    return { status: 'confirm-over-cap', room, count };
  }
  const moved = moveReserveToPlayers(state, key);
  if (!moved) return { status: 'blocked', reason: 'room-cap' };
  const nextAssignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  nextAssignments[state.curRound] = [
    ...(nextAssignments[state.curRound] ?? []),
    { name: key, room, isLucky: false },
  ];
  const rebuilt = rebuildFutureRounds({ ...moved, assignments: nextAssignments });
  if (!rebuilt) return { status: 'blocked', reason: 'room-cap' };
  return { status: 'added', state: rebuilt };
}

/**
 * Before Confirm & Start a joiner is part of the draw: with no rounds yet it just joins the roster, with
 * rounds the schedule is redone for the new head count and generation is the only judge. Null when the
 * tournament has started, or has no stored settings to redo the schedule from (no Generate has run).
 */
function addBeforeStart(
  state: TournamentState,
  key: string,
  runtime: TournamentRuntime,
): ReserveAddResult | null {
  if (state.started) return null;
  const moved = moveReserveToPlayers(state, key);
  if (!moved) return { status: 'blocked', reason: 'room-cap' };
  if (!state.rounds.length) {
    return { status: 'added', state: { ...moved, confirmedCount: rosterKeys(moved.players).length } };
  }
  const regenerated = regenerateForRoster(moved, runtime);
  if (regenerated.status === 'generated') return { status: 'added', state: regenerated.state };
  if (regenerated.status === 'invalid') {
    return { status: 'blocked', reason: 'generation', message: regenerated.message };
  }
  return null;
}

/**
 * Why the draw can't take a newcomer, or null when it can: a group stage; a fixed draw (its whole schedule was
 * published at generation time, with no mechanism to fold a joiner into an already-decided round: blocking is far lower
 * risk than silently rewriting a draw players may have seen); a Custom bracket with no pooling phase (its routing is an
 * exact-headcount graph with nothing to absorb a late arrival; with a pooling phase the pooling exit refits the first
 * round to whoever arrives).
 */
function drawCannotTakeNewcomer(state: TournamentState): BenchReason | null {
  if (state.cfg.poolingPhase === 'group-stage') return 'group-stage';
  if (state.gamemodeConfig.drawPublication === 'fixed') return 'fixed-draw';
  if (state.scheduleLogic === 'waterfall-bracket' && state.cfg.poolingPhase === 'none') {
    return 'waterfall-bracket';
  }
  return null;
}

export function addReserveUnit(
  state: TournamentState,
  key: string,
  options: ReserveAddOptions = {},
  runtime: TournamentRuntime = createTournamentRuntime(),
): ReserveAddResult {
  if (!state.reserveOpen) return { status: 'blocked', reason: 'closed' };
  const beforeStart = addBeforeStart(state, key, runtime);
  if (beforeStart) return beforeStart;
  const undrawable = drawCannotTakeNewcomer(state);
  if (undrawable) return { status: 'blocked', reason: undrawable };
  const isWaterfall = state.scheduleLogic === 'waterfall-bracket';
  const round = state.rounds[state.curRound];
  if (!round?.isNoElim || round.isGroupStage) return seatInRoundInPlay(state, key, options);

  // A pooling round in play stays as drawn: the joiner sits it out and is
  // drawn in, with everyone else, when the round advances.
  if (breaksStrictPooling(state)) return { status: 'blocked', reason: 'strict-room' };
  const missedRounds = missedCountedRounds(state);
  if (missedRounds >= 2 && !options.allowLateJoin) {
    return { status: 'confirm-late-join', missedRounds };
  }
  const moved = moveReserveToPlayers(state, key);
  if (!moved) return { status: 'blocked', reason: 'room-cap' };
  if (isWaterfall) return { status: 'added', state: replanUpperLower(refitFuturePoolingRounds(moved)) };
  const rebuilt = rebuildFutureRounds(moved);
  if (!rebuilt) return { status: 'blocked', reason: 'room-cap' };
  return { status: 'added', state: rebuilt };
}

/**
 * Why a walk-up would stay on the bench now, or null: the same test `addWalkUpIndividual` / `addWalkUpTeam` end with, for the
 * Reserves panel to say what its ＋ does. Only after the start, while reserves are open and the swap window is.
 */
export function benchReasonOf(state: TournamentState): BenchReason | null {
  if (!state.started || !state.reserveOpen || !swapWindowOpen(state)) return null;
  return drawCannotTakeNewcomer(state);
}

/**
 * A walk-up refused only because the draw can't take a newcomer (a group stage, a fixed draw, a custom bracket)
 * stays on the bench while a swap can still use it: `benched` carries the state with it in the reserves. The swap
 * window check is a safety net: `reserveOpen` already closes with the first elimination round (a unit out in the
 * round in play has no rank yet), so the two windows end together and `closed` is answered first.
 */
function benchIfSwappable(
  before: TournamentState,
  withReserve: TournamentState,
  result: ReserveAddResult,
): ReserveAddResult {
  if (result.status !== 'blocked' || !isBenchReason(result.reason) || !swapWindowOpen(before)) return result;
  return { status: 'benched', reason: result.reason, state: withReserve };
}

export function addWalkUpIndividual(
  state: TournamentState,
  name: string,
  options: ReserveAddOptions = {},
  runtime?: TournamentRuntime,
): ReserveAddResult {
  const trimmed = name.trim();
  if (!trimmed || getGameFormat(state.gameFormat)?.teamSize) {
    return { status: 'blocked', reason: 'room-cap' };
  }
  if (findUnit(state.players, trimmed) !== undefined || findUnit(state.reserves, trimmed) !== undefined) {
    return { status: 'blocked', reason: 'duplicate-name' };
  }
  if (isWithdrawnName(state, trimmed)) return { status: 'blocked', reason: 'withdrawn-name' };
  if (findUnstorableNames([trimmed]).length) return { status: 'blocked', reason: 'unstorable-name' };
  const withReserve = { ...state, reserves: withUnit(state.reserves, trimmed) };
  return benchIfSwappable(state, withReserve, addReserveUnit(withReserve, trimmed, options, runtime));
}

/** Adds a brand-new team: it joins the reserves and is admitted at once, like a walk-up individual. */
export function addWalkUpTeam(
  state: TournamentState,
  team: TournamentTeam,
  options: ReserveAddOptions = {},
  runtime?: TournamentRuntime,
): ReserveAddResult {
  if (!getGameFormat(state.gameFormat)?.teamSize) return { status: 'blocked', reason: 'room-cap' };
  if (team.members.every((member) => !member)) return { status: 'blocked', reason: 'no-members' };
  if (isDisplayNameTaken(state, team.teamName)) return { status: 'blocked', reason: 'duplicate-name' };
  if (findUnstorableNames(teamNames(team)).length) return { status: 'blocked', reason: 'unstorable-name' };
  const withReserve = { ...state, reserves: withUnit(state.reserves, team) };
  return benchIfSwappable(state, withReserve, addReserveUnit(withReserve, team.teamId, options, runtime));
}

export function removeReserveUnit(state: TournamentState, key: string): TournamentState {
  return { ...state, reserves: withoutUnit(state.reserves, key) };
}

function removeUnitFromCurrentRoom(state: TournamentState, key: string): TournamentState {
  const roundIndex = roundInPlayOf(state, key);
  const assignments = state.assignments[roundIndex] ?? [];
  const found = assignments.find((entry) => entry.name === key);
  if (!found || found.room === null) {
    return {
      ...state,
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    };
  }
  const room = found.room;
  const roomUnits = assignments.filter((entry) => entry.room === room);
  const position = roomUnits.findIndex((entry) => entry.name === key);
  const scores = { ...state.scores };
  const round = state.rounds[roundIndex];
  const keysAtPosition = (positionIndex: number) =>
    scoreKeysForPosition({
      roundIndex,
      room,
      position: positionIndex,
      numGames: Math.max(round.numGames ?? 1, 1),
      teamSize: scoredTeamSize(state),
    });

  for (let index = position + 1; index < roomUnits.length; index += 1) {
    const from = keysAtPosition(index);
    const to = keysAtPosition(index - 1);
    from.forEach((fromKey, offset) => {
      const toKey = to[offset];
      if (scores[fromKey] !== undefined) scores[toKey] = scores[fromKey];
      else delete scores[toKey];
    });
  }
  for (const scoreKey of keysAtPosition(roomUnits.length - 1)) delete scores[scoreKey];
  return invalidateStaleTieResolutions(
    {
      ...state,
      scores,
      absences: withSeatsShiftedUp(state.absences, roundIndex, room, position),
      assignments: state.assignments.map((entries, index) =>
        index === roundIndex ? entries.filter((entry) => entry.name !== key) : entries,
      ),
    },
    roundIndex,
    room,
  );
}

/** The other name in a group-stage pair, given one of its two members. */
function otherMember(pair: [string, string], key: string): string {
  return pair[0] === key ? pair[1] : pair[0];
}

/**
 * Patches every not-yet-reached group-stage round (index > state.curRound)
 * so a roster change already applied to state.groups doesn't leave a ghost
 * name baked into that round's matches/groupByes -- removeRosterUnit's
 * strip() and swapIndividual/swapTeam's groups remap only ever touch
 * state.groups, never the future TournamentRound objects that were built
 * from group membership once, upfront, at generation time.
 *
 * newKey === null means "removed": oldKey's future match becomes a bye for
 * its surviving opponent -- the same fallback buildRoundRobinRounds already
 * uses when a group's own round-robin schedule runs out early. If oldKey was
 * already scheduled as a bye that round, it's simply dropped. Either way,
 * rooms/byeCount/players are recomputed, and a dropped match's roomGroups
 * entry (same index) is filtered in lockstep so room numbers -- derived
 * fresh from array position by seedFromGroupStageRound/BracketView -- keep
 * lining up with the right group label after the shift.
 *
 * newKey is a string for "swapped": oldKey is relabeled to newKey wherever
 * it appears. Group size is unchanged by a swap, so rooms/byeCount/players/
 * roomGroups are left untouched.
 *
 * A no-op outside group-stage pooling.
 */
function patchFutureGroupStageRounds(
  state: TournamentState,
  oldKey: string,
  newKey: string | null,
): TournamentRound[] {
  if (state.cfg.poolingPhase !== 'group-stage') return state.rounds;

  return state.rounds.map((round, index) => {
    if (index <= state.curRound || !round.isGroupStage) return round;
    const matches = round.matches ?? [];
    const groupByes = round.groupByes ?? [];

    if (newKey !== null) {
      const relabel = (name: string) => (name === oldKey ? newKey : name);
      const touchesOldKey =
        matches.some((match) => match.pair.includes(oldKey)) || groupByes.includes(oldKey);
      if (!touchesOldKey) return round;
      return {
        ...round,
        matches: matches.map((match) => ({ ...match, pair: match.pair.map(relabel) as [string, string] })),
        groupByes: groupByes.map(relabel),
      };
    }

    if (groupByes.includes(oldKey)) {
      const nextGroupByes = groupByes.filter((name) => name !== oldKey);
      return {
        ...round,
        groupByes: nextGroupByes,
        byeCount: nextGroupByes.length,
        players: round.players - 1,
      };
    }

    const matchIndex = matches.findIndex((match) => match.pair.includes(oldKey));
    if (matchIndex < 0) return round;
    const survivor = otherMember(matches[matchIndex].pair, oldKey);
    const nextMatches = matches.filter((_, position) => position !== matchIndex);
    const nextRoomGroups = round.roomGroups?.filter((_, position) => position !== matchIndex);
    const nextGroupByes = [...groupByes, survivor];
    return {
      ...round,
      matches: nextMatches,
      roomGroups: nextRoomGroups,
      groupByes: nextGroupByes,
      rooms: nextMatches.map(() => 2),
      byeCount: nextGroupByes.length,
      players: round.players - 1,
    };
  });
}

/**
 * Applies a roster change (removal when newKey is null, else a swap) to every
 * pre-published future round -- Group Stage's baked-in matches and a
 * fixed-draw tournament's fixedRoomAssignments. For fixed draws, roomHistory/
 * poolingByeCounts are then rebuilt, since generation folded the whole
 * published schedule into both and their future part just changed.
 */
function patchPublishedFutureRounds(
  state: TournamentState,
  oldKey: string,
  newKey: string | null,
): TournamentState {
  const groupPatched = patchFutureGroupStageRounds(state, oldKey, newKey);
  const rounds = patchFutureFixedDrawRounds(groupPatched, state.curRound, oldKey, newKey);
  const hasFixedFuture = rounds.some((round, index) => index > state.curRound && round.fixedRoomAssignments);
  if (!hasFixedFuture) return { ...state, rounds };
  return { ...state, rounds, ...rebuildFixedDrawHistory(rounds, state.assignments, state.curRound) };
}

/** A removed unit must not be drawn into a later round it was only waiting for. */
function withoutPendingUnit(
  pools: TournamentState['pendingBracketSeeds'],
  key: string,
): TournamentState['pendingBracketSeeds'] {
  return Object.fromEntries(
    Object.entries(pools).map(([destination, seeds]) => [
      destination,
      seeds.filter((seed) => seed.name !== key),
    ]),
  );
}

export function removeRosterUnit(state: TournamentState, key: string): TournamentState {
  let next = removeUnitFromCurrentRoom(recordWithdrawal(state, key, 'removed'), key);
  const strip = (values: string[]) => values.filter((name) => name !== key);
  const tieResolutions = Object.fromEntries(
    Object.entries(next.tieResolutions).map(([tieKey, value]) => {
      const filtered = (Array.isArray(value) ? value : [value]).filter((name) => name !== key);
      return [tieKey, Array.isArray(value) ? filtered : (filtered[0] ?? '')];
    }),
  );
  next = {
    ...next,
    players: withoutUnit(next.players, key),
    reserves: withoutUnit(next.reserves, key),
    qualTable: next.qualTable.filter((entry) => entry.name !== key),
    pendingBracketSeeds: withoutPendingUnit(next.pendingBracketSeeds, key),
    luckyLosers: next.luckyLosers.map(strip),
    byes: next.byes.map(strip),
    groups: next.groups.map((group) => ({ ...group, members: strip(group.members) })),
    tieResolutions,
  };
  return replanFutureRounds(patchPublishedFutureRounds(next, key, null));
}

/**
 * Records `key`'s outgoing display info before it's stripped from
 * state.players -- must be called with the pre-removal `state`, since
 * unitDisplay()/hasPlayedAnyMatch() both depend on state.players/reserves/
 * assignments still containing `key`. A team's display name doesn't survive
 * being removed from the roster (the live TournamentTeam object is gone),
 * so this snapshot is the only place that information can still be captured.
 */
function recordWithdrawal(
  state: TournamentState,
  key: string,
  reason: WithdrawnUnit['reason'],
  replacedBy?: string,
): TournamentState {
  const info = unitDisplay(state, key);
  const absentRound = reason === 'swapped' ? inheritedAbsentRound(state, key) : undefined;
  const entry: WithdrawnUnit = {
    name: key,
    label: info.label,
    members: info.members,
    playedAnyMatch: hasPlayedAnyMatch(state, key),
    reason,
    round: state.curRound,
    ...(replacedBy === undefined ? {} : { replacedBy }),
    ...(absentRound === undefined ? {} : { absentRound }),
  };
  return { ...state, withdrawnUnits: [...state.withdrawnUnits, entry] };
}

/**
 * The round of the seat a swap of `key` leaves to the replacement as an absence: the round in play, when `key` is seated
 * in a room and absent from it. Undefined for any other swap, which clears the seat.
 */
function inheritedAbsentRound(state: TournamentState, key: string): number | undefined {
  const roundIndex = roundInPlayOf(state, key);
  const seated = (state.assignments[roundIndex] ?? []).filter((entry) => entry.room !== null);
  const found = seated.find((entry) => entry.name === key);
  if (found === undefined || found.room === null) return undefined;
  const room = found.room;
  const position = seated.filter((entry) => entry.room === room).findIndex((entry) => entry.name === key);
  return isUnitAbsentFromRoom(state, roundIndex, room, position) ? roundIndex : undefined;
}

function replaceAssignedUnit(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  const assignments = state.assignments.map((entries) => entries.map((entry) => ({ ...entry })));
  const roundIndex = roundInPlayOf(state, oldKey);
  const current = assignments[roundIndex] ?? [];
  const assignmentIndex = current.findIndex((entry) => entry.name === oldKey);
  if (assignmentIndex < 0) return null;

  const room = current[assignmentIndex].room;
  const position = current.filter((entry) => entry.room === room).findIndex((entry) => entry.name === oldKey);
  current[assignmentIndex].name = newKey;

  const scores = { ...state.scores };
  let absences = state.absences;
  // A unit marked absent leaves its seat's 0 and answer to the replacement, who missed that round too.
  if (room !== null && inheritedAbsentRound(state, oldKey) === undefined) {
    absences = withoutSeatAbsences(absences, roundIndex, room, position);
    for (const key of scoreKeysForPosition({
      roundIndex,
      room,
      position,
      numGames: Math.max(state.rounds[roundIndex].numGames ?? 1, 1),
      teamSize: scoredTeamSize(state),
    }))
      delete scores[key];
  }

  let next: TournamentState = {
    ...state,
    scores,
    absences,
    assignments,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    byes: state.byes.map((values, index) =>
      index === roundIndex ? values.map((name) => (name === oldKey ? newKey : name)) : values,
    ),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
  if (room !== null) next = invalidateStaleTieResolutions(next, roundIndex, room);
  return next;
}

function movePoolingByeCount(counts: Record<string, number>, oldKey: string, newKey: string) {
  if (counts[oldKey] === undefined) return counts;
  const { [oldKey]: moved, ...rest } = counts;
  return { ...rest, [newKey]: moved };
}

/**
 * A unit that has earned a place in a later round but isn't seated yet (it waits in a
 * pendingBracketSeeds pool) is replaced in place: the substitute takes the slot the
 * absentee earned, tierRank/pct/isLucky included. Null if the unit waits in no pool.
 */
function replacePendingUnit(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  const pools = Object.entries(state.pendingBracketSeeds);
  if (!pools.some(([, seeds]) => seeds.some((seed) => seed.name === oldKey))) return null;
  const pendingBracketSeeds = Object.fromEntries(
    pools.map(([destination, seeds]) => [
      destination,
      seeds.map((seed) => (seed.name === oldKey ? { ...seed, name: newKey } : seed)),
    ]),
  );
  return {
    ...state,
    pendingBracketSeeds,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
}

/**
 * A late joiner of the pooling round in play sits in no line-up yet, so there is no seat to hand over:
 * only its ranking-table row and bye count move. The roster swap that follows puts the substitute in
 * `players` unseated, so it is itself a late joiner, drawn in at the next advance. Null if the unit is
 * not a late joiner of the round in play.
 */
function replaceLateJoiner(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  if (!lateJoinersOf(state, state.curRound).includes(oldKey)) return null;
  return {
    ...state,
    qualTable: state.qualTable.filter((entry) => entry.name !== oldKey),
    poolingByeCounts: movePoolingByeCount(state.poolingByeCounts, oldKey, newKey),
  };
}

/**
 * Seated in the current round, else waiting in a pending pool, else a late joiner of the pooling round
 * in play, else not in play (null).
 */
function replaceUnitInPlay(state: TournamentState, oldKey: string, newKey: string): TournamentState | null {
  return (
    replaceAssignedUnit(state, oldKey, newKey) ??
    replacePendingUnit(state, oldKey, newKey) ??
    replaceLateJoiner(state, oldKey, newKey)
  );
}

/**
 * Reserves can stand in for an absentee only until anyone has been eliminated, in every format: until a round that
 * eliminated someone has been advanced. A unit already out in the round still in play (it has no rank yet) does not
 * close the window, as an absentee in a room not played yet can still be swapped.
 */
export function swapWindowOpen(state: TournamentState): boolean {
  return !computeRankings(state)?.eliminatedList.some((entry) => entry.rank !== null);
}

/**
 * The swap itself, once the incoming unit passed its checks: the outgoing unit leaves the roster (recorded as swapped
 * out), the incoming one takes its seat everywhere, and the bench gives it up if it sat there.
 */
function swapUnit(
  state: TournamentState,
  outgoingKey: string,
  incoming: string | TournamentTeam,
): RosterEditResult {
  const incomingKey = rosterKey(incoming);
  const replaced = replaceUnitInPlay(state, outgoingKey, incomingKey);
  if (!replaced) return refused('not-in-play');
  const withdrawn = recordWithdrawal(state, outgoingKey, 'swapped', incomingKey);

  return {
    status: 'done',
    state: patchPublishedFutureRounds(
      {
        ...replaced,
        withdrawnUnits: withdrawn.withdrawnUnits,
        players: withUnit(withoutUnit(state.players, outgoingKey), incoming),
        reserves: withoutUnit(state.reserves, incomingKey),
        groups: state.groups.map((group) => ({
          ...group,
          members: group.members.map((name) => (name === outgoingKey ? incomingKey : name)),
        })),
      },
      outgoingKey,
      incomingKey,
    ),
  };
}

export function swapIndividual(state: TournamentState, oldName: string, newName: string): TournamentState {
  const result = swapIndividualResult(state, oldName, newName);
  return result.status === 'done' ? result.state : state;
}

export function swapIndividualResult(
  state: TournamentState,
  oldName: string,
  newName: string,
): RosterEditResult {
  const trimmed = newName.trim();
  if (!trimmed) return refused('empty-name');
  if (findUnit(state.players, trimmed) !== undefined) return refused('duplicate-name');
  if (isWithdrawnName(state, trimmed)) return refused('withdrawn-name');
  if (findUnstorableNames([trimmed]).length) return refused('unstorable-name');
  if (!swapWindowOpen(state)) return refused('swap-closed');
  return swapUnit(state, oldName, trimmed);
}

export function swapTeam(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): TournamentState {
  const result = swapTeamResult(state, oldTeamId, replacement);
  return result.status === 'done' ? result.state : state;
}

export function swapTeamResult(
  state: TournamentState,
  oldTeamId: string,
  replacement: TournamentTeam,
): RosterEditResult {
  const format = getGameFormat(state.gameFormat);
  const teamSize = format?.teamSize;
  if (!teamSize) return refused('not-a-team-format');
  if (!swapWindowOpen(state)) return refused('swap-closed');
  if (findUnit(state.players, replacement.teamId) !== undefined) return refused('duplicate-name');
  // The outgoing team is being removed by this same swap and the replacement may be
  // taken from the reserves, so neither counts as a name collision.
  if (isDisplayNameTaken(state, replacement.teamName, [oldTeamId, replacement.teamId])) {
    return refused('duplicate-name');
  }
  if (findUnstorableNames(teamNames(replacement)).length) return refused('unstorable-name');
  return swapUnit(state, oldTeamId, replacement);
}

export function updateTeam(
  state: TournamentState,
  teamId: string,
  updater: (team: TournamentTeam) => TournamentTeam,
): TournamentState {
  let refused = false;
  const players = (state.players as TournamentTeam[]).map((team) => {
    if (team.teamId !== teamId) return team;
    const updated = updater({ ...team, members: [...team.members] });
    // Only names the update introduced: a name stored before names were checked doesn't lock its team.
    const added = teamNames(updated).filter((name) => !teamNames(team).includes(name));
    refused = findUnstorableNames(added).length > 0;
    return updated;
  });
  return refused ? state : { ...state, players };
}

/** Renames one team member; their confirmation follows the new spelling. */
export function renameTeamMember(
  state: TournamentState,
  teamId: string,
  memberIndex: number,
  newName: string,
): TournamentState {
  const trimmed = newName.trim();
  const team = findUnit(state.players, teamId);
  const oldName = typeof team === 'object' ? team.members[memberIndex]?.name : undefined;
  if (!oldName || !trimmed || trimmed === oldName) return state;
  const renamed = updateTeam(state, teamId, (entry) => ({
    ...entry,
    members: entry.members.map((item, index) =>
      index === memberIndex && item ? { ...item, name: trimmed } : item,
    ),
  }));
  return renamed === state
    ? state
    : moveBackMark(moveConfirmation(renamed, oldName, trimmed), oldName, trimmed);
}

export function setTeamDefender(state: TournamentState, teamId: string, memberIdx: number): TournamentState {
  const changes = (state.defenderChanges[teamId] ?? []).map((entry) => ({ ...entry }));
  const round = roundInPlayOf(state, teamId);
  const previous = getDefenderIndex(state, teamId, round);
  const existing = changes.find((entry) => entry.round === round);
  if (existing) existing.memberIdx = memberIdx;
  else changes.push({ round, memberIdx });
  return {
    ...withDefenderKeysMoved(state, teamId, round, previous, memberIdx),
    defenderChanges: { ...state.defenderChanges, [teamId]: changes },
  };
}

/** Stores a loaded roster together with the format it was parsed for, so the two never disagree. */
export function withLoadedRoster(
  state: TournamentState,
  gameFormat: GameFormatKey,
  loaded: Pick<TournamentState, 'players' | 'reserves' | 'reserveIndividuals'>,
): TournamentState {
  return {
    ...state,
    gameFormat,
    players: loaded.players,
    reserves: loaded.reserves,
    reserveIndividuals: loaded.reserveIndividuals,
    confirmedCount: loaded.players.length,
  };
}

/**
 * Clears just the registered roster (players/reserves/individual reserves)
 * plus anything derived from it that would otherwise go stale -- the
 * generated schedule preview, if "Generate Schedule" was already clicked
 * pre-start. Deliberately preserves title/gameFormat/scheduleLogic/cfg (the
 * Setup configuration itself) -- the complement of resetTournamentState()
 * below, which preserves the roster but clears live progress.
 */
export function resetRoster(state: TournamentState): TournamentState {
  const { settings: _settings, ...rest } = withoutDrawnSchedule(state);
  return {
    ...rest,
    players: [],
    reserves: [],
    reserveIndividuals: [],
    confirmations: {},
    confirmedCount: null,
    withdrawnUnits: [],
    reserveOpen: true,
  };
}

/**
 * Clears everything a generated schedule put in the state (`emptySchedule`: the rounds, who is seated where,
 * standings, scores, the room history), keeping the roster, the Setup (`cfg`, the settings snapshot), the
 * withdrawals and the confirmations. A state with nothing generated yet.
 */
export function withoutDrawnSchedule(state: TournamentState): TournamentState {
  return { ...state, ...emptySchedule() };
}

/**
 * Back to a draft: the schedule as generated, with no play in it. Keeps the generated rounds, the groups and the
 * `gamemodeConfig` (the schedule itself) and the room history, and the roster as `withoutDrawnSchedule` does; it also
 * clears the withdrawals and opens the reserve again. The draw of round 1 goes (`assignments` is empty).
 */
export function resetTournamentState(state: TournamentState): TournamentState {
  const {
    rounds: _rounds,
    groups: _groups,
    roomHistory: _roomHistory,
    gamemodeConfig: _gamemodeConfig,
    ...play
  } = emptySchedule();
  return withFinalistAliasesForLineup({ ...state, ...play, withdrawnUnits: [], reserveOpen: true });
}
