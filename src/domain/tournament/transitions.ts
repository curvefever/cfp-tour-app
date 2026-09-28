import {
  buildAdvancementTiers,
  doubleEliminationComputeAdvancement,
  hasPendingTies,
  isStandingsCutoffRound,
  kingsValleyComputeAdvancement,
  refreshRoundStandings,
  roomBasedComputeAdvancement,
} from './advancement';
import { nextPowerOf2AndRounds } from './double-elimination';
import { kingsValleyBracketPhase } from './kings-valley';
import { seedFromGroupStageRound } from './pooling';
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
import { waterfallDestination } from './waterfall-bracket';

const PENDING_TIES_MESSAGE = 'Resolve all tie-breaks before advancing.';

type RoundAdvanceBlockReason =
  'pending-ties' | 'malformed-final' | 'missing-room-size' | 'malformed-waterfall-round' | 'too-few-units';

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
  return cutRound !== -1 && state.curRound <= cutRound;
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
  const finalsGames = state.gamemodeConfig.finalsGames;
  if (!roomSize || finalsGames === undefined) {
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

  const newTail = kingsValleyBracketPhase(
    poolSize,
    nextRound.roundNum,
    { roomSize, finalsGames },
    capStartRoundNum,
  );
  const newFinal = newTail[newTail.length - 1];
  if (newFinal?.isFinal && oldFinal?.isFinal) {
    newTail[newTail.length - 1] = {
      ...newFinal,
      numGames: oldFinal.numGames,
      anonymousGames: oldFinal.anonymousGames,
    };
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
  const result = doubleEliminationComputeAdvancement(state, roundIndex);
  if (state.byes[roundIndex]?.length) {
    result.winners = [...state.byes[roundIndex].map((name) => ({ name })), ...result.winners];
  }

  // Tag every contribution with its room-rank tier + in-tier pct at the
  // moment it's pushed -- buildAdvancementTiers already ranks EVERY occupant
  // of a room (not just advancers), so a "loser" lands at their own actual
  // room-rank position and a carried-over bye folds to rank 0/pct 1, exactly
  // like the generic reseeding path. Captured here, not at finalize time,
  // because a target round's pool can accumulate from more than one source
  // round (see transitions.ts's own pendingBracketSeeds accumulation below) --
  // by finalize time there is no single round left to re-derive this from.
  const tierByName = new Map(
    buildAdvancementTiers(state, roundIndex, [
      ...result.winners.map(({ name }) => name),
      ...result.losers.map(({ name }) => name),
    ]).flatMap((tier) =>
      tier.members.map((member) => [member.name, { tierRank: tier.rank, pct: member.pct }] as const),
    ),
  );
  const tagFor = (name: string) => tierByName.get(name) ?? { tierRank: 0, pct: 1 };

  const nextIndex = roundIndex + 1;
  const winnersTarget = round.winnersTo;
  const losersTarget = round.losersTo;
  const pendingWinners =
    winnersTarget != null
      ? [
          ...(state.pendingBracketSeeds[winnersTarget] ?? []),
          ...result.winners.map(({ name }) => ({
            name,
            isLucky: false,
            ...tagFor(name),
          })),
        ]
      : null;
  const pendingLosers =
    losersTarget != null
      ? [
          ...(state.pendingBracketSeeds[losersTarget] ?? []),
          ...result.losers.map(({ name }) => ({
            name,
            isLucky: false,
            ...tagFor(name),
          })),
        ]
      : null;

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
  if (winnersTarget != null && result.luckyNames.length) {
    state.luckyLosers[winnersTarget] = [...(state.luckyLosers[winnersTarget] ?? []), ...result.luckyNames];
  }
  state.curRound = nextIndex;
  const fitFailure = finalizeDoubleEliminationRound(state, nextIndex, chosenByes);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  state.needsSave = true;
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
  state.needsSave = true;
  return { status: 'advanced', state };
}

function malformedWaterfallRoundMessage(round: TournamentRound, actual: number): string {
  const label = round.customLabel ?? `Round ${round.roundNum}`;
  return `Can't advance into "${label}" — ${actual} entrant(s) would arrive instead of the ${round.players} the graph declares for it. A mid-tournament withdrawal has likely thrown off the waterfall graph's exact rank-band counts (no bye/lucky-loser concept applies here); check Manage Teams, or add a replacement, before advancing further.`;
}

/**
 * Ranks every occupant of a waterfall round within their own room
 * (buildAdvancementTiers, called once over the WHOLE room, not a pre-split
 * winners/losers list) and looks up each occupant's own band via
 * `round.waterfallRoutes[room-1][rank]` (tier.rank is already 0-indexed, the
 * same convention waterfallRoutes itself uses for "rank - 1"). Returns the
 * additions grouped by destination round index -- NOT yet folded into
 * `state.pendingBracketSeeds`, so a replay (waterfall-live-edit.ts) can
 * inspect a round's outcome against a hypothetical routing without mutating
 * any pool. `round` is passed separately from `state.rounds[roundIndex]` so
 * a caller can rank against the live scores while routing through an edited
 * (not-yet-committed) round object.
 */
export function routeWaterfallRound(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): Map<number, PendingBracketSeed[]> {
  const names = (state.assignments[roundIndex] ?? []).map((entry) => entry.name);
  const tiers = buildAdvancementTiers(state, roundIndex, names);

  const additionsByDestination = new Map<number, PendingBracketSeed[]>();
  for (const tier of tiers) {
    for (const member of tier.members) {
      const destination = waterfallDestination(round, member.sourceRoom, tier.rank);
      if (destination === null) continue;
      const additions = additionsByDestination.get(destination) ?? [];
      additions.push({ name: member.name, isLucky: false, tierRank: tier.rank, pct: member.pct });
      additionsByDestination.set(destination, additions);
    }
  }
  return additionsByDestination;
}

/**
 * Waterfall's advance step: push routeWaterfallRound's per-destination
 * additions into pendingBracketSeeds[destination] -- the same
 * destination-indexed accumulator advanceDoubleElimination already uses,
 * generalized from 2 named destinations to N. Always finalizes roundIndex +
 * 1 specifically (mirroring advanceDoubleElimination's own nextIndex
 * finalize) -- NOT whatever a band's own destination is, which may be
 * several rounds ahead and stay merely pending until curRound actually
 * reaches it. This is safe because the graph is a validated DAG played in
 * its own topological order: every source of round X is guaranteed already
 * played by the time curRound reaches X - 1, so X's pool is always complete
 * by the time it's X's own turn to be finalized here.
 */
function advanceWaterfallBracket(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const additionsByDestination = routeWaterfallRound(state, roundIndex, round);
  for (const [destination, additions] of additionsByDestination) {
    state.pendingBracketSeeds[destination] = [
      ...(state.pendingBracketSeeds[destination] ?? []),
      ...additions,
    ];
  }

  const nextIndex = roundIndex + 1;
  const nextRound = state.rounds[nextIndex];
  const poolAtNext = state.pendingBracketSeeds[nextIndex] ?? [];
  if (poolAtNext.length !== nextRound.players) {
    return {
      status: 'blocked',
      reason: 'malformed-waterfall-round',
      message: malformedWaterfallRoundMessage(nextRound, poolAtNext.length),
      state: input,
    };
  }

  state.curRound = nextIndex;
  const fitFailure = seedRoundFromPendingPool(state, nextIndex);
  if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
  state.reserveOpen = reserveWindowAtCurrentRound(state);
  state.needsSave = true;
  return { status: 'advanced', state };
}

/**
 * Pure counterpart of legacy advanceRound(). UI effects (alert, render,
 * persistence and sync) are represented by the returned result/state.
 */
export function advanceTournamentRound(input: TournamentState): RoundAdvanceResult {
  const roundIndex = input.curRound;
  const round = input.rounds[roundIndex];
  const nextRound = input.rounds[roundIndex + 1];
  if (!round || !nextRound) {
    return { status: 'noop', reason: 'last-round', state: input };
  }

  const prepared = refreshRoundStandings(input, roundIndex);
  if (hasPendingTies(prepared, roundIndex)) {
    return {
      status: 'blocked',
      reason: 'pending-ties',
      message: PENDING_TIES_MESSAGE,
      state: prepared,
    };
  }
  if (round.bracket) {
    return advanceDoubleElimination(prepared, roundIndex, round);
  }
  if (round.isKingsValley) {
    return advanceKingsValley(prepared, roundIndex);
  }
  if (round.isWaterfall) {
    return advanceWaterfallBracket(prepared, roundIndex, round);
  }

  const state = cloneForTransition(prepared);
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
    if (state.gamemodeConfig.oddCountStrategy === 'bye') {
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
          const chosen = selectPoolingBye(advancing, state.poolingByeCounts);
          if (chosen) {
            newByes.push(chosen);
            advancing = advancing.filter((entry) => entry !== chosen);
            state.poolingByeCounts[chosen.name] = (state.poolingByeCounts[chosen.name] ?? 0) + 1;
          }
        } else {
          newByes.push(...advancing.slice(0, needed));
          advancing = advancing.slice(needed);
        }
      }
    }
    if (nextRound.isWaterfall && advancing.length !== nextRound.players) {
      // The hand-authored waterfall graph needs its exact headcount, so it
      // blocks (like waterfall-to-waterfall) instead of being reshaped.
      return {
        status: 'blocked',
        reason: 'malformed-waterfall-round',
        message: malformedWaterfallRoundMessage(nextRound, advancing.length),
        state: input,
      };
    }
    const fitFailure = fitNextRound(state, roundIndex + 1, advancing.length, newByes.length);
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
  state.needsSave = true;
  return { status: 'advanced', state };
}
