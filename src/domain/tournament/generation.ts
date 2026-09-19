import { getGameFormat, deriveRoomSize } from './formats';
import {
  GROUP_SIZE_BOUNDS,
  QUALIFICATION_ROUNDS,
  computeSwissRoundCount,
  seedFromGroupStageRound,
} from './pooling';
import { distributeRooms, validateRoomCap } from './room-distribution';
import { rosterKeys } from './roster';
import { randomSeed, recordRoomHistory } from './seeding';
import {
  buildTournamentProgression,
  getMinimumBracketUnits,
  type TournamentProgressionInput,
} from './schedule-generation';
import type { TournamentRuntime } from './runtime';
import type {
  GeneratedTournamentConfig,
  MaterializedGamemodeConfig,
  PersistedSetup,
  TournamentState,
} from './types';

interface GenerationForm extends PersistedSetup {
  /** Intentionally omitted from PersistedSetup for legacy compatibility. */
  lbQualifiers?: string;
}

type GenerateTournamentResult =
  { status: 'generated'; state: TournamentState } | { status: 'invalid'; message: string };

function parsed(value: string, fallback: number): number {
  return Number.parseInt(value, 10) || fallback;
}

function generationError(message: string): GenerateTournamentResult {
  return { status: 'invalid', message };
}

/** Sanity ceiling for a manually-overridden pooling-phase round count, matching single-elimination.ts's own MAX_ELIMINATION_ROUNDS-style cap. */
const MAX_POOLING_ROUNDS_OVERRIDE = 12;

function resolvePoolingRoundsOverride(
  raw: string,
  defaultValue: number,
  label: string,
): { ok: true; value: number } | { ok: false; error: string } {
  if (!raw) return { ok: true, value: defaultValue };
  const parsedValue = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 1 || parsedValue > MAX_POOLING_ROUNDS_OVERRIDE) {
    return {
      ok: false,
      error: `${label} round count override must be a whole number from 1 to ${MAX_POOLING_ROUNDS_OVERRIDE} — got "${raw}".`,
    };
  }
  return { ok: true, value: parsedValue };
}

export function generateTournament(
  current: TournamentState,
  form: GenerationForm,
  runtime: TournamentRuntime,
): GenerateTournamentResult {
  if (current.confirmedCount === null || current.confirmedCount === undefined) {
    return generationError(
      'Load a roster first — click "Load roster & reserves" before generating a schedule.',
    );
  }
  const format = getGameFormat(form.gameFormat);
  if (!format) return generationError('This game format is not available yet.');
  const schedule = form.scheduleLogic;
  const floorIdeal = format.defaultRoomSize?.ideal ?? format.idealRoomSize;
  if (!floorIdeal) return generationError('This game format has no room size.');
  const floorMin = getMinimumBracketUnits(schedule, {
    min: floorIdeal,
    max: floorIdeal,
    ideal: floorIdeal,
  });
  const unitPlural = format.unitLabelPlural.toLowerCase();
  if (current.confirmedCount < floorMin) {
    const reason =
      schedule === 'single-elimination'
        ? ` (Semis is fixed at ${floorMin} ${unitPlural} in 2 rooms of ${floorIdeal})`
        : '';
    return generationError(
      `This format needs at least ${floorMin} confirmed ${unitPlural}${reason}. Confirmed: ${current.confirmedCount}.`,
    );
  }

  const config: GeneratedTournamentConfig = {
    n: current.confirmedCount,
    poolingPhase: form.poolingPhase,
    qualAdv: current.confirmedCount, // placeholder; validated/overwritten below when poolingPhase !== 'none'
    groupSize: parsed(form.groupSize, GROUP_SIZE_BOUNDS.ideal),
    roundRobinMode: form.roundRobinMode,
    qualifiersPerGroup: parsed(form.qualifiersPerGroup, 2),
    scoring: 'fairpoints',
    finalsGames: parsed(form.finalsGames, 3),
    semisGames: parsed(form.semisGames, 1),
  };
  if (config.poolingPhase === 'swiss' && format.idealRoomSize !== 2) {
    return generationError(
      `Swiss isn't available for ${format.label} — fold-pairing only works for head-to-head formats (exactly 2 units per room), not ${unitPlural} sharing a room.`,
    );
  }
  if (config.poolingPhase === 'group-stage') {
    if (format.idealRoomSize !== 2) {
      return generationError(
        `Group Stage isn't available for ${format.label} — round-robin scheduling only works for head-to-head formats (exactly 2 units per room), not ${unitPlural} sharing a room.`,
      );
    }
    if (config.groupSize < GROUP_SIZE_BOUNDS.min) {
      return generationError(
        `Group size must be at least ${GROUP_SIZE_BOUNDS.min} — round-robin below that is degenerate. Got ${config.groupSize}.`,
      );
    }
    if (config.groupSize > GROUP_SIZE_BOUNDS.max) {
      return generationError(
        `Group size can't exceed ${GROUP_SIZE_BOUNDS.max} — round-robin above that produces too many rounds. Got ${config.groupSize}.`,
      );
    }
    if (config.qualifiersPerGroup < 1) {
      return generationError(
        `Qualifiers per group must be a positive number — got ${config.qualifiersPerGroup}.`,
      );
    }
    if (config.groupSize <= config.qualifiersPerGroup) {
      return generationError(
        `Group size (${config.groupSize}) must be greater than qualifiers per group (${config.qualifiersPerGroup}) — a group can't qualify more finishers than it contains.`,
      );
    }
  }
  if (config.poolingPhase !== 'none') {
    const rawQualAdv = Number.parseInt(form.qualAdv, 10);
    if (!Number.isFinite(rawQualAdv) || rawQualAdv < 1) {
      return generationError(`Advance to bracket must be a positive whole number — got "${form.qualAdv}".`);
    }
    config.qualAdv = Math.min(Math.max(rawQualAdv, floorMin), config.n);
  }

  // Total pooling-phase round count for Qualification Table / Swiss --
  // normally derived (a fixed constant / a function of entrant count), but
  // each is independently overridable pre-start (ROADMAP.md item 4).
  let qualRounds = QUALIFICATION_ROUNDS;
  if (config.poolingPhase === 'qual-table') {
    const resolved = resolvePoolingRoundsOverride(form.qualRoundsOverride, qualRounds, 'Qualification Table');
    if (!resolved.ok) return generationError(resolved.error);
    qualRounds = resolved.value;
  }
  let swissRounds = computeSwissRoundCount(config.n);
  if (config.poolingPhase === 'swiss') {
    const resolved = resolvePoolingRoundsOverride(form.swissRoundsOverride, swissRounds, 'Swiss');
    if (!resolved.ok) return generationError(resolved.error);
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
      return generationError(
        `Non-counting rounds must be a non-negative whole number — got "${form.nonCountingRounds}".`,
      );
    }
    const totalPoolingRounds = config.poolingPhase === 'qual-table' ? qualRounds : swissRounds;
    if (rawNonCountingRounds >= totalPoolingRounds) {
      const phaseName = config.poolingPhase === 'qual-table' ? 'Qualification Table' : 'Swiss';
      return generationError(
        `Non-counting rounds (${rawNonCountingRounds}) must leave at least one round that counts — this ${phaseName} phase has ${totalPoolingRounds} round${totalPoolingRounds === 1 ? '' : 's'} total.`,
      );
    }
    nonCountingRounds = rawNonCountingRounds;
  }

  // The number of units that will actually enter the bracket phase.
  // Group Stage derives this independently -- groups × qualifiers per group,
  // ignoring config.qualAdv entirely -- matching groupStagePoolingPhase's
  // own seedTotal formula exactly; every other pooling phase uses
  // config.qualAdv (already clamped above) or the raw confirmed count for
  // 'none'. Every validation below that needs the real entrant count (not
  // just the raw registration count) should use this, not config.qualAdv
  // directly -- config.qualAdv is meaningless for Group Stage.
  const bracketEntryCount =
    config.poolingPhase === 'group-stage'
      ? distributeRooms(config.n, {
          min: GROUP_SIZE_BOUNDS.min,
          max: GROUP_SIZE_BOUNDS.max,
          ideal: config.groupSize,
        }).length * config.qualifiersPerGroup
      : config.poolingPhase !== 'none'
        ? config.qualAdv
        : config.n;

  const oddCountStrategy = format.supportedOddCountStrategies?.length
    ? form.oddCountStrategy || undefined
    : undefined;
  const roomSize = deriveRoomSize(format, oddCountStrategy);
  // Defense-in-depth: the Setup UI only ever offers 'double-elimination' as
  // an option when the format/odd-count-strategy combination is compatible,
  // but a stale selection can survive an odd-count-strategy change made
  // after schedule logic was picked (the option disappears from the
  // dropdown without resetting the already-selected value). Catch it here
  // with a clear message instead of the raw exception this would otherwise
  // hit two calls deep inside doubleEliminationBracketPhase.
  if (schedule === 'double-elimination') {
    if (format.idealRoomSize !== 2) {
      return generationError(
        `Double elimination isn't available for ${format.label} — it requires a head-to-head room shape (exactly 2 units per room). Pick "Double elimination — FFA/Team" instead.`,
      );
    }
    if (oddCountStrategy === 'flex') {
      return generationError(
        `Double elimination doesn't support the "Flex" odd-count strategy — a 3-unit room isn't double elimination. Pick "None" or "Bye" instead, or switch to "Double elimination — FFA/Team".`,
      );
    }
  }
  if (format.supportedOddCountStrategies && oddCountStrategy === 'none') {
    const ideal = format.idealRoomSize as number;
    if (config.poolingPhase !== 'none' && config.poolingPhase !== 'group-stage' && config.n % ideal !== 0) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      return generationError(
        `With "None" selected as the odd-count strategy, the confirmed ${unitPlural} must be an exact multiple of ${ideal} (this format's room size) so the pooling phase itself can pair everyone cleanly — got ${config.n}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
    const eliminationEntryCount = bracketEntryCount;
    const isMultiple = eliminationEntryCount % ideal === 0;
    const isPowerOfTwo =
      eliminationEntryCount > 0 && (eliminationEntryCount & (eliminationEntryCount - 1)) === 0;
    const needsPowerOfTwo = schedule === 'double-elimination';
    if (!(needsPowerOfTwo ? isMultiple && isPowerOfTwo : isMultiple)) {
      const alternatives = format.supportedOddCountStrategies
        .filter((strategy) => strategy !== 'none')
        .map((strategy) => strategy.charAt(0).toUpperCase() + strategy.slice(1))
        .join('/');
      const requirement = needsPowerOfTwo
        ? 'must be an exact power of 2 (double elimination halves the field every round)'
        : `must be an exact multiple of ${ideal} (this format's room size)`;
      return generationError(
        `With "None" selected as the odd-count strategy, the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `confirmed ${unitPlural}`} ${requirement} — got ${eliminationEntryCount}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
  }

  const semisOverride = schedule === 'single-elimination' ? parsed(form.semisOverride, 0) || null : null;
  const finalOverride =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final'
      ? parsed(form.finalOverride, 0) || null
      : null;
  // parsed()'s `|| fallback` only replaces a falsy (zero/NaN) parse result --
  // a negative value like "-5" parses successfully and stays truthy, so it
  // slips straight through. Reject explicitly rather than let a negative
  // override reach distributeRooms() (which returns [] for a non-positive
  // count) and divide-by-zero into Infinity/NaN baked silently into round data.
  if (semisOverride !== null && semisOverride < 1) {
    return generationError(`Semis size override must be a positive number — got ${semisOverride}.`);
  }
  if (finalOverride !== null && finalOverride < 1) {
    return generationError(`Final size override must be a positive number — got ${finalOverride}.`);
  }
  const overrideEntryCount = bracketEntryCount;
  if (semisOverride && finalOverride && finalOverride > semisOverride) {
    return generationError(
      `Final size override (${finalOverride}) can't exceed the Semis size override (${semisOverride}) — there can't be more finalists than Semis participants.`,
    );
  }
  if (semisOverride && semisOverride > overrideEntryCount) {
    return generationError(
      `Semis size override (${semisOverride}) can't exceed the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket (' : 'confirmed count ('}${overrideEntryCount}) — there'd be nothing left to eliminate down to it.`,
    );
  }
  // finalOverride was previously only checked AGAINST semisOverride when the
  // latter was also set -- an oversized finalOverride alone (no semisOverride)
  // slipped through unchecked. Compare against the derived default Semis size
  // instead in that case.
  if (schedule === 'single-elimination' && finalOverride && !semisOverride) {
    const defaultSemisSize = 2 * roomSize.ideal;
    if (finalOverride > defaultSemisSize) {
      return generationError(
        `Final size override (${finalOverride}) can't exceed the default Semis size (${defaultSemisSize}, 2 rooms of ${roomSize.ideal}) — there'd be nothing left to eliminate down to it. Set a Semis size override too if you want a larger Semis.`,
      );
    }
  }

  // Defense-in-depth: bracketEntryCount already reflects the real post-pooling
  // entrant count (including Group Stage's independent groups×qualifiers
  // formula), so this catches e.g. Group Stage + Double Elimination with too
  // few qualifiers reaching the bracket -- previously only caught two calls
  // deep inside raceDoubleEliminationBracketPhase's own "at least 2
  // winners-bracket rounds" throw, via the generic catch-all below.
  if (schedule === 'double-elimination') {
    const doubleElimFloor = getMinimumBracketUnits(schedule, roomSize);
    if (bracketEntryCount < doubleElimFloor) {
      const adjustHint =
        config.poolingPhase === 'group-stage'
          ? 'Increase the group count or qualifiers per group.'
          : config.poolingPhase !== 'none'
            ? 'Increase "Advance to bracket."'
            : `Add more confirmed ${unitPlural}.`;
      return generationError(
        `Can't build a double-elimination bracket — only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase (needs at least ${doubleElimFloor}). ${adjustHint}`,
      );
    }
  }
  // Only meaningful for the race variant's grand-final (computeGrandFinalRaceState
  // only activates for a bracket:'grand-final' round, which only
  // raceDoubleEliminationBracketPhase ever produces) -- scoped to schedule
  // here to match, so a stale value left over from a different schedule
  // logic never blocks an otherwise-unrelated generation.
  const grandFinalWbTarget = parsed(form.grandFinalWbTarget, 2);
  const grandFinalLbTarget = parsed(form.grandFinalLbTarget, 3);
  if (schedule === 'double-elimination' && (grandFinalWbTarget < 1 || grandFinalLbTarget < 1)) {
    return generationError(
      `Grand Final win targets must be positive — got WB ${grandFinalWbTarget}, LB ${grandFinalLbTarget}.`,
    );
  }
  const prospectiveFinalSize = finalOverride || roomSize.ideal;
  let lbQualifiers: number | undefined;
  let winnersQualifiers: number | undefined;
  if (schedule === 'double-elimination-shared-final') {
    lbQualifiers = parsed(form.lbQualifiers ?? '2', 0);
    if (!(lbQualifiers >= 1) || !(lbQualifiers < prospectiveFinalSize)) {
      return generationError(
        `LB qualifiers into the Final (${lbQualifiers}) must be at least 1 and less than the Final size (${prospectiveFinalSize}).`,
      );
    }
    // The winners-bracket side of the Final also needs to be reachable --
    // it can't ask for more WB qualifiers than actually entered the bracket
    // phase. Previously only caught two calls deep inside
    // sharedFinalDoubleEliminationBracketPhase's own "requestedRounds < 1"
    // throw, via the generic catch-all below.
    winnersQualifiers = prospectiveFinalSize - lbQualifiers;
    if (winnersQualifiers >= bracketEntryCount) {
      return generationError(
        `Final size override (${prospectiveFinalSize}) needs ${winnersQualifiers} winners-bracket qualifiers, but only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase — there wouldn't be enough winners-bracket rounds to produce them. Lower the Final size override, raise LB qualifiers, or increase how many ${unitPlural} advance into the bracket.`,
      );
    }
  }

  // Elimination round-target override: an ordered list of exact survivor
  // counts, replacing the automatic geometric-decay curve entirely for the
  // WB elimination rounds leading into Semis (single-elimination) / the
  // shared Final (double-elimination-shared-final). Its own length is the
  // round-count override for these two formats -- no separate field needed.
  let explicitTargets: number[] | undefined;
  if (
    form.eliminationRoundTargets.trim() &&
    (schedule === 'single-elimination' || schedule === 'double-elimination-shared-final')
  ) {
    const parts = form.eliminationRoundTargets.split(',').map((part) => part.trim());
    const values = parts.map((part) => Number.parseInt(part, 10));
    const isValidInteger = (value: number, part: string) =>
      Number.isFinite(value) && value >= 1 && String(value) === part;
    if (values.some((value, index) => !isValidInteger(value, parts[index]))) {
      return generationError(
        `Elimination round targets must be a comma-separated list of positive whole numbers — got "${form.eliminationRoundTargets}".`,
      );
    }
    for (let index = 1; index < values.length; index += 1) {
      if (values[index] > values[index - 1]) {
        return generationError(
          `Elimination round targets must not increase from round to round — got ${values.join(',')}.`,
        );
      }
    }
    if (values[0] > bracketEntryCount) {
      return generationError(
        `The first elimination round target (${values[0]}) can't exceed the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `confirmed ${unitPlural}`} (${bracketEntryCount}).`,
      );
    }
    const floor =
      schedule === 'single-elimination' ? semisOverride || 2 * roomSize.ideal : (winnersQualifiers as number);
    const lastTarget = values[values.length - 1];
    if (lastTarget < floor) {
      const floorLabel =
        schedule === 'single-elimination'
          ? 'the Semis size'
          : 'the winners-bracket qualifiers into the Final';
      return generationError(
        `The last elimination round target (${lastTarget}) must be at least ${floor} (${floorLabel}) — there'd be nothing left to feed the next phase.`,
      );
    }
    explicitTargets = values;
  }

  // Elimination seeding-weight override: an ordered list of fixed reseed
  // modes, index-aligned with eliminationRoundTargets -- only meaningful
  // once that list pins down which round is which, since round identity
  // doesn't exist before generation otherwise.
  let explicitSeedingOverrides: Array<'diversity' | 'balance' | 'random' | undefined> | undefined;
  if (form.eliminationSeedingOverrides.trim()) {
    if (!explicitTargets) {
      return generationError(
        'Elimination seeding overrides require elimination round targets to also be set — seeding-override positions are addressed by that same ordered round list.',
      );
    }
    const parts = form.eliminationSeedingOverrides.split(',').map((part) => part.trim());
    if (parts.length !== explicitTargets.length) {
      return generationError(
        `Elimination seeding overrides (${parts.length} entries) must have exactly as many entries as elimination round targets (${explicitTargets.length}) — leave an entry blank to keep that round's reseed automatic.`,
      );
    }
    const validModes = new Set(['', 'diversity', 'balance', 'random']);
    if (parts.some((part) => !validModes.has(part))) {
      return generationError(
        `Each elimination seeding override must be blank (automatic), "diversity", "balance", or "random" — got "${form.eliminationSeedingOverrides}".`,
      );
    }
    explicitSeedingOverrides = parts.map((part) =>
      part === '' ? undefined : (part as 'diversity' | 'balance' | 'random'),
    );
  }

  const gamemodeConfig: MaterializedGamemodeConfig = {
    qualRounds,
    swissRounds,
    nonCountingRounds,
    teamScoringRule: format.teamSize ? form.teamScoringRule || 'sum-members' : 'sum-members',
    ...(oddCountStrategy ? { oddCountStrategy } : {}),
    roomSize,
    semisSize: semisOverride || 2 * roomSize.ideal,
    finalSize: finalOverride || roomSize.ideal,
    ...(lbQualifiers !== undefined ? { lbQualifiers } : {}),
    ...(explicitTargets !== undefined ? { explicitTargets } : {}),
    ...(explicitSeedingOverrides !== undefined ? { explicitSeedingOverrides } : {}),
    poolingPhase: config.poolingPhase,
    bracketPhase: schedule,
    finalsGames: config.finalsGames,
    semisGames: config.semisGames,
    grandFinalWbTarget,
    grandFinalLbTarget,
    groupSize: config.groupSize,
    roundRobinMode: config.roundRobinMode,
    qualifiersPerGroup: config.qualifiersPerGroup,
  };
  const roster = rosterKeys(current.players);
  let progression;
  try {
    progression = buildTournamentProgression({
      bracketPhase: schedule,
      poolingPhase: config.poolingPhase,
      config,
      format: gamemodeConfig,
      roster,
    } as TournamentProgressionInput);
  } catch (error) {
    return generationError(error instanceof Error ? error.message : String(error));
  }
  const roomCapError = validateRoomCap(progression.rounds, format);
  if (roomCapError) return generationError(roomCapError);

  const groups = progression.groups;
  const groupStandings = Object.fromEntries(
    groups.map((group) => [
      group.label,
      group.members.map((name) => ({
        name,
        totalFP: null,
        totalScore: 0,
        played: 0,
      })),
    ]),
  );
  const state: TournamentState = {
    ...current,
    rounds: progression.rounds,
    curRound: 0,
    scores: {},
    finalScores: {},
    assignments: [],
    luckyLosers: progression.rounds.map(() => []),
    byes: progression.rounds.map(() => []),
    poolingByeCounts: {},
    roomHistory: {},
    pendingBracketSeeds: {},
    qualTable: roster.map((name) => ({
      name,
      totalFP: null,
      totalScore: 0,
      played: 0,
    })),
    groups,
    groupStandings,
    tieResolutions: {},
    defenderChanges: {},
    reserveOpen: true,
    started: false,
    needsSave: false,
    autoSaved: false,
    tournamentId: runtime.ids.tournamentId(),
    cfg: config,
    scheduleLogic: schedule,
    gameFormat: form.gameFormat,
    gamemodeConfig,
  };
  const initialPool = rosterKeys(state.players);
  if (config.poolingPhase === 'group-stage') {
    state.assignments[0] = seedFromGroupStageRound(state.rounds[0]);
    state.byes[0] = [...(state.rounds[0].groupByes ?? [])];
  } else if (gamemodeConfig.oddCountStrategy === 'bye' && initialPool.length % roomSize.ideal !== 0) {
    const firstBye = initialPool[0];
    state.byes[0] = [firstBye];
    state.poolingByeCounts[firstBye] = 1;
    state.assignments[0] = randomSeed(initialPool.slice(1), state.rounds[0].rooms, runtime.random);
    state.assignments[0].push({
      name: firstBye,
      room: null,
      isLucky: false,
    });
  } else {
    state.assignments[0] = randomSeed(initialPool, state.rounds[0].rooms, runtime.random);
  }
  state.roomHistory = recordRoomHistory(state.roomHistory, state.assignments[0], 0);
  return { status: 'generated', state };
}
