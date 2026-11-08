import { withoutRoundAbsences } from './absences';
import { isGroupBandKey, isQualCutoffKey } from './advancement';
import { currentUnit, replayBracketPools } from './bracket-replay';
import { GROUP_EXIT_TIE_KEY, groupsLineExit } from './group-exit';
import { unitLabelPluralLower } from './formats';
import { changeRoundMatchFormat, sameMatchFormat } from './match-format-change';
import { rosterKeys } from './roster';
import {
  currentColumn,
  isRoundDone,
  isRoundReached,
  reopenedRounds,
  roundColumn,
  usesDependencyPlay,
} from './round-columns';
import { rewindRoomHistory } from './seeding';
import { roundHasAnyScore } from './scoring';
import { seedRoundFromPendingPool } from './transitions';
import { routesTo } from './waterfall-steps';
import type { PendingBracketSeed, TournamentRound, TournamentState } from './types';
import {
  declaredWaterfallRooms,
  fitWaterfallRound,
  matchFormatFields,
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
  waterfallStandingsRoutes,
} from './waterfall-bracket';

/**
 * Applying an edited waterfall graph to a running tournament: any round's
 * routing can change, including already-played rounds, as long as a played
 * round's own recorded line-up comes out identical after the edited routing
 * is replayed -- only the current round may be re-drawn, and only before it
 * has any score. `state.rounds` is the source of truth for what's actually
 * running, not the `settings.waterfallGraph` snapshot.
 */
export type WaterfallGraphEditResult =
  { ok: true; state: TournamentState; redrawnRound: string | null } | { ok: false; error: string };

const MISSING_CONFIG_MESSAGE =
  "Can't save — this tournament's gamemode configuration is missing a room size or Finals format. This should never happen for a tournament generated through Setup; it may indicate corrupted or manually-edited state.";

function sameNameSet(assignments: string[], seeds: PendingBracketSeed[]): boolean {
  const existing = new Set(assignments);
  const replayed = new Set(seeds.map((seed) => seed.name));
  return existing.size === replayed.size && [...existing].every((name) => replayed.has(name));
}

/**
 * A qualification-table or group-stage tournament's graph has a Qual or Groups source: the last pooling round
 * carries the standings routing (`standingsRoutes`) and the highest rank it sends on is the exit total. A group
 * stage generated without a Groups line stores no routing and keeps the one entry round.
 */
function standingsRoundIndex(state: TournamentState, firstWaterfallIndex: number): number {
  const groupStage = state.cfg.poolingPhase === 'group-stage';
  if (!groupStage && state.cfg.poolingPhase !== 'qual-table') return -1;
  const index = state.rounds
    .map((round) => Boolean(groupStage ? round.isGroupStage : round.isQual))
    .lastIndexOf(true);
  if (index < 0 || index >= firstWaterfallIndex) return -1;
  return groupStage && !state.rounds[index].standingsRoutes ? -1 : index;
}

/** Whether a tie resolution belongs to the Groups line's exit: a band boundary, or the cut-off the exit total sets. */
function isGroupExitTieKey(key: string, includeCutoffs: boolean): boolean {
  return (
    isGroupBandKey(key) || (includeCutoffs && (key === GROUP_EXIT_TIE_KEY || key.startsWith('group-cutoff-')))
  );
}

type GroupsLineSettings = { ok: true; cfg: TournamentState['cfg'] } | { ok: false; error: string };

/**
 * The exit settings a Groups line implies. While the groups are played it sets the total (or the qualifiers per
 * group), checked against the groups as they stand now. Once the bracket is entered the exit is over: the line may
 * only route ranks that actually left the groups, and the settings stay.
 */
function groupsLineSettings(
  state: TournamentState,
  sentOn: number,
  standingsRound: TournamentRound,
  bracketEntered: boolean,
): GroupsLineSettings {
  if (bracketEntered) {
    const left = standingsRound.standingsExitOrder?.length;
    if (left !== undefined && sentOn > left) {
      return {
        ok: false,
        error: `Can't save: only ${left} left the groups, so the Groups line can't route rank ${sentOn}.`,
      };
    }
    return { ok: true, cfg: state.cfg };
  }
  const exit = groupsLineExit(
    state.groups.map((group) => group.members.length),
    state.cfg.groupExit ?? 'per-group',
    sentOn,
    unitLabelPluralLower(state.settings?.gameFormat),
  );
  if (exit.refusal) return { ok: false, error: `Can't save: ${exit.refusal}` };
  return {
    ok: true,
    cfg: {
      ...state.cfg,
      qualAdv: exit.qualAdv ?? state.cfg.qualAdv,
      qualifiersPerGroup: exit.qualifiersPerGroup ?? state.cfg.qualifiersPerGroup,
    },
  };
}

/** A reached round with the edited routing; one drawn short keeps its real shape and recounts the ranks it still sends on. */
function rerouted(reachedRound: TournamentRound, spec: TournamentRound): TournamentRound {
  const next = { ...reachedRound, waterfallRoutes: spec.waterfallRoutes, advTotal: spec.advTotal };
  if (!reachedRound.declaredRooms) return next;
  const fitted = fitWaterfallRound(next, reachedRound.players);
  return 'error' in fitted ? next : fitted;
}

/**
 * Re-draws the rounds of the current column whose line-up the edit changed, from the replayed pools.
 * Each one is cleared first (draw, byes, tie resolutions, room history), then drawn again in order.
 */
function redrawRounds(
  state: TournamentState,
  indices: number[],
  replayPools: Map<number, PendingBracketSeed[]>,
): { state: TournamentState } | { error: string } {
  let working = state;
  for (const index of indices) {
    working = {
      ...working,
      assignments: working.assignments.map((entry, position) => (position === index ? [] : entry)),
      byes: working.byes.map((entry, position) => (position === index ? [] : entry)),
      tieResolutions: Object.fromEntries(
        Object.entries(working.tieResolutions).filter(([key]) => !key.startsWith(`r${index}-`)),
      ),
      absences: withoutRoundAbsences(working.absences, index),
      pendingBracketSeeds: { ...working.pendingBracketSeeds, [index]: replayPools.get(index) ?? [] },
    };
  }
  for (const index of indices) {
    working = {
      ...working,
      roomHistory: rewindRoomHistory(working.roomHistory, working.assignments, index),
    };
  }
  for (const index of indices) {
    // The pool may be short of the round's declared seats (a withdrawal): draw it short, as an advance would.
    const fitted = fitWaterfallRound(working.rounds[index], (replayPools.get(index) ?? []).length);
    if ('error' in fitted) return { error: fitted.error };
    working = {
      ...working,
      rounds: working.rounds.map((round, position) => (position === index ? fitted : round)),
    };
    const failure = seedRoundFromPendingPool(working, index);
    // The pool now fits the round exactly; this is a defensive fallback.
    if (failure) return { error: failure.message };
  }
  return { state: working };
}

/** The rounds a save treats as already started. `drawn` are drawn (they keep their round and draw); `fixed` also holds the undrawn rounds of a column that has started, whose label and column stay. */
interface StartedRounds {
  drawn: number;
  fixed: number;
}

/**
 * Which rounds of the bracket have started. Column play: the column in play and every one before it, whole. Dependency
 * play: the drawn rounds are a prefix of the bracket's rounds in the common shape, and a column with any drawn round
 * counts whole. Other shapes, and a reopened press, are refused: the save can't tell which draws its replay would keep.
 */
function startedRounds(
  state: TournamentState,
  firstWaterfallIndex: number,
): StartedRounds | { error: string } {
  if (!usesDependencyPlay(state)) {
    const count =
      state.curRound < firstWaterfallIndex ? 0 : currentColumn(state).end - firstWaterfallIndex + 1;
    return { drawn: count, fixed: count };
  }
  const label = (index: number) => state.rounds[index].customLabel ?? `Round ${state.rounds[index].roundNum}`;
  const reopened = reopenedRounds(state);
  if (reopened.length > 0) {
    const names = reopened.map((index) => `"${label(index)}"`).join(', ');
    return {
      error: `Can't save while ${names} ${reopened.length > 1 ? 'are' : 'is'} reopened with Previous: press Next Round to send ${reopened.length > 1 ? 'them' : 'it'} on again first.`,
    };
  }
  const bracket = state.rounds.map((_, index) => index).filter((index) => index >= firstWaterfallIndex);
  const reached = bracket.filter((index) => isRoundReached(state, index));
  const gap = bracket.find((index, offset) => offset < reached.length && !isRoundReached(state, index));
  if (gap !== undefined) {
    const later = reached.find((index) => index > gap) as number;
    return {
      error: `Can't save yet: "${label(gap)}" has not been drawn, but "${label(later)}" has. Play on until "${label(gap)}" is drawn, then save the graph.`,
    };
  }
  const last = firstWaterfallIndex + reached.length - 1;
  return {
    drawn: reached.length,
    fixed: roundColumn(state.rounds, last).end - firstWaterfallIndex + 1,
  };
}

/** A drawn round can't take units from a round that is not done: its draw would be missing them. Null when it doesn't. */
function lateFeederRefusal(
  state: TournamentState,
  rounds: TournamentRound[],
  firstWaterfallIndex: number,
  drawn: number,
): string | null {
  const label = (round: TournamentRound) => round.customLabel ?? `Round ${round.roundNum}`;
  for (let index = firstWaterfallIndex; index < firstWaterfallIndex + drawn; index += 1) {
    const source = rounds.findIndex(
      (round, candidate) => routesTo(round, index) && !isRoundDone(state, candidate),
    );
    if (source !== -1) {
      return `Can't save: "${label(rounds[source])}" is not done yet, so it can't feed "${label(rounds[index])}", which is already drawn.`;
    }
  }
  return null;
}

/** The pooling rounds before the bracket, as they stand. */
function poolingBefore(state: TournamentState, firstWaterfallIndex: number): TournamentRound[] {
  return state.rounds.slice(0, firstWaterfallIndex);
}

/** The advances the replay of a save repeats: the rounds before the column in play, or in dependency play the set of rounds done. */
function advancesReplayed(state: TournamentState): number | ReadonlySet<number> {
  if (!usesDependencyPlay(state)) return currentColumn(state).start;
  return new Set(state.rounds.flatMap((_, index) => (isRoundDone(state, index) ? [index] : [])));
}

export function applyWaterfallGraphEdit(state: TournamentState, text: string): WaterfallGraphEditResult {
  const firstWaterfallIndex = state.rounds.findIndex((round) => round.isWaterfall);
  if (firstWaterfallIndex === -1) {
    return { ok: false, error: 'This tournament has no custom bracket phase to edit.' };
  }
  const roomSize = state.gamemodeConfig.roomSize;
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  if (!roomSize || finalsGames === undefined) {
    return { ok: false, error: MISSING_CONFIG_MESSAGE };
  }

  const entryRound = state.rounds[firstWaterfallIndex];
  const qualIndex = standingsRoundIndex(state, firstWaterfallIndex);
  const standingsSource = qualIndex !== -1;
  const standingsKind = state.cfg.poolingPhase === 'group-stage' ? 'groups' : 'qual';
  // With a Qual or Groups source the head count is the units still registered (a withdrawal shrinks it), not the entry round's size.
  const entrantCount = standingsSource ? rosterKeys(state.players).length : entryRound.players;
  // Empty while still in pooling (the bracket hasn't been entered yet). A started column counts whole.
  const started = startedRounds(state, firstWaterfallIndex);
  if ('error' in started) return { ok: false, error: started.error };
  const reachedCount = started.drawn;
  const reached = state.rounds.slice(firstWaterfallIndex, firstWaterfallIndex + reachedCount);
  const fixedRounds = state.rounds.slice(firstWaterfallIndex, firstWaterfallIndex + started.fixed);
  const fixedPrefix = fixedRounds.map((round) => round.customLabel as string);
  // A tournament generated before columns existed has none stored: once its bracket has started it
  // keeps playing one round at a time. Before that, a save gives it its columns.
  const columnsStored = entryRound.waterfallColumn !== undefined;
  const writeColumns = columnsStored || reachedCount === 0;
  const fixedColumns = columnsStored
    ? fixedRounds.map((round) => round.waterfallColumn as number)
    : undefined;

  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (reachedCount > 0 && !columnsStored && parsed.value.roundLines.some((line) => line.column !== null)) {
    return {
      ok: false,
      error:
        "This tournament's rounds are played one at a time -- columns can't be set once its bracket has started.",
    };
  }
  const validated = validateAndOrderWaterfallGraph(parsed.value, {
    roomSize,
    entrantCount,
    fixedPrefix,
    fixedColumns,
    firstOpenColumn: fixedColumns?.length ? Math.max(...fixedColumns) + 1 : 1,
    standingsSource,
    standingsKind,
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  const graph = validated.value;

  // Locked shape: a reached round keeps its label, room count, room size and
  // Final flag -- fixedPrefix already forces graph.rounds[0..reached.length)
  // to be these rounds in order, so this only needs to compare shape, not
  // identity.
  for (const [index, oldRound] of reached.entries()) {
    const spec = graph.rounds[index];
    // A round drawn short (a withdrawal) is compared by the shape the graph declared for it.
    const declaredRooms = declaredWaterfallRooms(oldRound);
    const sameShape =
      spec &&
      spec.label === oldRound.customLabel &&
      spec.roomSizes.length === declaredRooms.length &&
      spec.roomSizes[0] === declaredRooms[0] &&
      spec.isFinal === oldRound.isFinal;
    if (!sameShape) {
      return {
        ok: false,
        error: `Can't save: "${oldRound.customLabel}" has already started, so its room count, room size and Final flag can't change. Only its routing can.`,
      };
    }
    // The round in play may change its match format (its scores are read again under the new one); a finished one may not.
    if (
      isRoundDone(state, firstWaterfallIndex + index) &&
      !sameMatchFormat(oldRound, matchFormatFields(spec, finalsGames, finalsBestOf))
    ) {
      return {
        ok: false,
        error: `Can't save: "${oldRound.customLabel}" is finished, so its match format can't change.`,
      };
    }
  }

  const materialized = waterfallBracketPhase(graph.qualRoutes?.length ?? entrantCount, entryRound.roundNum, {
    graph,
    finalsGames,
    finalsBestOf,
  });
  const standingsRoutes = waterfallStandingsRoutes(graph, entryRound.roundNum);
  // Reached rounds keep their own round object (scores, numGames,
  // anonymousGames, ... untouched) -- only their routing and the advancement
  // total it implies are replaced. Unreached rounds are wholly new.
  const newBracketRounds: TournamentRound[] = materialized.map((spec, index) => {
    if (index < reached.length) return rerouted(reached[index], spec);
    if (writeColumns) return spec;
    const { waterfallColumn: _column, waterfallColumnSet: _set, ...single } = spec;
    return single;
  });

  if (usesDependencyPlay(state)) {
    const refusal = lateFeederRefusal(
      state,
      [...poolingBefore(state, firstWaterfallIndex), ...newBracketRounds],
      firstWaterfallIndex,
      reached.length,
    );
    if (refusal) return { ok: false, error: refusal };
  }

  const keptLength = firstWaterfallIndex + reached.length;
  const tailLength = newBracketRounds.length - reached.length;
  const poolingRounds = state.rounds
    .slice(0, firstWaterfallIndex)
    .map((round, index) => (index === qualIndex && standingsRoutes ? { ...round, standingsRoutes } : round));
  const rounds = [...poolingRounds, ...newBracketRounds];
  const assignments = [
    ...state.assignments.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): TournamentState['assignments'][number] => []),
  ];
  const byes = [
    ...state.byes.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): string[] => []),
  ];
  const luckyLosers = [
    ...state.luckyLosers.slice(0, keptLength),
    ...Array.from({ length: tailLength }, (): string[] => []),
  ];

  const sentOn = graph.qualRoutes?.length;
  let cfg: TournamentState['cfg'] = { ...state.cfg, qualAdv: sentOn ?? state.cfg.qualAdv };
  if (standingsSource && standingsKind === 'groups' && sentOn !== undefined) {
    const settings = groupsLineSettings(state, sentOn, state.rounds[qualIndex], reachedCount > 0);
    if (!settings.ok) return settings;
    cfg = settings.cfg;
  }
  // A tie resolution made for the old cut lines can't be trusted for new ones, but once the bracket is
  // entered the draw already used them, so they stay.
  const routingChanged =
    JSON.stringify(state.rounds[qualIndex]?.standingsRoutes) !== JSON.stringify(standingsRoutes);
  const exitChanged =
    cfg.qualAdv !== state.cfg.qualAdv || cfg.qualifiersPerGroup !== state.cfg.qualifiersPerGroup;
  const dropStaleTies = standingsSource && routingChanged && reachedCount === 0;
  const isStale = (key: string) =>
    standingsKind === 'groups' ? isGroupExitTieKey(key, exitChanged) : isQualCutoffKey(key);
  const tieResolutions = dropStaleTies
    ? Object.fromEntries(Object.entries(state.tieResolutions).filter(([key]) => !isStale(key)))
    : state.tieResolutions;
  let working: TournamentState = {
    ...state,
    ...(reachedCount === 0 && state.waterfallSteps?.length ? { waterfallSteps: [] } : {}),
    cfg,
    rounds,
    assignments,
    byes,
    luckyLosers,
    tieResolutions,
  };

  // Replay every advance of the rounds done (in column play: every round before the current column) under the new
  // routing, accumulating per-destination pools exactly as advanceTournamentRound would across a
  // sequence of real advances. Recorded line-ups still hold the units that withdrew or were swapped
  // out: a replayed pool keeps only the units now in the tournament (a swapped-out unit becomes its
  // replacement), so a withdrawal never moves anyone else up into the empty seat.
  const roster = new Set(rosterKeys(state.players));
  const { pools: replayPools } = replayBracketPools(working, advancesReplayed(state));

  // Compare every reached round against what the new routing would have
  // produced -- except, without a Qual source, the entry round (which has no
  // inbound routes, so its line-up can never change).
  const redrawn: number[] = [];
  for (let index = firstWaterfallIndex + (standingsSource ? 0 : 1); index < keptLength; index += 1) {
    const round = working.rounds[index];
    const lineUp = (working.assignments[index] ?? []).flatMap((entry) => {
      const name = currentUnit(state, roster, entry.name);
      return name === null ? [] : [name];
    });
    if (sameNameSet(lineUp, replayPools.get(index) ?? [])) continue;
    if (isRoundDone(state, index)) {
      return {
        ok: false,
        error: `Can't save: "${round.customLabel}" has already been played with a different line-up. Undo the routing change that feeds it, or only edit rounds that haven't been played yet.`,
      };
    }
    if (roundHasAnyScore(state, index, state.rounds[index])) {
      return {
        ok: false,
        error: `Can't save: a score has already been entered in "${round.customLabel}", so its rooms can't be re-drawn. Undo the routing change that feeds it, or wait until the round is complete.`,
      };
    }
    redrawn.push(index);
  }

  // Old pending pools keyed by an index that fell in the old waterfall
  // range but past the current column belong to rounds that no longer exist at that
  // index (the edit may have added, removed or reordered unreached rounds)
  // -- drop them and replace with the freshly replayed pools.
  const oldBracketLength = state.rounds.length - firstWaterfallIndex;
  const nextPending: Record<string, PendingBracketSeed[]> = {};
  for (const [key, seeds] of Object.entries(working.pendingBracketSeeds)) {
    const index = Number(key);
    const wasOldUnreachedWaterfallIndex =
      index >= firstWaterfallIndex &&
      index < firstWaterfallIndex + oldBracketLength &&
      !isRoundReached(state, index);
    if (wasOldUnreachedWaterfallIndex) continue;
    nextPending[key] = seeds;
  }
  for (const [destination, seeds] of replayPools) {
    if (!isRoundReached(state, destination)) nextPending[destination] = seeds;
  }
  working = { ...working, pendingBracketSeeds: nextPending };

  if (redrawn.length > 0) {
    const failure = redrawRounds(working, redrawn, replayPools);
    if ('error' in failure) return { ok: false, error: failure.error };
    working = failure.state;
  }

  const settings = state.settings ? { ...state.settings, waterfallGraph: text } : state.settings;
  const gamemodeConfig =
    state.gamemodeConfig.graph !== undefined ? { ...state.gamemodeConfig, graph } : state.gamemodeConfig;
  working = { ...working, settings, gamemodeConfig };

  // The round in play takes the match format of the edit; its typed scores are carried over or refused.
  for (const [index, spec] of materialized.slice(0, reached.length).entries()) {
    const roundIndex = firstWaterfallIndex + index;
    if (sameMatchFormat(working.rounds[roundIndex], spec)) continue;
    const changed = changeRoundMatchFormat(working, roundIndex, spec);
    if ('error' in changed) return { ok: false, error: changed.error };
    working = changed.state;
  }

  const redrawnRound = redrawn.length
    ? redrawn.map((index) => working.rounds[index].customLabel).join(' + ')
    : null;
  return { ok: true, state: working, redrawnRound };
}
