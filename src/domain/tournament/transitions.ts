import { hasBlockingAbsenceQuestions, PENDING_ABSENCES_MESSAGE } from './absences';
import {
  doubleEliminationComputeAdvancement,
  hasPendingColumnTies,
  isStandingsCutoffRound,
  kingsValleyComputeAdvancement,
  orderedQualificationTable,
  refreshRoundStandings,
  roomBasedComputeAdvancement,
} from './advancement';
import { doubleEliminationContributions, routeStandings, routeWaterfallRound } from './bracket-replay';
import { nextPowerOf2AndRounds } from './double-elimination';
import { kingsValleyBracketPhase } from './kings-valley';
import { lateJoinersOf } from './late-joiners';
import { applyMatchFormats } from './round-match-formats';
import { seedFromGroupStageRound } from './pooling';
import { discardDrawsAfter, drawnAheadStatus } from './redraw';
import { fitRoundToPool } from './room-distribution';
import {
  avoidSameGroupInFirstBracketRound,
  recordRoomHistory,
  selectPoolingBye,
  sequentialSeed,
  swissFoldPair,
  tieredBracketSeed,
  tieredSeed,
  type SeedCandidate,
} from './seeding';
import type { PendingBracketSeed, RoundAssignment, TournamentRound, TournamentState } from './types';
import { declaredWaterfallSeats, fitWaterfallRound } from './waterfall-bracket';
import { currentColumn, isRoundDone, nextColumnStart, roundColumn } from './round-columns';

const PENDING_TIES_MESSAGE = 'Resolve all tie-breaks before advancing.';

type RoundAdvanceBlockReason =
  | 'pending-ties'
  | 'pending-absences'
  | 'malformed-final'
  | 'missing-room-size'
  | 'malformed-waterfall-round'
  | 'too-few-units';

type RoundAdvanceNoopReason = 'last-round' | 'grand-final';

type RoundAdvanceResult =
  | { status: 'advanced'; state: TournamentState }
  | {
      status: 'blocked';
      reason: RoundAdvanceBlockReason;
      message: string;
      state: TournamentState;
    }
  | {
      status: 'noop';
      reason: RoundAdvanceNoopReason;
      state: TournamentState;
    };

function cloneForTransition(state: TournamentState): TournamentState {
  return {
    ...state,
    rounds: state.rounds.map((round) => ({
      ...round,
      matches: round.matches?.map((match) => ({
        ...match,
        pair: [...match.pair] as [string, string],
      })),
      groupByes: round.groupByes ? [...round.groupByes] : undefined,
      roomGroups: round.roomGroups ? [...round.roomGroups] : undefined,
    })),
    assignments: state.assignments.map((round) => round.map((assignment) => ({ ...assignment }))),
    luckyLosers: state.luckyLosers.map((round) => [...round]),
    byes: state.byes.map((round) => [...round]),
    poolingByeCounts: { ...state.poolingByeCounts },
    roomHistory: { ...state.roomHistory },
    pendingBracketSeeds: Object.fromEntries(
      Object.entries(state.pendingBracketSeeds).map(([key, assignments]) => [
        key,
        assignments.map((assignment) => ({ ...assignment })),
      ]),
    ),
    qualTable: state.qualTable.map((entry) => ({ ...entry })),
    groupStandings: Object.fromEntries(
      Object.entries(state.groupStandings).map(([label, entries]) => [
        label,
        entries.map((entry) => ({ ...entry })),
      ]),
    ),
  };
}

function uniqueKeepingLast(candidates: SeedCandidate[]): SeedCandidate[] {
  const seen = new Set<string>();
  const output: SeedCandidate[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (seen.has(candidate.name)) continue;
    seen.add(candidate.name);
    output.unshift(candidate);
  }
  return output;
}

/**
 * A no-elimination pooling round advances everyone, but only the units seated in its rooms (and byes)
 * reach `advancing`. A unit added to the roster while the round was in play was never seated, so it is
 * drawn in with the others here.
 */
function withLateJoiners(advancing: SeedCandidate[], joiners: string[]): SeedCandidate[] {
  const present = new Set(advancing.map((entry) => entry.name));
  const absent = joiners.filter((name) => !present.has(name));
  return [...advancing, ...absent.map((name) => ({ name, isLucky: false }))];
}

/** Candidates for a bye: never a late joiner in their first round (a bye counts as a win), unless nobody else is left. */
function byeCandidates(advancing: SeedCandidate[], joiners: ReadonlySet<string>): SeedCandidate[] {
  const regular = advancing.filter((entry) => !joiners.has(entry.name));
  return regular.length ? regular : advancing;
}

/** The state mutation performed indirectly by legacy renderAdminRound(). */
function reserveWindowAtCurrentRound(state: Pick<TournamentState, 'cfg' | 'rounds' | 'curRound'>): boolean {
  let cutRound = -1;
  if (state.cfg.poolingPhase === 'group-stage') {
    for (const [index, round] of state.rounds.entries()) {
      if (round.isGroupStage) cutRound = index;
    }
  } else if (state.cfg.poolingPhase !== 'none') {
    for (const [index, round] of state.rounds.entries()) {
      if (round.isQual || round.isSwiss) cutRound = index;
    }
  } else {
    cutRound = state.rounds.findIndex((round) => !round.isNoElim && !round.isFinal);
  }
  return cutRound !== -1 && !isRoundDone(state, cutRound);
}

interface RoundFitFailure {
  reason: RoundAdvanceBlockReason;
  message: string;
}

/**
 * Reshapes round `roundIndex` (planned at generation for the starting
 * headcount) to the units that really reach it, writing the fitted round back
 * into `state.rounds`, so the seeders never see a different number of units
 * than seats (a mid-tournament removal, or any earlier mismatch). `byeCount`
 * is the number of byes actually chosen for it. Returns a failure to block
 * the advance with, or null.
 */
function fitNextRound(
  state: TournamentState,
  roundIndex: number,
  poolSize: number,
  byeCount: number,
): RoundFitFailure | null {
  const round = state.rounds[roundIndex];
  const roomSize = state.gamemodeConfig.roomSize;
  const withByes = round.byeCount === byeCount ? round : { ...round, byeCount };
  const seats = withByes.rooms.reduce((total, size) => total + size, 0);
  if (seats !== poolSize && !roomSize) {
    return { reason: 'missing-room-size', message: MISSING_ROOM_SIZE_MESSAGE };
  }
  const fitted = roomSize ? fitRoundToPool(withByes, poolSize, roomSize) : withByes;
  if ('error' in fitted) return { reason: 'too-few-units', message: fitted.error };
  state.rounds[roundIndex] = fitted;
  return null;
}

function malformedKingsValleyFinalMessage(actual: number): string {
  const reaching = actual <= 0 ? 'Nobody' : `Only ${actual} unit`;
  return `Can't advance -- ${reaching} would reach the Final, which needs at least 2 to play. This usually means enough units were removed mid-tournament; check Manage Teams before advancing.`;
}

/**
 * Re-plans the rest of Kings Valley (from `nextIndex` on, including the
 * Final) whenever the real survivor count reaching it differs from what was
 * planned at generation time -- a removal shrinking a room, or a reserve
 * added in the first Kings Valley round's still-open window, can otherwise
 * leave `sequentialSeed` seating too few (a new lone room, or an empty room)
 * or silently dropping the extra as if eliminated. Also self-heals an
 * already-generated stuck head-to-head field (planned 0 cuts per round,
 * pre-2026-09-27): its real per-round cut now differs from the stale plan,
 * so the next advance re-plans the tail through the fixed formula instead.
 * A no-op (returns null, leaves `state` untouched) when the pool already
 * matches the plan.
 */
function fitKingsValleyTail(
  state: TournamentState,
  nextIndex: number,
  poolSize: number,
): RoundFitFailure | null {
  const nextRound = state.rounds[nextIndex];
  const plannedSeats = nextRound.rooms.reduce((total, size) => total + size, 0);
  if (plannedSeats === poolSize) return null;

  const roomSize = state.gamemodeConfig.roomSize;
  if (!roomSize) {
    return { reason: 'missing-room-size', message: MISSING_ROOM_SIZE_MESSAGE };
  }
  // kingsValleyBracketPhase always converges to a Final at >= 2 once it
  // starts at >= 2 (the roomSizes.length <= 1 collapse only ever fires once
  // total has shrunk to at most roomSize.max, never below its own starting
  // point) -- so this is the one place a too-small pool needs to be caught,
  // matching the ordinary/double-elimination paths' own malformed-Final guards.
  if (poolSize < 2) {
    return { reason: 'malformed-final', message: malformedKingsValleyFinalMessage(poolSize) };
  }

  // Anchored to the FIRST Kings Valley round's own roundNum, not this
  // re-fit's nextRound, so a stuck field re-planned mid-ladder doesn't get a
  // fresh MAX_KINGS_VALLEY_ROUNDS budget it already partly spent. Always
  // found by construction at both call sites (advanceKingsValley and the
  // first-hop branch only run once a Kings Valley round already exists at or
  // before nextIndex); the fallback is a last-resort defensive default.
  const firstKvIndex = state.rounds.findIndex((round) => round.isKingsValley);
  const capStartRoundNum = state.rounds[firstKvIndex]?.roundNum ?? nextRound.roundNum;
  const oldFinal = state.rounds[state.rounds.length - 1];

  const builtTail = kingsValleyBracketPhase(poolSize, nextRound.roundNum, { roomSize }, capStartRoundNum);
  // The re-planned rounds play their stage's format (the Final's, a live change included, is kept in the config).
  const rounds = applyMatchFormats(
    [...state.rounds.slice(0, nextIndex), ...builtTail],
    state.gamemodeConfig,
    nextIndex,
  );
  const newTail = rounds.slice(nextIndex);
  const newFinal = newTail[newTail.length - 1];
  if (newFinal?.isFinal && oldFinal?.isFinal) {
    newTail[newTail.length - 1] = { ...newFinal, anonymousGames: oldFinal.anonymousGames };
  }

  state.rounds = [...state.rounds.slice(0, nextIndex), ...newTail];
  state.byes = [...state.byes.slice(0, nextIndex), ...newTail.map(() => [])];
  state.luckyLosers = [...state.luckyLosers.slice(0, nextIndex), ...newTail.map(() => [])];
  return null;
}

/**
 * Shape-agnostic core shared by every "finalize a round from its
 * accumulated pendingBracketSeeds pool" path: read the pool, pull out any
 * pre-chosen byes, seed real rooms via tieredBracketSeed, and record the
 * result into assignments/roomHistory. Double-elimination's own
 * seeding-override lookup and grand-final side effect aren't shape-agnostic
 * (they read `.bracket`/`winnersTo`, which only double-elimination rounds
 * have) -- those stay in finalizeDoubleEliminationRound, which calls this
 * for its own common core.
 */
export function seedRoundFromPendingPool(
  state: TournamentState,
  roundIndex: number,
  options: { chosenByes?: SeedCandidate[]; seedingOverride?: 'diversity' | 'balance' | 'random' } = {},
): RoundFitFailure | null {
  let pool = [...(state.pendingBracketSeeds[roundIndex] ?? [])];
  delete state.pendingBracketSeeds[roundIndex];
  const byeNames = (options.chosenByes ?? []).map((candidate) => candidate.name);
  if (byeNames.length) {
    const byeSet = new Set(byeNames);
    pool = pool.filter((candidate) => !byeSet.has(candidate.name));
  }
  // Waterfall reaches this only after its own headcount check, so its fixed
  // hand-authored rooms always fit and this never reshapes them.
  const failure = fitNextRound(state, roundIndex, pool.length, byeNames.length);
  if (failure) return failure;
  const assignments = tieredBracketSeed({
    pool,
    roomSizes: state.rounds[roundIndex].rooms,
    roomHistory: state.roomHistory,
    rounds: state.rounds,
    targetRoundIndex: roundIndex,
    seedingOverride: options.seedingOverride,
  }).seeded;
  state.byes[roundIndex] = byeNames;
  for (const name of byeNames) {
    assignments.push({ name, room: null, isLucky: false });
  }
  state.assignments[roundIndex] = assignments;
  state.roomHistory = recordRoomHistory(state.roomHistory, assignments, roundIndex);
  return null;
}

function finalizeDoubleEliminationRound(
  state: TournamentState,
  roundIndex: number,
  chosenByes: SeedCandidate[],
): RoundFitFailure | null {
  const targetRound = state.rounds[roundIndex];
  // Seeding-weight override only applies to a WB round's own continuation
  // into the next WB round -- always single-source, unlike an LB-bound
  // target round, whose pool can also merge players already surviving in
  // LB (attributing one WB round's override to that merged pool would be
  // misapplying it to players who never came from the overridden round).
  const seedingOverride =
    targetRound.bracket === 'winners'
      ? state.rounds.find((round) => round.bracket === 'winners' && round.winnersTo === roundIndex)
          ?.seedingOverride
      : undefined;
  const failure = seedRoundFromPendingPool(state, roundIndex, { chosenByes, seedingOverride });
  if (failure) return failure;

  // Re-read the round: seeding may have replaced it with a fitted copy.
  const seededRound = state.rounds[roundIndex];
  if (seededRound.bracket === 'grand-final') {
    const sourceIndex = state.rounds.findIndex(
      (round) => round.bracket === 'winners' && round.winnersTo === roundIndex,
    );
    if (sourceIndex !== -1) {
      const finalist = doubleEliminationComputeAdvancement(state, sourceIndex).winners[0]?.name;
      if (finalist !== undefined) seededRound.wbFinalistName = finalist;
    }
  }
  return null;
}

/**
 * The race Grand Final always seats exactly 2. The shared Final may seat fewer
 * than planned (a removal that the losers bracket couldn't absorb) but never
 * fewer than 2, and never more than its seats.
 */
function isMalformedDoubleEliminationFinal(finalRound: TournamentRound, arriving: number): boolean {
  if (finalRound.bracket === 'grand-final') return arriving !== finalRound.players;
  return arriving > finalRound.players || arriving < 2;
}

function doubleEliminationFinalMessage(finalRound: TournamentRound, actual: number): string {
  const sharedFinalSeats = actual < 2 ? 'at least 2' : `at most ${finalRound.players}`;
  const required =
    finalRound.bracket === 'grand-final' ? `the required ${finalRound.players}` : sharedFinalSeats;
  return `Can't advance into the Final — ${actual} entrants would arrive instead of ${required}. A mid-tournament withdrawal has likely thrown off the losers bracket's balance too deeply for the usual single-bye recovery to fix automatically; check Manage Teams, or add a replacement, before advancing further.`;
}

const MISSING_ROOM_SIZE_MESSAGE =
  "Can't advance — this tournament's gamemode configuration is missing a room size. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.";

function advanceDoubleElimination(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  if (round.bracket === 'grand-final') {
    return { status: 'noop', reason: 'grand-final', state: input };
  }
  const roomSize = input.gamemodeConfig.roomSize;
  if (!roomSize) {
    return {
      status: 'blocked',
      reason: 'missing-room-size',
      message: MISSING_ROOM_SIZE_MESSAGE,
      state: input,
    };
  }
  const state = cloneForTransition(input);
  const { additions, lucky } = doubleEliminationContributions(state, roundIndex);

  const nextIndex = roundIndex + 1;
  const winnersTarget = round.winnersTo;
  const losersTarget = round.losersTo;
  const pendingAt = (target: number | null | undefined) =>
    target != null ? [...(state.pendingBracketSeeds[target] ?? []), ...(additions.get(target) ?? [])] : null;
  const pendingWinners = pendingAt(winnersTarget);
  const pendingLosers = pendingAt(losersTarget);

  let poolAtNext = [...(state.pendingBracketSeeds[nextIndex] ?? [])];
  if (winnersTarget === nextIndex) poolAtNext = pendingWinners ?? [];
  if (losersTarget === nextIndex) poolAtNext = pendingLosers ?? [];
  const nextRound = state.rounds[nextIndex];
  if (nextRound.isFinal && isMalformedDoubleEliminationFinal(nextRound, poolAtNext.length)) {
    return {
      status: 'blocked',
      reason: 'malformed-final',
      message: doubleEliminationFinalMessage(nextRound, poolAtNext.length),
      state: input,
    };
  }

  let chosenByes: SeedCandidate[] = [];
  if (roomSize.min === roomSize.max) {
    const needed = poolAtNext.length % roomSize.ideal;
    // Whatever the odd-count strategy: a removal can leave an odd pool even
    // where the field started even, and a bye is the only way on. Single
    // elimination already does the equivalent through a lone-unit room.
    chosenByes = poolAtNext.slice(0, needed);
  }

  if (winnersTarget != null) {
    state.pendingBracketSeeds[winnersTarget] = pendingWinners ?? [];
  }
  if (losersTarget != null) {
    state.pendingBracketSeeds[losersTarget] = pendingLosers ?? [];
  }
  if (winnersTarget != null && lucky.has(winnersTarget)) {
    state.luckyLosers[winnersTarget] = [
      ...(state.luckyLosers[winnersTarget] ?? []),
      ...(lucky.get(winnersTarget) ?? []),
    ];
  }
  state.curRound = nextIndex;
  const fitFailure = finalizeDoubleEliminationRound(state, nextIndex, chosenByes);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

function malformedOrdinaryFinalMessage(actual: number): string {
  return `Can't advance to the Final — an odd number of teams (${actual}) would be heading into it, which can't form a clean head-to-head match. This usually means a team was removed mid-tournament; check Manage Teams before advancing.`;
}

/**
 * Kings Valley's advance step: merge each room's promote/stay/demote bands
 * into one flat best-to-worst survivor order (kingsValleyComputeAdvancement),
 * re-fit the rest of the ladder to that real count if it differs from the
 * plan (fitKingsValleyTail), then slice the order into the next round's
 * (possibly just-refitted) room sizes (sequentialSeed). Eliminated names need
 * no bookkeeping of their own -- they're simply absent from the next round's
 * assignments, which is already computeRankings()'s existing elimination
 * signal for any round that doesn't set round.bracket.
 */
function advanceKingsValley(input: TournamentState, roundIndex: number): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { nextRoomOrder } = kingsValleyComputeAdvancement(state, roundIndex);
  const nextIndex = roundIndex + 1;
  const fitFailure = fitKingsValleyTail(state, nextIndex, nextRoomOrder.length);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  const nextRound = state.rounds[nextIndex];
  state.assignments[nextIndex] = sequentialSeed(nextRoomOrder, nextRound.rooms);
  state.curRound = nextIndex;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

/** A waterfall round accepts fewer units than it declares (a withdrawal), never more. */
function malformedWaterfallRoundMessage(round: TournamentRound, actual: number): string {
  const label = round.customLabel ?? `Round ${round.roundNum}`;
  return `Can't advance into "${label}" — ${actual} entrant(s) would arrive, more than the ${declaredWaterfallSeats(round)} the graph declares for it. The graph's rank-band counts don't add up for this round; check the routing with "Edit graph" in the Admin tab before advancing further.`;
}

/** Draws the waterfall round at `roundIndex` for `arriving` units, or says why it can't. */
function fitWaterfallRoundAt(
  state: TournamentState,
  roundIndex: number,
  arriving: number,
): RoundFitFailure | null {
  const round = state.rounds[roundIndex];
  if (arriving > declaredWaterfallSeats(round)) {
    return { reason: 'malformed-waterfall-round', message: malformedWaterfallRoundMessage(round, arriving) };
  }
  const fitted = fitWaterfallRound(round, arriving);
  if ('error' in fitted) return { reason: 'too-few-units', message: fitted.error };
  state.rounds[roundIndex] = fitted;
  return null;
}

function standingsShortfallMessage(ranked: number, highestRoutedRank: number): string {
  return `Can't advance -- the qualification table ranks ${ranked} unit(s), but the custom bracket graph routes qualification ranks up to ${highestRoutedRank}. A withdrawal during qualification has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
}

/**
 * Folds the finished round's (or column's) per-destination additions into pendingBracketSeeds
 * (the destination-indexed accumulator advanceDoubleElimination already uses,
 * generalized from 2 named destinations to N), then draws the next column: every
 * round after `lastRoundIndex` that shares the first one's column (a round with no
 * stored column is a column of its own). Always finalizes that column specifically
 * -- NOT whatever a band's own destination is, which may be several columns ahead
 * and stay merely pending until curRound actually reaches it. This is safe because
 * the graph is a validated DAG played in column order: every source of a round in
 * column N is in an earlier column, so its pool is always complete by the time its
 * column is entered here. If any round of the column can't be drawn, the input state
 * is returned unchanged.
 */
function enterNextWaterfallColumn(
  input: TournamentState,
  state: TournamentState,
  lastRoundIndex: number,
  additionsByDestination: Map<number, PendingBracketSeed[]>,
): RoundAdvanceResult {
  for (const [destination, additions] of additionsByDestination) {
    state.pendingBracketSeeds[destination] = [
      ...(state.pendingBracketSeeds[destination] ?? []),
      ...additions,
    ];
  }

  const { start, end } = roundColumn(state.rounds, lastRoundIndex + 1);
  for (let index = start; index <= end; index += 1) {
    const shapeFailure = fitWaterfallRoundAt(state, index, (state.pendingBracketSeeds[index] ?? []).length);
    if (shapeFailure) return { status: 'blocked', ...shapeFailure, state: input };
  }

  state.curRound = start;
  for (let index = start; index <= end; index += 1) {
    const fitFailure = seedRoundFromPendingPool(state, index);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  }
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}

/** Every destination's arrivals from several rounds, the rounds' own order kept within a destination. */
function mergeAdditions(parts: Array<Map<number, PendingBracketSeed[]>>): Map<number, PendingBracketSeed[]> {
  const merged = new Map<number, PendingBracketSeed[]>();
  for (const part of parts) {
    for (const [destination, additions] of part) {
      merged.set(destination, [...(merged.get(destination) ?? []), ...additions]);
    }
  }
  return merged;
}

/**
 * Waterfall's advance step: route every finished round of the current column
 * (routeWaterfallRound), then enter the next column.
 */
function advanceWaterfallBracket(input: TournamentState): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { start, end } = currentColumn(input);
  const parts: Array<Map<number, PendingBracketSeed[]>> = [];
  for (let index = start; index <= end; index += 1) {
    parts.push(routeWaterfallRound(state, index, state.rounds[index]));
  }
  return enterNextWaterfallColumn(input, state, end, mergeAdditions(parts));
}

/**
 * The pooling exit of a waterfall graph with a Qual source: the ordered
 * qualification table is routed through the last qualification round's
 * `standingsRoutes`. It does not go through roomBasedComputeAdvancement's
 * `advancing` list (that is the top `qualAdv` names, which includes ranks the
 * graph eliminates inside its range) and has no bye or tieredSeed step: the
 * waterfall has no byes, and every destination is drawn from its pool.
 */
function advanceFromStandings(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const { qualTable, ordered } = orderedQualificationTable(state);
  state.qualTable = qualTable;
  const highestRoutedRank = round.standingsRoutes?.length ?? 0;
  if (ordered.length < highestRoutedRank) {
    return {
      status: 'blocked',
      reason: 'too-few-units',
      message: standingsShortfallMessage(ordered.length, highestRoutedRank),
      state: input,
    };
  }
  state.rounds[roundIndex] = {
    ...round,
    standingsExitOrder: ordered.map((standing) => ({
      name: standing.name,
      roomShare: standing.roomShare ?? 0,
    })),
  };
  return enterNextWaterfallColumn(input, state, roundIndex, routeStandings(ordered, round));
}

/**
 * Pure counterpart of legacy advanceRound(). UI effects (alert, render,
 * persistence and sync) are represented by the returned result/state.
 */
export function advanceTournamentRound(input: TournamentState): RoundAdvanceResult {
  const roundIndex = input.curRound;
  const round = input.rounds[roundIndex];
  const nextRound = input.rounds[nextColumnStart(input)];
  if (!round || !nextRound) {
    return { status: 'noop', reason: 'last-round', state: input };
  }

  const column = currentColumn(input);
  let prepared = input;
  for (let index = column.start; index <= column.end; index += 1) {
    prepared = refreshRoundStandings(prepared, index);
  }
  if (hasPendingColumnTies(prepared)) {
    return {
      status: 'blocked',
      reason: 'pending-ties',
      message: PENDING_TIES_MESSAGE,
      state: prepared,
    };
  }
  if (hasBlockingAbsenceQuestions(prepared)) {
    return {
      status: 'blocked',
      reason: 'pending-absences',
      message: PENDING_ABSENCES_MESSAGE,
      state: prepared,
    };
  }
  const drawnAhead = drawnAheadStatus(prepared, roundIndex);
  if (drawnAhead === 'locked') {
    const state = { ...prepared, curRound: nextColumnStart(prepared) };
    return { status: 'advanced', state: { ...state, reserveOpen: reserveWindowAtCurrentRound(state) } };
  }
  const base = drawnAhead === 'redraw' ? discardDrawsAfter(prepared, roundIndex) : prepared;
  if (round.bracket) {
    return advanceDoubleElimination(base, roundIndex, round);
  }
  if (round.isKingsValley) {
    return advanceKingsValley(base, roundIndex);
  }
  if (round.isWaterfall) {
    return advanceWaterfallBracket(base);
  }
  if (round.standingsRoutes) {
    return advanceFromStandings(base, roundIndex, round);
  }

  const state = cloneForTransition(base);
  const result = roomBasedComputeAdvancement(state, roundIndex);
  if (result.qualTable) state.qualTable = result.qualTable;
  if (result.groupStandings) state.groupStandings = result.groupStandings;

  let advancing: SeedCandidate[] = result.advancing.map((entry) => ({
    ...entry,
  }));
  // At a standings cut-off the cumulative standings decide who advances, and a
  // bye unit is already ranked in them: prepending it would let it qualify
  // whatever its standing.
  if (state.byes[roundIndex]?.length && !isStandingsCutoffRound(state, roundIndex)) {
    advancing = [
      ...state.byes[roundIndex].map((name) => ({
        name,
        isLucky: false,
      })),
      ...advancing,
    ];
  }
  if (round.isNoElim && !round.isGroupStage && !isStandingsCutoffRound(state, roundIndex)) {
    advancing = withLateJoiners(advancing, lateJoinersOf(state, roundIndex));
  }
  advancing = uniqueKeepingLast(advancing);

  let seeded: RoundAssignment[];
  if (nextRound.fixedRoomAssignments) {
    // The whole schedule for this round was already decided at generation
    // time (fixed-draws.ts) -- roomHistory/poolingByeCounts for it were
    // already folded in there too (see generation.ts), so no
    // recordRoomHistory call here, unlike every branch below.
    seeded = nextRound.fixedRoomAssignments.map((entry) => ({ ...entry }));
    state.byes[roundIndex + 1] = seeded.filter((entry) => entry.room === null).map((entry) => entry.name);
  } else if (nextRound.isGroupStage) {
    seeded = seedFromGroupStageRound(nextRound);
    state.byes[roundIndex + 1] = [...(nextRound.groupByes ?? [])];
  } else if (nextRound.isSwiss) {
    const roomSize = state.gamemodeConfig.roomSize;
    if (!roomSize) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const paired = swissFoldPair({
      activeNames: advancing.map((entry) => entry.name),
      throughRoundIndex: roundIndex,
      roomSize,
      state,
    });
    seeded = paired.seeded;
    state.poolingByeCounts = paired.poolingByeCounts;
    state.byes[roundIndex + 1] = paired.byeName ? [paired.byeName] : [];
  } else if (nextRound.isKingsValley) {
    // Kings Valley's own room sizes are already fixed exactly at generation
    // time (distributeRooms() over the shrinking survivor count -- no bye
    // concept at all) -- seed into them precisely rather than via
    // snakeSeed's count-only boustrophedon walk, which can leave a room's
    // actual occupancy off by one from the structural size its own
    // promote/demote/eliminate band counts were computed against. (Every
    // later Kings-Valley-to-Kings-Valley transition already goes through
    // advanceKingsValley()'s sequentialSeed() call above and doesn't have
    // this gap -- this is only reached for the one hop into the very first
    // Kings Valley round, from whatever pooling/no-elim round precedes it.)
    // A removal during a preceding pooling phase (or a reserve added while
    // this round's window is still open) can leave a real survivor count
    // that differs from what this round was planned for. mutations.ts's own
    // rebuildFutureRounds does fire on a qual-table/Swiss removal (those
    // rounds are isNoElim too) and does re-plan this round's shape -- but it
    // re-plans using the still-stale state.cfg.qualAdv, not the real number
    // of survivors reaching the cutoff, so the two can still disagree.
    // fitKingsValleyTail re-plans the whole ladder (Final included) to the
    // real count first, same as advanceKingsValley does for every later
    // KV-to-KV hop.
    const fitFailure = fitKingsValleyTail(state, roundIndex + 1, advancing.length);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
    const fittedNextRound = state.rounds[roundIndex + 1];
    seeded = sequentialSeed(
      advancing.map((entry) => entry.name),
      fittedNextRound.rooms,
    );
    if (round.isGroupStage) {
      seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups);
    }
  } else {
    const roomSize = state.gamemodeConfig.roomSize;
    if (!roomSize) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const newByes: SeedCandidate[] = [];
    const joiners = new Set(lateJoinersOf(state, roundIndex));
    if (state.gamemodeConfig.oddCountStrategy === 'bye' && !nextRound.isWaterfall) {
      let needed = 0;
      if (nextRound.bracketPhaseFirstRound) {
        needed = nextPowerOf2AndRounds(advancing.length).bracketSize - advancing.length;
      } else if (advancing.length % roomSize.ideal !== 0) {
        needed = 1;
      }
      if (needed > 0) {
        if (nextRound.isFinal) {
          return {
            status: 'blocked',
            reason: 'malformed-final',
            message: malformedOrdinaryFinalMessage(advancing.length),
            state,
          };
        }
        if (nextRound.isNoElim && needed === 1) {
          const chosen = selectPoolingBye(byeCandidates(advancing, joiners), state.poolingByeCounts);
          if (chosen) {
            newByes.push(chosen);
            advancing = advancing.filter((entry) => entry !== chosen);
            state.poolingByeCounts[chosen.name] = (state.poolingByeCounts[chosen.name] ?? 0) + 1;
          }
        } else {
          const taken = byeCandidates(advancing, joiners).slice(0, needed);
          newByes.push(...taken);
          advancing = advancing.filter((entry) => !taken.includes(entry));
        }
      }
    }
    // A hand-authored waterfall graph keeps its room count and routes: fewer arrivals than it
    // declares are drawn short (fitWaterfallRoundAt, not distributeRooms), more block.
    const fitFailure = nextRound.isWaterfall
      ? fitWaterfallRoundAt(state, roundIndex + 1, advancing.length)
      : fitNextRound(state, roundIndex + 1, advancing.length, newByes.length);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
    seeded = tieredSeed({ state, roundIndex, advancing, seedingOverride: round.seedingOverride }).seeded;
    if (round.isGroupStage) {
      seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups);
    }
    state.roomHistory = recordRoomHistory(state.roomHistory, seeded, roundIndex + 1);
    if (newByes.length) {
      state.byes[roundIndex + 1] = newByes.map((entry) => entry.name);
      seeded.push(
        ...newByes.map((entry) => ({
          name: entry.name,
          room: null,
          isLucky: false,
        })),
      );
    }
  }

  // Set after every branch above, including the Kings Valley one -- its own
  // fitKingsValleyTail can rebuild state.luckyLosers wholesale when it
  // re-fits the tail, which would otherwise clobber an earlier write here.
  if (result.luckyNames !== null) {
    state.luckyLosers[roundIndex + 1] = result.luckyNames;
  }
  state.curRound += 1;
  state.assignments[state.curRound] = seeded;
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  return { status: 'advanced', state };
}
