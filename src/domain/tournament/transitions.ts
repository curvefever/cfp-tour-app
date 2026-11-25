import { hasBlockingAbsenceQuestions, PENDING_ABSENCES_MESSAGE } from './absences';
import { withFinalistAliasesForLineup } from './anonymous-finalists';
import {
  computeGroupStandings,
  hasPendingColumnTies,
  isStandingsCutoffRound,
  orderedGroupExit,
  orderedQualificationTable,
  refreshRoundStandings,
  roomBasedComputeAdvancement,
} from './advancement';
import { advanceKingsValley, fitKingsValleyTail } from './kings-valley-advance';
import { advanceDoubleElimination } from './double-elimination-advance';
import { routeStandings, routeWaterfallRound } from './bracket-replay';
import { nextPowerOf2AndRounds } from './double-elimination';
import { lateJoinersOf } from './late-joiners';
import { likelyAbsentees } from './likely-absentees';
import { seedFromGroupStageRound } from './pooling';
import { discardDrawsAfter, drawnAheadStatus } from './redraw';
import { swissPair } from './swiss-pairing';
import {
  avoidSameGroupInFirstBracketRound,
  pairsAbsenteesInRound,
  recordRoomHistory,
  selectPoolingBye,
  sequentialSeed,
  seedFromPoolingExit,
  tieredSeed,
  type SeedCandidate,
} from './seeding';
import type {
  PendingBracketSeed,
  RoundAssignment,
  TournamentRound,
  TournamentStanding,
  TournamentState,
} from './types';
import { generatedConfig } from './generated-config';
import { currentColumn, nextColumnStart, roundColumn, usesDependencyPlay } from './round-columns';
import {
  cloneForTransition,
  fitNextRound,
  fitWaterfallRoundAt,
  mergeAdditions,
  MISSING_ROOM_SIZE_MESSAGE,
  PENDING_TIES_MESSAGE,
  reserveWindowAtCurrentRound,
  seedRoundFromPendingPool,
  type RoundAdvanceResult,
} from './round-advance-tools';
import { advanceDependencyPlay, withPressesResumed } from './waterfall-steps';

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

/** Candidates for a bye: never a late joiner in their first round (a bye earns points), unless nobody else is left. */
function byeCandidates(advancing: SeedCandidate[], joiners: ReadonlySet<string>): SeedCandidate[] {
  const regular = advancing.filter((entry) => !joiners.has(entry.name));
  return regular.length ? regular : advancing;
}

/**
 * The bye of a head-to-head pooling round (a qualification table, the warm-ups) when the likely absentees pair
 * together (`pairsAbsenteesInRound`) and an odd number of them is left: the lowest ranked takes it, worth no points
 * while it is likely absent (`absentBye`). Undefined otherwise: the bye is picked as usual.
 */
function absenteeBye(
  state: TournamentState,
  round: TournamentRound,
  roundIndex: number,
  advancing: SeedCandidate[],
  idealRoomSize: number,
): SeedCandidate | undefined {
  if (idealRoomSize !== 2 || !pairsAbsenteesInRound(state, round, roundIndex)) return undefined;
  const likely = likelyAbsentees(state, roundIndex);
  const absentees = advancing.filter((entry) => likely.has(entry.name));
  return absentees.length % 2 === 1 ? absentees[absentees.length - 1] : undefined;
}

function malformedOrdinaryFinalMessage(actual: number): string {
  return `Can't advance to the Final — an odd number of teams (${actual}) would be heading into it, which can't form a clean head-to-head match. This usually means a team was removed mid-tournament; check Manage Teams before advancing.`;
}

function standingsPhaseOf(round: TournamentRound): 'groups' | 'swiss' | 'qualification' {
  if (round.isGroupStage) return 'groups';
  return round.isSwiss ? 'swiss' : 'qualification';
}

function standingsShortfallMessage(
  ranked: number,
  highestRoutedRank: number,
  phase: 'groups' | 'swiss' | 'qualification',
): string {
  if (phase === 'groups') {
    return `Can't advance -- the group stage sends ${ranked} unit(s) on, but the custom bracket graph routes group exit ranks up to ${highestRoutedRank}. A withdrawal during the groups has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
  }
  if (phase === 'swiss') {
    return `Can't advance -- the Swiss standings rank ${ranked} unit(s), but the custom bracket graph routes Swiss ranks up to ${highestRoutedRank}. A withdrawal during the Swiss has likely caused this; use "Edit graph" in the Admin tab to route fewer ranks.`;
  }
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
 * A copy of the state with one undrawn Custom bracket round drawn, from the units already waiting for it plus
 * what `feeders` (finished rounds of the column in play) send it; null when that round can't be drawn. For a
 * look ahead only: the input isn't changed and `curRound` stays where it is.
 */
export function drawWaterfallRoundAhead(
  input: TournamentState,
  roundIndex: number,
  feeders: number[],
): TournamentState | null {
  const state = cloneForTransition(input);
  const additions = mergeAdditions(
    feeders.map((index) => routeWaterfallRound(state, index, state.rounds[index])),
  );
  const arriving = [...(state.pendingBracketSeeds[roundIndex] ?? []), ...(additions.get(roundIndex) ?? [])];
  state.pendingBracketSeeds[roundIndex] = arriving;
  if (fitWaterfallRoundAt(state, roundIndex, arriving.length)) return null;
  return seedRoundFromPendingPool(state, roundIndex) ? null : state;
}

/**
 * The units a pooling exit sends through the standings routing, best first: the group exit order (a group stage,
 * its band-tie picks applied) or the qualification table (every cut-off tie pick applied). Sets the table the exit
 * was read from on `state`.
 */
function standingsExitOf(state: TournamentState, round: TournamentRound): TournamentStanding[] {
  if (round.isGroupStage) {
    state.groupStandings = computeGroupStandings(state);
    return orderedGroupExit(state, state.groupStandings);
  }
  const { qualTable, ordered } = orderedQualificationTable(state);
  state.qualTable = qualTable;
  return ordered;
}

/**
 * The pooling exit of a waterfall graph with a Qual or Groups source: the
 * ordered qualification table (or group exit order) is routed through the last
 * pooling round's `standingsRoutes`. It does not go through
 * roomBasedComputeAdvancement's `advancing` list (that is the top `qualAdv`
 * names, which includes ranks the graph eliminates inside its range) and has
 * no bye or tieredSeed step: the waterfall has no byes, and every destination
 * is drawn from its pool.
 */
function advanceFromStandings(
  input: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): RoundAdvanceResult {
  const state = cloneForTransition(input);
  const ordered = standingsExitOf(state, round);
  const highestRoutedRank = round.standingsRoutes?.length ?? 0;
  if (ordered.length < highestRoutedRank) {
    return {
      status: 'blocked',
      reason: 'too-few-units',
      message: standingsShortfallMessage(ordered.length, highestRoutedRank, standingsPhaseOf(round)),
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
  return enterNextWaterfallColumn(input, state, roundIndex, routeStandings(ordered, round, roundIndex));
}

/**
 * Advances the tournament to its next round: the result carries the new state,
 * or why nothing happened. UI effects (alert, render, persistence and sync)
 * belong to the caller.
 */
export function advanceTournamentRound(input: TournamentState): RoundAdvanceResult {
  const result = advanceRound(input);
  return result.status === 'advanced'
    ? { ...result, state: withFinalistAliasesForLineup(result.state) }
    : result;
}

function advanceRound(input: TournamentState): RoundAdvanceResult {
  if (usesDependencyPlay(input)) return advanceDependencyPlay(input);
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
    const state = withPressesResumed({ ...prepared, curRound: nextColumnStart(prepared) });
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
    const config = generatedConfig(state);
    if (!config) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const { roomSize } = config;
    const paired = swissPair({
      activeNames: advancing.map((entry) => entry.name),
      throughRoundIndex: roundIndex,
      roomSize,
      state,
      likelyAbsent: pairsAbsenteesInRound(state, nextRound, roundIndex + 1)
        ? likelyAbsentees(state, roundIndex + 1)
        : undefined,
    });
    seeded = paired.seeded;
    state.poolingByeCounts = paired.poolingByeCounts;
    state.byes[roundIndex + 1] = paired.byeName ? [paired.byeName] : [];
  } else if (nextRound.isKingsValley) {
    // Kings Valley's room sizes are fixed at generation time (distributeRooms()
    // over the shrinking survivor count, no byes), so the units are seated into
    // them exactly with sequentialSeed, as advanceKingsValley does for every
    // later hop; this is the hop into the first Kings Valley round. A removal
    // during pooling (or a reserve added while this round's window is open) can
    // leave a survivor count that differs from the plan, and mutations.ts's
    // rebuildFutureRounds re-plans with state.cfg.qualAdv, not the real number
    // reaching the cutoff. So fitKingsValleyTail re-plans the whole ladder
    // (Final included) to the real count first.
    // The reshape at a roster change (rebuildFutureRounds) is a preview, so the Bracket shows the room sizes ahead:
    // it may fail or be skipped, and a removal is never blocked by it. Next Round fits each round to the units that
    // really arrive, and that is the rule.
    const fitFailure = fitKingsValleyTail(state, roundIndex + 1, advancing.length);
    if (fitFailure) return { status: 'blocked', ...fitFailure, state: input };
    const fittedNextRound = state.rounds[roundIndex + 1];
    seeded = sequentialSeed(
      advancing.map((entry) => entry.name),
      fittedNextRound.rooms,
    );
    if (round.isGroupStage) {
      seeded = avoidSameGroupInFirstBracketRound(seeded, state.groups, result.groupExit);
    }
  } else {
    const config = generatedConfig(state);
    if (!config) {
      return {
        status: 'blocked',
        reason: 'missing-room-size',
        message: MISSING_ROOM_SIZE_MESSAGE,
        state,
      };
    }
    const { roomSize } = config;
    const newByes: SeedCandidate[] = [];
    const absentByeNames = new Set<string>();
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
          const absentBye = absenteeBye(state, nextRound, roundIndex + 1, advancing, roomSize.ideal);
          const chosen =
            absentBye ?? selectPoolingBye(byeCandidates(advancing, joiners), state.poolingByeCounts);
          if (absentBye) absentByeNames.add(absentBye.name);
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
    const seedOptions = { state, roundIndex, advancing, seedingOverride: round.seedingOverride };
    seeded = isStandingsCutoffRound(state, roundIndex)
      ? seedFromPoolingExit({ ...seedOptions, groupExit: result.groupExit })
      : tieredSeed(seedOptions).seeded;
    state.roomHistory = recordRoomHistory(state.roomHistory, seeded, roundIndex + 1);
    if (newByes.length) {
      state.byes[roundIndex + 1] = newByes.map((entry) => entry.name);
      seeded.push(
        ...newByes.map((entry) => ({
          name: entry.name,
          room: null,
          isLucky: false,
          ...(absentByeNames.has(entry.name) ? { absentBye: true as const } : {}),
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
