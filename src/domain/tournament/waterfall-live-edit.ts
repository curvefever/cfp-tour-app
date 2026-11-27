import { isGroupBandKey, isGroupCutoffKey, isQualCutoffKey } from './advancement';
import { bestPlaceTieKey } from './best-place';
import { GROUP_EXIT_TIE_KEY, groupsLineExit } from './group-exit';
import { unitLabelPluralLower } from './formats';
import { sameRoundFormat } from './match-format';
import { changeRoundMatchFormat } from './match-format-change';
import { rosterKeys } from './roster';
import { usesDependencyPlay } from './round-columns';
import { sameWinTargets } from './win-stamps';
import { generatedConfig } from './generated-config';
import { hasAppWrittenMark, withoutAppWrittenMark } from './rule-versions';
import type { OrderedWaterfallGraph, RoomSize, TournamentRound, TournamentState } from './types';
import { fitWaterfallRound, waterfallBracketPhase, waterfallStandingsRoutes } from './waterfall-bracket';
import { validateAndOrderWaterfallGraph } from './waterfall-graph-check';
import { parseWaterfallGraph, type StandingsSourceKind } from './waterfall-graph-text';
import {
  lateFeederRefusal,
  lockedShapeRefusal,
  startedRounds,
  winsTargetsRefusal,
} from './waterfall-live-edit-locks';
import { changedLineUps, redrawRounds, withReplayedPools } from './waterfall-live-edit-replay';
import type { WaterfallParseResult } from './waterfall-parse-result';

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

/**
 * A qualification-table, Swiss or group-stage tournament's graph has a Qual or Groups source: the last pooling round
 * carries the standings routing (`standingsRoutes`) and the highest rank it sends on is the exit total. A group
 * stage or Swiss generated without a Groups or Qual line stores no routing and keeps the one entry round.
 */
function standingsRoundIndex(state: TournamentState, firstWaterfallIndex: number): number {
  const phase = state.cfg.poolingPhase;
  if (phase !== 'group-stage' && phase !== 'qual-table' && phase !== 'swiss') return -1;
  const index = state.rounds
    .map((round) =>
      Boolean(
        phase === 'group-stage' ? round.isGroupStage : phase === 'swiss' ? round.isSwiss : round.isQual,
      ),
    )
    .lastIndexOf(true);
  if (index < 0 || index >= firstWaterfallIndex) return -1;
  return phase !== 'qual-table' && !state.rounds[index].standingsRoutes ? -1 : index;
}

/** Whether a tie resolution belongs to the Groups line's exit: a band boundary, or the cut-off the exit total sets. */
function isGroupExitTieKey(key: string, includeCutoffs: boolean): boolean {
  return isGroupBandKey(key) || (includeCutoffs && (key === GROUP_EXIT_TIE_KEY || isGroupCutoffKey(key)));
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

/** The round with the edited "best of a place", or without one: the field is left out, never stored as undefined. */
function withBestOf(round: TournamentRound, best: TournamentRound['waterfallBest']): TournamentRound {
  const { waterfallBest: _previous, ...rest } = round;
  return best ? { ...rest, waterfallBest: best } : rest;
}

/**
 * The tie decisions without those on a best of a place that the edit changed or removed: the organiser picked among
 * other units, and a leftover pick would count toward the new line's tie without deciding it.
 */
function withoutChangedBestDecisions(
  tieResolutions: TournamentState['tieResolutions'],
  before: TournamentRound[],
  after: TournamentRound[],
  keptLength: number,
): TournamentState['tieResolutions'] {
  const kept = { ...tieResolutions };
  for (let index = 0; index < keptLength; index += 1) {
    if (JSON.stringify(before[index]?.waterfallBest) !== JSON.stringify(after[index]?.waterfallBest)) {
      delete kept[bestPlaceTieKey(index)];
    }
  }
  return kept;
}

/** A reached round with the edited routing; one drawn short keeps its real shape and recounts the ranks it still sends on. */
function rerouted(reachedRound: TournamentRound, spec: TournamentRound): TournamentRound {
  const next = withBestOf(
    { ...reachedRound, waterfallRoutes: spec.waterfallRoutes, advTotal: spec.advTotal },
    spec.waterfallBest,
  );
  if (!reachedRound.declaredRooms) return next;
  const fitted = fitWaterfallRound(next, reachedRound.players);
  return 'error' in fitted ? next : fitted;
}

/** The pooling rounds before the bracket, as they stand. */
function poolingBefore(state: TournamentState, firstWaterfallIndex: number): TournamentRound[] {
  return state.rounds.slice(0, firstWaterfallIndex);
}

/** What a save reads from the running tournament before it reads the edited text. */
interface EditBase {
  firstWaterfallIndex: number;
  finalsGames: number;
  finalsBestOf: number | undefined;
  roomSize: RoomSize;
  entryRound: TournamentRound;
  qualIndex: number;
  standingsSource: boolean;
  standingsKind: StandingsSourceKind;
  entrantCount: number;
  reachedCount: number;
  reached: TournamentRound[];
  fixedPrefix: string[];
  columnsStored: boolean;
  writeColumns: boolean;
  fixedColumns: number[] | undefined;
}

/** The tournament a save starts from, or why it has no graph to edit as it stands. */
function readEditBase(state: TournamentState): WaterfallParseResult<EditBase> {
  const firstWaterfallIndex = state.rounds.findIndex((round) => round.isWaterfall);
  if (firstWaterfallIndex === -1) {
    return { ok: false, error: 'This tournament has no custom bracket phase to edit.' };
  }
  const config = generatedConfig(state);
  const { finalsGames, finalsBestOf } = state.gamemodeConfig;
  if (!config || finalsGames === undefined) {
    return { ok: false, error: MISSING_CONFIG_MESSAGE };
  }
  const { roomSize } = config;

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

  return {
    ok: true,
    value: {
      firstWaterfallIndex,
      finalsGames,
      finalsBestOf,
      roomSize,
      entryRound,
      qualIndex,
      standingsSource,
      standingsKind,
      entrantCount,
      reachedCount,
      reached,
      fixedPrefix,
      columnsStored,
      writeColumns,
      fixedColumns,
    },
  };
}

/** The edited text parsed and checked against what has already started: the ordered graph, or why it can't be saved. */
function readEditedGraph(base: EditBase, text: string): WaterfallParseResult<OrderedWaterfallGraph> {
  const { roomSize, entrantCount, standingsSource, standingsKind } = base;
  const { reachedCount, fixedPrefix, columnsStored, fixedColumns } = base;

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
  return validated;
}

/** The edited graph as rounds: every bracket round as the save would have it. */
interface BracketRounds {
  /** The graph's rounds as generation would write them. */
  materialized: TournamentRound[];
  standingsRoutes: TournamentRound['standingsRoutes'];
  /** What the tournament gets: the reached rounds rerouted, the rest new. */
  newBracketRounds: TournamentRound[];
}

/** The bracket rounds of the edited graph, or why a drawn round can't take its new win targets. */
function buildBracketRounds(
  base: EditBase,
  graph: OrderedWaterfallGraph,
): WaterfallParseResult<BracketRounds> {
  const { finalsGames, finalsBestOf, entryRound, entrantCount, reached, writeColumns } = base;

  const materialized = waterfallBracketPhase(graph.qualRoutes?.length ?? entrantCount, entryRound.roundNum, {
    graph,
    finalsGames,
    finalsBestOf,
  });
  const winsChanged = reached.find(
    (round, index) => !sameWinTargets(round.winTargets, materialized[index]?.winTargets),
  );
  if (winsChanged) return { ok: false, error: winsTargetsRefusal(winsChanged) };
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

  return { ok: true, value: { materialized, standingsRoutes, newBracketRounds } };
}

/** In dependency play, why the new routing would feed a drawn round from one not done. Null when it doesn't. */
function dependencyLateFeederRefusal(
  state: TournamentState,
  newBracketRounds: TournamentRound[],
  firstWaterfallIndex: number,
  reached: TournamentRound[],
): string | null {
  if (usesDependencyPlay(state)) {
    const refusal = lateFeederRefusal(
      state,
      [...poolingBefore(state, firstWaterfallIndex), ...newBracketRounds],
      firstWaterfallIndex,
      reached.length,
    );
    if (refusal) return refusal;
  }
  return null;
}

/** The round lists of the edited tournament: what is reached stays as it is, every later round starts empty. */
function roundLists(state: TournamentState, base: EditBase, built: BracketRounds) {
  const { firstWaterfallIndex, qualIndex, reached } = base;
  const { standingsRoutes, newBracketRounds } = built;

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

  return { keptLength, tailLength, poolingRounds, rounds, assignments, byes, luckyLosers };
}

/** The pooling exit's settings as the edited Qual or Groups line implies them, or why that line can't be saved. */
function editedExit(
  state: TournamentState,
  base: EditBase,
  graph: OrderedWaterfallGraph,
): WaterfallParseResult<TournamentState['cfg']> {
  const { standingsSource, standingsKind, qualIndex, reachedCount } = base;

  const sentOn = graph.qualRoutes?.length;
  let cfg: TournamentState['cfg'] = { ...state.cfg, qualAdv: sentOn ?? state.cfg.qualAdv };
  if (standingsSource && standingsKind === 'groups' && sentOn !== undefined) {
    const settings = groupsLineSettings(state, sentOn, state.rounds[qualIndex], reachedCount > 0);
    if (!settings.ok) return settings;
    cfg = settings.cfg;
  }
  return { ok: true, value: cfg };
}

/** The tie decisions the edited tournament keeps. */
function keptTieDecisions(
  state: TournamentState,
  base: EditBase,
  edit: {
    cfg: TournamentState['cfg'];
    rounds: TournamentRound[];
    standingsRoutes: TournamentRound['standingsRoutes'];
  },
): TournamentState['tieResolutions'] {
  const { firstWaterfallIndex, qualIndex, standingsSource, standingsKind, reachedCount, reached } = base;
  const { cfg, rounds, standingsRoutes } = edit;

  // A tie resolution made for the old cut lines can't be trusted for new ones, but once the bracket is
  // entered the draw already used them, so they stay.
  const routingChanged =
    JSON.stringify(state.rounds[qualIndex]?.standingsRoutes) !== JSON.stringify(standingsRoutes);
  const exitChanged =
    cfg.qualAdv !== state.cfg.qualAdv || cfg.qualifiersPerGroup !== state.cfg.qualifiersPerGroup;
  const dropStaleTies = standingsSource && routingChanged && reachedCount === 0;
  const isStale = (key: string) =>
    standingsKind === 'groups' ? isGroupExitTieKey(key, exitChanged) : isQualCutoffKey(key);
  const tieResolutions = withoutChangedBestDecisions(
    dropStaleTies
      ? Object.fromEntries(Object.entries(state.tieResolutions).filter(([key]) => !isStale(key)))
      : state.tieResolutions,
    state.rounds,
    rounds,
    firstWaterfallIndex + reached.length,
  );
  return tieResolutions;
}

/** The edited tournament as the replay reads it: the new rounds and settings, the pools and draws not yet redone. */
function editedDraft(
  state: TournamentState,
  base: EditBase,
  edit: Pick<TournamentState, 'cfg' | 'rounds' | 'assignments' | 'byes' | 'luckyLosers' | 'tieResolutions'>,
): TournamentState {
  const { reachedCount } = base;
  const { cfg, rounds, assignments, byes, luckyLosers, tieResolutions } = edit;

  return {
    ...state,
    ...(reachedCount === 0 && state.waterfallSteps?.length ? { waterfallSteps: [] } : {}),
    cfg,
    rounds,
    assignments,
    byes,
    luckyLosers,
    tieResolutions,
  };
}

/** The tournament with the saved text in its settings and, where it stores one, the ordered graph. */
function withStoredGraph(
  state: TournamentState,
  working: TournamentState,
  graph: OrderedWaterfallGraph,
  text: string,
): TournamentState {
  const settings = state.settings ? { ...state.settings, waterfallGraph: text } : state.settings;
  const gamemodeConfig =
    state.gamemodeConfig.graph !== undefined ? { ...state.gamemodeConfig, graph } : state.gamemodeConfig;
  return { ...working, settings, gamemodeConfig };
}

/** The reached rounds in the match format of the edit, or why the typed scores can't be read under it. */
function withEditedMatchFormats(
  edited: TournamentState,
  materialized: TournamentRound[],
  reached: TournamentRound[],
  firstWaterfallIndex: number,
): WaterfallParseResult<TournamentState> {
  let working = edited;

  // The round in play takes the match format of the edit; its typed scores are carried over or refused.
  for (const [index, spec] of materialized.slice(0, reached.length).entries()) {
    const roundIndex = firstWaterfallIndex + index;
    if (sameRoundFormat(working.rounds[roundIndex], spec)) continue;
    const changed = changeRoundMatchFormat(working, roundIndex, spec);
    if ('error' in changed) return { ok: false, error: changed.error };
    working = changed.state;
  }
  return { ok: true, value: working };
}

export function applyWaterfallGraphEdit(state: TournamentState, text: string): WaterfallGraphEditResult {
  const read = readEditBase(state);
  if (!read.ok) return read;
  const base = read.value;
  const { firstWaterfallIndex, finalsGames, finalsBestOf, standingsSource, reached } = base;

  const edited = readEditedGraph(base, text);
  if (!edited.ok) return edited;
  const graph = edited.value;

  const shapeRefusal = lockedShapeRefusal({
    state,
    reached,
    graph,
    firstWaterfallIndex,
    finalsGames,
    finalsBestOf,
  });
  if (shapeRefusal) return { ok: false, error: shapeRefusal };

  const built = buildBracketRounds(base, graph);
  if (!built.ok) return built;
  const { materialized, standingsRoutes, newBracketRounds } = built.value;

  const lateRefusal = dependencyLateFeederRefusal(state, newBracketRounds, firstWaterfallIndex, reached);
  if (lateRefusal) return { ok: false, error: lateRefusal };

  const lists = roundLists(state, base, built.value);
  const { keptLength, rounds } = lists;

  const exit = editedExit(state, base, graph);
  if (!exit.ok) return exit;
  const cfg = exit.value;

  const tieResolutions = keptTieDecisions(state, base, { cfg, rounds, standingsRoutes });
  let working = editedDraft(state, base, { ...lists, cfg, tieResolutions });

  const compared = changedLineUps({ state, working, firstWaterfallIndex, standingsSource, keptLength });
  if (!compared.ok) return compared;
  const { redrawn, replayPools } = compared.value;
  working = withReplayedPools(state, working, firstWaterfallIndex, replayPools);

  if (redrawn.length > 0) {
    const failure = redrawRounds(working, redrawn, replayPools);
    if ('error' in failure) return { ok: false, error: failure.error };
    working = failure.state;
  }

  working = withStoredGraph(state, working, graph, text);
  const formatted = withEditedMatchFormats(working, materialized, reached, firstWaterfallIndex);
  if (!formatted.ok) return formatted;
  working = formatted.value;

  const redrawnRound = redrawn.length
    ? redrawn.map((index) => working.rounds[index].customLabel).join(' + ')
    : null;
  return { ok: true, state: working, redrawnRound };
}

/**
 * A graph save made by hand in the running Admin ("Edit graph"). On a bracket the app wrote (the upper and lower
 * bracket, the layered bracket) it makes it a Custom bracket for good: the mark is dropped and every round's stage cleared (the rounds keep the formats they have; the
 * graph text carries them), and the settings snapshot reads Custom bracket, so the app stops working the rooms out and
 * Copy settings copies the edited graph.
 */
export function applyHandGraphEdit(state: TournamentState, text: string): WaterfallGraphEditResult {
  const result = applyWaterfallGraphEdit(state, text);
  if (!result.ok || !hasAppWrittenMark(result.state.gamemodeConfig)) return result;
  const gamemodeConfig = withoutAppWrittenMark(result.state.gamemodeConfig);
  return {
    ...result,
    state: {
      ...result.state,
      gamemodeConfig,
      rounds: result.state.rounds.map(({ graphMatchStage: _stage, ...entry }) => entry),
      settings: result.state.settings && { ...result.state.settings, scheduleLogic: 'waterfall-bracket' },
    },
  };
}
