import { getGameFormat, deriveRoomSize } from './formats';
import { groupExitRefusal } from './group-exit';
import { GROUP_SIZE_BOUNDS, groupSettingsOf } from './group-settings';
import { layeredGateRefusal } from './layered-form';
import { QUALIFICATION_ROUNDS, computeSwissRoundCount } from './pooling';
import { MAX_POOLING_ROUNDS_OVERRIDE, parsePoolingRoundsOverride } from './pooling-rounds';
import { rosterFitsFormat, rosterKeys } from './roster';
import { matchFormatConfig } from './round-match-formats';
import {
  planEliminationOverrides,
  planFinalTargets,
  planSizeOverrides,
  planStoredSettings,
} from './generation-plan-bracket';
import { checkFormatGates } from './generation-plan-gates';
import { planScoring } from './generation-plan-scoring';
import { planBracketEntry, planBracketShape } from './generation-plan-shape';
import { getMinimumBracketUnits } from './schedule-generation';
import {
  type GenerationConfig,
  type GenerationForm,
  type PlanAfterBracketShape,
  type PlanAfterPoolingRounds,
  type PlanAfterPoolingSettings,
  type PlanAfterRoster,
  type Planned,
  refuse,
  type TournamentPlan,
} from './generation-plan-types';
import type { RoomSize, ScheduleLogicKey, TournamentState } from './types';

/** Why too few units are registered for a schedule logic (its floor, `getMinimumBracketUnits`), or null. */
export function registeredBelowFloorMessage(
  schedule: ScheduleLogicKey,
  roomSize: RoomSize,
  unitPlural: string,
  unitCount: number,
): string | null {
  const floorMin = getMinimumBracketUnits(schedule, roomSize);
  if (unitCount >= floorMin) return null;
  const reason =
    schedule === 'single-elimination' ? ` (Semis needs 2 rooms of at least ${roomSize.min})` : '';
  return `This format needs at least ${floorMin} registered ${unitPlural}${reason}. Registered: ${unitCount}.`;
}

function resolvePoolingRoundsOverride(
  raw: string,
  defaultValue: number,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  const parsedValue = parsePoolingRoundsOverride(raw);
  if (parsedValue === undefined) return { ok: true, value: defaultValue };
  if (parsedValue === null) {
    return {
      ok: false,
      error: `${label} round count override must be a whole number from 1 to ${MAX_POOLING_ROUNDS_OVERRIDE} — got "${raw}".`,
    };
  }
  return { ok: true, value: parsedValue };
}

/** The roster, the game format, the minimum head count and the layered gate. */
function planRoster(form: GenerationForm, current: TournamentState): Planned<PlanAfterRoster> {
  if (current.confirmedCount === null || current.confirmedCount === undefined) {
    return refuse('Load a roster first — click "Load roster & reserves" before generating a schedule.');
  }
  // The roster is the count of record: `confirmedCount` is only set when a roster is loaded, so a unit
  // added or removed since then makes it stale.
  const unitCount = rosterKeys(current.players).length;
  const format = getGameFormat(form.gameFormat);
  if (!format) return refuse('This game format is not available yet.');
  if (!rosterFitsFormat(current, form.gameFormat)) {
    return refuse(
      'The roster was loaded for a different game format — click "Load roster & reserves" again before generating.',
    );
  }
  // An upper and lower bracket or a layered bracket is generated as a Custom bracket over a graph the app derives; the
  // choice is kept in the form (and so in the settings snapshot) and on the config (`upperLowerVersion`,
  // `layeredVersion`), never in `state.scheduleLogic`.
  const chosen = form.scheduleLogic;
  const schedule = chosen === 'upper-lower' || chosen === 'layered' ? 'waterfall-bracket' : chosen;
  if (!format.defaultRoomSize && !format.idealRoomSize) {
    return refuse('This game format has no room size.');
  }
  const formatRoomSize = deriveRoomSize(format);
  const floorMin = getMinimumBracketUnits(chosen, formatRoomSize);
  const unitPlural = format.unitLabelPlural.toLowerCase();
  const belowFloor = registeredBelowFloorMessage(chosen, formatRoomSize, unitPlural, unitCount);
  if (belowFloor) return refuse(belowFloor);
  const layeredGate = chosen === 'layered' ? layeredGateRefusal(form) : null;
  if (layeredGate) return refuse(layeredGate);

  return {
    ok: true,
    plan: { unitCount, format, chosen, schedule, formatRoomSize, floorMin, unitPlural },
  };
}

/** The settings of the pooling phase (`config`) and the match formats, with the Swiss and group-stage checks. */
function planPoolingSettings(form: GenerationForm, plan: PlanAfterRoster): Planned<PlanAfterPoolingSettings> {
  const { unitCount, format, chosen, schedule, unitPlural } = plan;

  // A setting whose Setup field is hidden is ignored: the form keeps its stale
  // value (so switching back restores it) but generation uses the default.
  const scoringVisible = form.poolingPhase !== 'none';
  const drawPublicationVisible = form.poolingPhase === 'qual-table' || form.poolingPhase === 'swiss';
  const matchConfig = matchFormatConfig(form, chosen);
  const settings = groupSettingsOf(form);
  const config: GenerationConfig = {
    n: unitCount,
    poolingPhase: form.poolingPhase,
    qualAdv: unitCount, // placeholder; validated/overwritten below when poolingPhase !== 'none'
    groupSize: settings.groupSize,
    roundRobinMode: form.roundRobinMode,
    qualifiersPerGroup: settings.qualifiersPerGroup,
    ...(form.poolingPhase === 'group-stage' && form.groupExit && form.groupExit !== 'per-group'
      ? { groupExit: form.groupExit }
      : {}),
    scoring: scoringVisible ? form.scoring || 'fairpoints' : 'fairpoints',
    drawPublication: drawPublicationVisible ? form.drawPublication || 'adaptive' : 'adaptive',
    finalsGames: matchConfig.finalsGames,
    semisGames: matchConfig.semisGames,
    // Hidden along with their selects: the Final of a race double elimination has its own win targets, only single elimination has a Semis format.
    finalsBestOf: matchConfig.finalsBestOf,
    semisBestOf: matchConfig.semisBestOf,
  };
  if (config.poolingPhase === 'swiss' && format.idealRoomSize !== 2) {
    return refuse(
      `Swiss isn't available for ${format.label} — Swiss pairing only works for head-to-head formats (exactly 2 units per room), not ${unitPlural} sharing a room.`,
    );
  }
  if (config.poolingPhase === 'group-stage') {
    if (format.idealRoomSize !== 2) {
      return refuse(
        `Group Stage isn't available for ${format.label} — round-robin scheduling only works for head-to-head formats (exactly 2 units per room), not ${unitPlural} sharing a room.`,
      );
    }
    if (config.groupSize < GROUP_SIZE_BOUNDS.min) {
      return refuse(
        `Group size must be at least ${GROUP_SIZE_BOUNDS.min} — round-robin below that is degenerate. Got ${config.groupSize}.`,
      );
    }
    if (config.groupSize > GROUP_SIZE_BOUNDS.max) {
      return refuse(
        `Group size can't exceed ${GROUP_SIZE_BOUNDS.max} — round-robin above that produces too many rounds. Got ${config.groupSize}.`,
      );
    }
    // A Groups line decides how many go through, so the form's qualifiers per group wait for it (below).
    if (config.groupExit === undefined && schedule !== 'waterfall-bracket') {
      const refusal = groupExitRefusal(
        config.n,
        config.groupSize,
        'per-group',
        config.qualifiersPerGroup,
        unitPlural,
      );
      if (refusal) return refuse(refusal);
    }
  }

  return { ok: true, plan: { ...plan, matchConfig, config } };
}

/** The round counts of a qualification table and a Swiss, and the leading rounds that don't count. */
function planPoolingRounds(
  form: GenerationForm,
  plan: PlanAfterBracketShape,
): Planned<PlanAfterPoolingRounds> {
  const { config } = plan;

  // Total pooling-phase round count for Qualification Table / Swiss --
  // normally derived (a fixed constant / a function of entrant count), but
  // each is independently overridable pre-start.
  let qualRounds = QUALIFICATION_ROUNDS;
  if (config.poolingPhase === 'qual-table') {
    const resolved = resolvePoolingRoundsOverride(form.qualRoundsOverride, qualRounds, 'Qualification Table');
    if (!resolved.ok) return refuse(resolved.error);
    qualRounds = resolved.value;
  }
  let swissRounds = computeSwissRoundCount(config.n);
  if (config.poolingPhase === 'swiss') {
    const resolved = resolvePoolingRoundsOverride(form.swissRoundsOverride, swissRounds, 'Swiss');
    if (!resolved.ok) return refuse(resolved.error);
    swissRounds = resolved.value;
  }

  // "Non-counting" leading rounds are only meaningful where a cumulative
  // standings table exists at all -- Qualification Table and Swiss (they
  // share computeQualificationStandings). Group Stage has its own separate
  // per-group standings/qualification mechanism and was deliberately left
  // out of this feature's scope.
  let nonCountingRounds = 0;
  if (config.poolingPhase === 'qual-table' || config.poolingPhase === 'swiss') {
    const rawNonCountingRounds = Number.parseInt(form.nonCountingRounds || '0', 10);
    if (!Number.isFinite(rawNonCountingRounds) || rawNonCountingRounds < 0) {
      return refuse(
        `Non-counting rounds must be a non-negative whole number — got "${form.nonCountingRounds}".`,
      );
    }
    const totalPoolingRounds = config.poolingPhase === 'qual-table' ? qualRounds : swissRounds;
    if (rawNonCountingRounds >= totalPoolingRounds) {
      const phaseName = config.poolingPhase === 'qual-table' ? 'Qualification Table' : 'Swiss';
      return refuse(
        `Non-counting rounds (${rawNonCountingRounds}) must leave at least one round that counts — this ${phaseName} phase has ${totalPoolingRounds} round${totalPoolingRounds === 1 ? '' : 's'} total.`,
      );
    }
    nonCountingRounds = rawNonCountingRounds;
  }

  return { ok: true, plan: { ...plan, qualRounds, swissRounds, nonCountingRounds } };
}

/** Everything a tournament is worked out as before a round is built, or why it can't be. No side effect. */
export function planTournament(form: GenerationForm, current: TournamentState): Planned<TournamentPlan> {
  const roster = planRoster(form, current);
  if (!roster.ok) return roster;
  const pooling = planPoolingSettings(form, roster.plan);
  if (!pooling.ok) return pooling;
  const shape = planBracketShape(form, pooling.plan);
  if (!shape.ok) return shape;
  const poolingRounds = planPoolingRounds(form, shape.plan);
  if (!poolingRounds.ok) return poolingRounds;
  const entry = planBracketEntry(poolingRounds.plan);
  if (!entry.ok) return entry;
  const scoring = planScoring(form, entry.plan);
  if (!scoring.ok) return scoring;
  const gates = checkFormatGates(scoring.plan);
  if (!gates.ok) return gates;
  const sizes = planSizeOverrides(form, gates.plan);
  if (!sizes.ok) return sizes;
  const finals = planFinalTargets(form, sizes.plan);
  if (!finals.ok) return finals;
  const eliminations = planEliminationOverrides(form, finals.plan);
  if (!eliminations.ok) return eliminations;
  return planStoredSettings(form, eliminations.plan);
}
