import { clampAdvanceToBracket, parseAdvanceToBracket, resolveBracketEntryCount } from './bracket-entry';
import { deriveRoomSize, resolveOddCountStrategy } from './formats';
import { groupExitRefusal, groupsLineExit } from './group-exit';
import { groupSizesOf } from './group-settings';
import { layeredGraphFor } from './layered-form';
import { planUpperLower, upperLowerGraphText } from './upper-lower';
import { parseWaterfallGraph } from './waterfall-graph-text';
import { validateAndOrderWaterfallGraph } from './waterfall-bracket';
import {
  type GenerationForm,
  type PlanAfterBracketEntry,
  type PlanAfterBracketShape,
  type PlanAfterPoolingRounds,
  type PlanAfterPoolingSettings,
  type Planned,
  refuse,
} from './generation-plan-types';
import type { GeneratedTournamentConfig, OrderedWaterfallGraph, RoomSize, ScheduleLogicKey } from './types';

/**
 * Parses and validates the organiser's waterfall graph here (rather than inside the builder) so a
 * bad graph surfaces through the same generationError -> Setup <Alert> pipeline every other
 * malformed-input case uses. Lenient parse so a graph that is still being built (rounds but no
 * routes yet) reaches the validator, whose messages say what is missing.
 */
function resolveWaterfallGraph(
  graphText: string,
  options: Parameters<typeof validateAndOrderWaterfallGraph>[1],
): { ok: true; graph: OrderedWaterfallGraph } | { ok: false; message: string } {
  if (!graphText.trim()) {
    return {
      ok: false,
      message:
        'Custom bracket needs its rounds and routing set up in the "Custom bracket graph" section below the settings. Start a blank graph there, or load one of the examples, then route the ranks that go on.',
    };
  }
  const parsedGraph = parseWaterfallGraph(graphText, { allowIncomplete: true });
  if (!parsedGraph.ok) return { ok: false, message: parsedGraph.error };
  const validatedGraph = validateAndOrderWaterfallGraph(parsedGraph.value, options);
  if (!validatedGraph.ok) return { ok: false, message: validatedGraph.error };
  return { ok: true, graph: validatedGraph.value };
}

/**
 * The group exit a Groups line implies, written onto `config` (see `groupsLineExit`). Why the line can't be shared
 * between the groups (or the exit's own refusal), or null.
 */
function deriveGroupExitFromLine(
  config: Pick<GeneratedTournamentConfig, 'n' | 'groupSize' | 'groupExit' | 'qualAdv' | 'qualifiersPerGroup'>,
  sentOn: number,
  unitPlural: string,
): string | null {
  const exit = groupsLineExit(
    groupSizesOf(config.n, config.groupSize),
    config.groupExit ?? 'per-group',
    sentOn,
    unitPlural,
  );
  if (exit.qualAdv !== undefined) config.qualAdv = exit.qualAdv;
  if (exit.qualifiersPerGroup !== undefined) config.qualifiersPerGroup = exit.qualifiersPerGroup;
  return exit.refusal;
}

/** Why a bracket format needs `getMinimumBracketUnits` units, for the "Advance to bracket" refusal. */
function belowFloorReason(schedule: ScheduleLogicKey, roomSize: RoomSize): string {
  switch (schedule) {
    case 'single-elimination':
      return ` for single elimination (Semis needs 2 rooms of at least ${roomSize.min})`;
    case 'kings-valley':
      return ` for Kings Valley (it needs 2 rooms of ${roomSize.ideal})`;
    case 'double-elimination':
      return ' for double elimination (a bracket needs at least 4 units)';
    case 'double-elimination-shared-final':
      return ` for shared-Final double elimination (it needs 2 rooms of ${roomSize.ideal})`;
    default:
      return '';
  }
}

/** The graph text of an upper and lower bracket for these units, or why there is none (`planUpperLower`). */
function upperLowerGraphFor(
  form: GenerationForm,
  unitCount: number,
  roomSize: RoomSize,
  unitPlural: string,
): { ok: true; text: string } | { ok: false; message: string } {
  const plan = planUpperLower(form, unitCount, roomSize, unitPlural);
  if (!plan.ok) return plan;
  return {
    ok: true,
    text: upperLowerGraphText(
      plan.entry,
      roomSize,
      plan.firstRound,
      plan.source,
      plan.upper,
      undefined,
      plan.finalWins,
    ),
  };
}

/**
 * The room size, the odd-count strategy, the graph of a Custom bracket (typed, or derived for an upper and lower or a
 * layered bracket) and who advances to the bracket (`config.qualAdv`).
 */
export function planBracketShape(
  form: GenerationForm,
  plan: PlanAfterPoolingSettings,
): Planned<PlanAfterBracketShape> {
  const { unitCount, format, chosen, schedule, formatRoomSize, floorMin, unitPlural } = plan;
  // A copy: "Advance to bracket" overwrites the placeholder below, and the plan so far keeps its own.
  const config = { ...plan.config };

  const oddCountStrategy = resolveOddCountStrategy(format, form.oddCountStrategy);
  const roomSize = deriveRoomSize(format, oddCountStrategy);

  // An upper and lower bracket or a layered bracket reads the graph the app derives from the head count, not the form's.
  let graphText = form.waterfallGraph;
  if (chosen === 'upper-lower') {
    const derived = upperLowerGraphFor(form, unitCount, formatRoomSize, unitPlural);
    if (!derived.ok) return refuse(derived.message);
    graphText = derived.text;
  }
  let layeredPlay: number | undefined;
  if (chosen === 'layered') {
    const derived = layeredGraphFor(form, unitCount);
    if (!derived.ok) return refuse(derived.message);
    graphText = derived.text;
    layeredPlay = derived.play;
  }

  // After a qualification table or a group stage the waterfall graph's own Qual or Groups routing decides
  // who advances, so "Advance to bracket" is derived from it (the highest routed rank), not read from the form.
  let waterfallGraph: OrderedWaterfallGraph | undefined;
  // A Swiss feeds the graph exactly as a qualification table does: its final standings are the graph's Qual source.
  const graphHasQualSource =
    schedule === 'waterfall-bracket' &&
    (config.poolingPhase === 'qual-table' || config.poolingPhase === 'swiss');
  const graphHasGroupsSource = schedule === 'waterfall-bracket' && config.poolingPhase === 'group-stage';
  if (graphHasQualSource) {
    const resolved = resolveWaterfallGraph(graphText, {
      roomSize,
      entrantCount: config.n,
      standingsSource: true,
    });
    if (!resolved.ok) return refuse(resolved.message);
    waterfallGraph = resolved.graph;
    config.qualAdv = waterfallGraph.qualRoutes?.length ?? config.qualAdv;
  } else if (graphHasGroupsSource) {
    const resolved = resolveWaterfallGraph(graphText, {
      roomSize,
      entrantCount: config.n,
      standingsSource: true,
      standingsKind: 'groups',
    });
    if (!resolved.ok) return refuse(resolved.message);
    waterfallGraph = resolved.graph;
    const refusal = deriveGroupExitFromLine(config, waterfallGraph.qualRoutes?.length ?? 0, unitPlural);
    if (refusal) return refuse(refusal);
  } else if (config.poolingPhase !== 'none') {
    const requestedQualAdv = parseAdvanceToBracket(form.qualAdv);
    if (requestedQualAdv === null) {
      return refuse(`Advance to bracket must be a positive whole number — got "${form.qualAdv}".`);
    }
    // Group Stage ignores qualAdv (its entry is groups x qualifiers, checked below) and Setup hides
    // the field, so a leftover value there must not refuse generation.
    if (config.poolingPhase !== 'group-stage' && requestedQualAdv < floorMin) {
      return refuse(
        `Advance to bracket (${requestedQualAdv}) is below the minimum of ${floorMin}${belowFloorReason(schedule, roomSize)}.`,
      );
    }
    config.qualAdv = clampAdvanceToBracket(requestedQualAdv, config.n);
    if (config.groupExit) {
      const refusal = groupExitRefusal(
        config.n,
        config.groupSize,
        config.groupExit,
        config.qualAdv,
        unitPlural,
      );
      if (refusal) return refuse(refusal);
    }
  }

  return {
    ok: true,
    plan: {
      ...plan,
      config,
      oddCountStrategy,
      roomSize,
      graphText,
      layeredPlay,
      waterfallGraph,
      graphHasQualSource,
      graphHasGroupsSource,
    },
  };
}

/**
 * How many units enter the bracket phase, and the graph of a Custom bracket that no standings feed, checked against
 * that number.
 */
export function planBracketEntry(plan: PlanAfterPoolingRounds): Planned<PlanAfterBracketEntry> {
  const { config, schedule, roomSize, graphText, graphHasQualSource, graphHasGroupsSource } = plan;
  let { waterfallGraph } = plan;

  // The number of units that will actually enter the bracket phase (see
  // bracket-entry.ts; Group Stage derives it independently of config.qualAdv,
  // matching groupStagePoolingPhase's own seedTotal formula). Every validation
  // below that needs the real entrant count should use this, not
  // config.qualAdv, which is meaningless for Group Stage.
  // With a Qual source only the routed (non-eliminated) ranks enter the bracket.
  const bracketEntryCount = waterfallGraph?.qualRoutes
    ? waterfallGraph.qualRoutes.filter((destination) => destination !== 'eliminated').length
    : resolveBracketEntryCount({
        poolingPhase: config.poolingPhase,
        confirmedCount: config.n,
        qualAdv: config.qualAdv,
        groupSize: config.groupSize,
        qualifiersPerGroup: config.qualifiersPerGroup,
        groupExit: config.groupExit,
      });

  // Waterfall's whole schedule is the organiser's own hand-authored graph. Without a Qual source,
  // rule 9 checks the graph's declared entry total against bracketEntryCount, the real
  // post-pooling entrant count computed just above -- not config.qualAdv, which is meaningless
  // for Group Stage.
  if (schedule === 'waterfall-bracket' && !graphHasQualSource && !graphHasGroupsSource) {
    const resolved = resolveWaterfallGraph(graphText, {
      roomSize,
      entrantCount: bracketEntryCount,
    });
    if (!resolved.ok) return refuse(resolved.message);
    waterfallGraph = resolved.graph;
  }

  return { ok: true, plan: { ...plan, bracketEntryCount, waterfallGraph } };
}
