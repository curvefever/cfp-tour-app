import { drawCustomBracketPool, drawFromPoolingExit } from './custom-bracket-draw';
import { isFedOnlyByStandings } from './bracket-replay';
import { generatedConfig } from './generated-config';
import { likelyAbsentees } from './likely-absentees';
import { isRoundDone } from './round-columns';
import { fitRoundToPool } from './room-distribution';
import { plainRoundName } from './round-name';
import { type SeedCandidate } from './seeding';
import { recordRoomHistory } from './room-history';
import type { PendingBracketSeed, TournamentRound, TournamentState } from './types';
import { declaredWaterfallSeats, fitWaterfallRound } from './waterfall-bracket';
import { winsNeededByName, withWinsNeeded } from './win-stamps';

/**
 * What more than one way of advancing a round uses: the result of a press and its reasons, the copy an advance
 * writes to, the reserve window, the fit of a round to the units that reach it, and the draw of a round from its
 * pool of waiting units. The ordinary advance and the switchboard are in `transitions.ts`, the other formats in the
 * `*-advance.ts` files and `waterfall-steps.ts`.
 */

export const PENDING_TIES_MESSAGE = 'Resolve all tie-breaks before advancing.';

type RoundAdvanceBlockReason =
  | 'pending-ties'
  | 'pending-absences'
  | 'malformed-final'
  | 'missing-room-size'
  | 'malformed-waterfall-round'
  | 'too-few-units';

type RoundAdvanceNoopReason = 'last-round' | 'grand-final';

export type RoundAdvanceResult =
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

// A part of the state that an advance writes to must be listed here: an advance
// works on this copy, and a part left out would be changed on the state it was given.
export function cloneForTransition(state: TournamentState): TournamentState {
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

/** Whether reserves can still join: the round that makes the first cut (the last pooling round, or the first elimination round with no pooling) is not done yet. */
export function reserveWindowAtCurrentRound(
  state: Pick<TournamentState, 'cfg' | 'rounds' | 'curRound'>,
): boolean {
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

export interface RoundFitFailure {
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
export function fitNextRound(
  state: TournamentState,
  roundIndex: number,
  poolSize: number,
  byeCount: number,
): RoundFitFailure | null {
  const round = state.rounds[roundIndex];
  const config = generatedConfig(state);
  const withByes = round.byeCount === byeCount ? round : { ...round, byeCount };
  const seats = withByes.rooms.reduce((total, size) => total + size, 0);
  if (seats !== poolSize && !config) {
    return { reason: 'missing-room-size', message: MISSING_ROOM_SIZE_MESSAGE };
  }
  const fitted = config ? fitRoundToPool(withByes, poolSize, config.roomSize) : withByes;
  if ('error' in fitted) return { reason: 'too-few-units', message: fitted.error };
  state.rounds[roundIndex] = fitted;
  return null;
}

export const MISSING_ROOM_SIZE_MESSAGE =
  "Can't advance — this tournament's gamemode configuration is missing a room size. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.";

/** The seed of every unit of a pool, or null unless every entry carries one (a pool pushed before seeds were stored has none). */
function poolSeeds(pool: PendingBracketSeed[]): Map<string, number> | null {
  if (pool.length === 0 || pool.some((entry) => entry.seed === undefined)) return null;
  return new Map(pool.map((entry) => [entry.name, entry.seed as number]));
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
  const seedOf = poolSeeds(pool);
  const byeNames = (options.chosenByes ?? []).map((candidate) => candidate.name);
  if (byeNames.length) {
    const byeSet = new Set(byeNames);
    pool = pool.filter((candidate) => !byeSet.has(candidate.name));
  }
  // Waterfall reaches this only after its own headcount check, so its fixed
  // hand-authored rooms always fit and this never reshapes them.
  const failure = fitNextRound(state, roundIndex, pool.length, byeNames.length);
  if (failure) return failure;
  const likelyAbsent = likelyAbsentees(state, roundIndex);
  const assignments = drawCustomBracketPool({
    pool,
    roomSizes: state.rounds[roundIndex].rooms,
    roomHistory: state.roomHistory,
    rounds: state.rounds,
    targetRoundIndex: roundIndex,
    seedingOverride: options.seedingOverride,
    likelyAbsent,
    exitDraw: isFedOnlyByStandings(state.rounds, roundIndex)
      ? () => drawFromPoolingExit({ state, roundIndex, pool, likelyAbsent })
      : undefined,
  });
  state.byes[roundIndex] = byeNames;
  for (const name of byeNames) {
    assignments.push({ name, room: null, isLucky: false });
  }
  const winsOf = winsNeededByName(state.rounds[roundIndex], pool);
  state.assignments[roundIndex] = assignments.map((entry) =>
    withWinsNeeded(seedOf ? { ...entry, seed: seedOf.get(entry.name) } : entry, winsOf),
  );
  state.roomHistory = recordRoomHistory(state.roomHistory, assignments, roundIndex);
  return null;
}

/** A waterfall round accepts fewer units than it declares (a withdrawal), never more. */
function malformedWaterfallRoundMessage(round: TournamentRound, actual: number): string {
  const label = plainRoundName(round);
  return `Can't advance into "${label}" — ${actual} entrant(s) would arrive, more than the ${declaredWaterfallSeats(round)} the graph declares for it. The graph's rank-band counts don't add up for this round; check the routing with "Edit graph" in the Admin tab before advancing further.`;
}

/** Draws the waterfall round at `roundIndex` for `arriving` units, or says why it can't. */
export function fitWaterfallRoundAt(
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

/** Every destination's arrivals from several rounds, the rounds' own order kept within a destination. */
export function mergeAdditions(
  parts: Array<Map<number, PendingBracketSeed[]>>,
): Map<number, PendingBracketSeed[]> {
  const merged = new Map<number, PendingBracketSeed[]>();
  for (const part of parts) {
    for (const [destination, additions] of part) {
      merged.set(destination, [...(merged.get(destination) ?? []), ...additions]);
    }
  }
  return merged;
}
