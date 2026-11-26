import { invalidateStaleTieResolutions } from './room-ties';
import { withoutSeatAbsences } from './absences';
import { generatedConfig } from './generated-config';
import { replanUpperLower } from './upper-lower-replan';
import { getGameFormat } from './formats';
import { lateJoinersOf } from './late-joiners';
import { regenerateForRoster } from './pre-start-roster';
import { computeRankings } from './rankings';
import { refused, type RosterEditResult } from './roster-edits';
import { rebuildFutureRounds, refitFuturePoolingRounds } from './replan-future-rounds';
import { roundInPlayOf } from './round-columns';
import {
  findUnstorableNames,
  isDisplayNameTaken,
  findUnit,
  isWithdrawnName,
  rosterKey,
  rosterKeys,
  teamNames,
  withUnit,
  withoutUnit,
} from './roster';
import { createTournamentRuntime, type TournamentRuntime } from './runtime';
import { scoredTeamSize, scoreKeysForPosition } from './scoring';
import { inheritedAbsentRound, patchPublishedFutureRounds, recordWithdrawal } from './unit-removal';
import type { TournamentState, TournamentTeam } from './types';

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
