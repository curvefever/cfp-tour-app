import { parseEliminationTargets } from './elimination-targets';
import { wholeNumber } from './round-match-formats';
import { getMinimumBracketUnits } from './schedule-generation';
import { defaultSemisSize } from './single-elimination';
import {
  type GenerationForm,
  type PlanAfterEliminationOverrides,
  type PlanAfterFinalTargets,
  type PlanAfterScoring,
  type PlanAfterSizeOverrides,
  type Planned,
  refuse,
} from './generation-plan-types';

/** The Semis and Final size overrides with the default Semis size, and the field a double elimination needs. */
export function planSizeOverrides(
  form: GenerationForm,
  plan: PlanAfterScoring,
): Planned<PlanAfterSizeOverrides> {
  const { schedule, config, roomSize, bracketEntryCount, floorMin, unitPlural } = plan;

  const semisOverride = schedule === 'single-elimination' ? wholeNumber(form.semisOverride, 0) || null : null;
  const finalOverride =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final'
      ? wholeNumber(form.finalOverride, 0) || null
      : null;
  // wholeNumber()'s `|| fallback` only replaces a falsy (zero/NaN) parse result --
  // a negative value like "-5" parses successfully and stays truthy, so it
  // slips straight through. Reject explicitly rather than let a negative
  // override reach distributeRooms() (which returns [] for a non-positive
  // count) and divide-by-zero into Infinity/NaN baked silently into round data.
  if (semisOverride !== null && semisOverride < 1) {
    return refuse(`Semis size override must be a positive number — got ${semisOverride}.`);
  }
  if (finalOverride !== null && finalOverride < 1) {
    return refuse(`Final size override must be a positive number — got ${finalOverride}.`);
  }
  const overrideEntryCount = bracketEntryCount;
  const semisDefault =
    schedule === 'single-elimination' ? defaultSemisSize(roomSize, bracketEntryCount) : 2 * roomSize.ideal;
  if (
    schedule === 'single-elimination' &&
    config.poolingPhase === 'group-stage' &&
    bracketEntryCount < floorMin
  ) {
    return refuse(
      `Group stage sends ${bracketEntryCount} ${unitPlural} to the bracket; single elimination needs at least ${floorMin} (Semis needs 2 rooms of at least ${roomSize.min}). Increase the group count or qualifiers per group.`,
    );
  }
  if (semisOverride && finalOverride && finalOverride > semisOverride) {
    return refuse(
      `Final size override (${finalOverride}) can't exceed the Semis size override (${semisOverride}) — there can't be more finalists than Semis participants.`,
    );
  }
  if (semisOverride && semisOverride > overrideEntryCount) {
    return refuse(
      `Semis size override (${semisOverride}) can't exceed the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket (' : 'registered count ('}${overrideEntryCount}) — there'd be nothing left to eliminate down to it.`,
    );
  }
  // An oversized finalOverride is checked against semisOverride when that is set;
  // with no semisOverride it is checked against the derived default Semis size.
  if (schedule === 'single-elimination' && finalOverride && !semisOverride) {
    if (finalOverride > semisDefault) {
      return refuse(
        `Final size override (${finalOverride}) can't exceed the default Semis size (${semisDefault}) — there'd be nothing left to eliminate down to it. Set a Semis size override too if you want a larger Semis.`,
      );
    }
  }

  // Defense-in-depth: bracketEntryCount already reflects the real post-pooling
  // entrant count (including Group Stage's independent groups×qualifiers
  // formula), so this catches e.g. Group Stage + Double Elimination with too
  // few qualifiers reaching the bracket. It is checked here so the organiser
  // gets a clear message, not the "at least 2 winners-bracket rounds" throw of
  // raceDoubleEliminationBracketPhase through the generic catch-all below.
  if (schedule === 'double-elimination') {
    const doubleElimFloor = getMinimumBracketUnits(schedule, roomSize);
    if (bracketEntryCount < doubleElimFloor) {
      const adjustHint =
        config.poolingPhase === 'group-stage'
          ? 'Increase the group count or qualifiers per group.'
          : config.poolingPhase !== 'none'
            ? 'Increase "Advance to bracket."'
            : `Add more registered ${unitPlural}.`;
      return refuse(
        `Can't build a double-elimination bracket — only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase (needs at least ${doubleElimFloor}). ${adjustHint}`,
      );
    }
  }

  return { ok: true, plan: { ...plan, semisOverride, finalOverride, semisDefault } };
}

/** The Grand Final's win targets, and how the shared Final's seats are split between the two brackets. */
export function planFinalTargets(
  form: GenerationForm,
  plan: PlanAfterSizeOverrides,
): Planned<PlanAfterFinalTargets> {
  const { schedule, roomSize, bracketEntryCount, finalOverride, unitPlural } = plan;

  // Only meaningful for the race variant's grand-final (computeGrandFinalRaceState
  // only activates for a bracket:'grand-final' round, which only
  // raceDoubleEliminationBracketPhase ever produces) -- scoped to schedule
  // here to match, so a stale value left over from a different schedule
  // logic never blocks an otherwise-unrelated generation.
  const grandFinalWbTarget = wholeNumber(form.grandFinalWbTarget, 2);
  const grandFinalLbTarget = wholeNumber(form.grandFinalLbTarget, 3);
  if (schedule === 'double-elimination' && (grandFinalWbTarget < 1 || grandFinalLbTarget < 1)) {
    return refuse(
      `Grand Final win targets must be positive — got WB ${grandFinalWbTarget}, LB ${grandFinalLbTarget}.`,
    );
  }
  const prospectiveFinalSize = finalOverride || roomSize.ideal;
  let lbQualifiers: number | undefined;
  let winnersQualifiers: number | undefined;
  if (schedule === 'double-elimination-shared-final') {
    lbQualifiers = wholeNumber(form.lbQualifiers ?? '2', 0);
    if (!(lbQualifiers >= 1) || !(lbQualifiers < prospectiveFinalSize)) {
      return refuse(
        `LB qualifiers into the Final (${lbQualifiers}) must be at least 1 and less than the Final size (${prospectiveFinalSize}).`,
      );
    }
    // The winners-bracket side of the Final also needs to be reachable --
    // it can't ask for more WB qualifiers than actually entered the bracket
    // phase. It is checked here so the organiser gets a clear message, not the
    // "requestedRounds < 1" throw of sharedFinalDoubleEliminationBracketPhase
    // through the generic catch-all below.
    winnersQualifiers = prospectiveFinalSize - lbQualifiers;
    if (winnersQualifiers >= bracketEntryCount) {
      return refuse(
        `Final size override (${prospectiveFinalSize}) needs ${winnersQualifiers} winners-bracket qualifiers, but only ${bracketEntryCount} ${unitPlural} would actually enter the bracket phase — there wouldn't be enough winners-bracket rounds to produce them. Lower the Final size override, raise LB qualifiers, or increase how many ${unitPlural} advance into the bracket.`,
      );
    }
  }

  return {
    ok: true,
    plan: {
      ...plan,
      grandFinalWbTarget,
      grandFinalLbTarget,
      prospectiveFinalSize,
      lbQualifiers,
      winnersQualifiers,
    },
  };
}

/** The typed survivor counts of the elimination rounds, and the reseed mode of each. */
export function planEliminationOverrides(
  form: GenerationForm,
  plan: PlanAfterFinalTargets,
): Planned<PlanAfterEliminationOverrides> {
  const { schedule, config, bracketEntryCount, unitPlural, semisOverride, semisDefault } = plan;
  const { winnersQualifiers, prospectiveFinalSize, lbQualifiers } = plan;

  // Elimination round-target override: an ordered list of exact survivor
  // counts, replacing the automatic geometric-decay curve entirely for the
  // WB elimination rounds leading into Semis (single-elimination) / the
  // shared Final (double-elimination-shared-final). Its own length is the
  // round-count override for these two formats -- no separate field needed.
  const usesEliminationTargetOverrides =
    schedule === 'single-elimination' || schedule === 'double-elimination-shared-final';
  const parsedTargets = parseEliminationTargets(form.eliminationRoundTargets, {
    schedule,
    bracketEntryCount,
    entryLabel:
      config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `registered ${unitPlural}`,
    semisSize: semisOverride || semisDefault,
    winnersQualifiers: winnersQualifiers ?? 0,
    finalSize: prospectiveFinalSize,
    lbQualifiers: lbQualifiers ?? 0,
  });
  if (!parsedTargets.ok) return refuse(parsedTargets.error);
  const explicitTargets = parsedTargets.values;

  // Elimination seeding-weight override: an ordered list of fixed reseed
  // modes, index-aligned with eliminationRoundTargets -- only meaningful
  // once that list pins down which round is which, since round identity
  // doesn't exist before generation otherwise.
  let explicitSeedingOverrides: Array<'diversity' | 'balance' | 'random' | undefined> | undefined;
  if (form.eliminationSeedingOverrides.trim() && usesEliminationTargetOverrides) {
    if (!explicitTargets) {
      return refuse(
        'Elimination seeding overrides require elimination round targets to also be set — seeding-override positions are addressed by that same ordered round list.',
      );
    }
    const parts = form.eliminationSeedingOverrides.split(',').map((part) => part.trim());
    if (parts.length !== explicitTargets.length) {
      return refuse(
        `Elimination seeding overrides (${parts.length} entries) must have exactly as many entries as elimination round targets (${explicitTargets.length}) — leave an entry blank to keep that round's reseed automatic.`,
      );
    }
    const validModes = new Set(['', 'diversity', 'balance', 'random']);
    if (parts.some((part) => !validModes.has(part))) {
      return refuse(
        `Each elimination seeding override must be blank (automatic), "diversity", "balance", or "random" — got "${form.eliminationSeedingOverrides}".`,
      );
    }
    explicitSeedingOverrides = parts.map((part) =>
      part === '' ? undefined : (part as 'diversity' | 'balance' | 'random'),
    );
  }

  return { ok: true, plan: { ...plan, explicitTargets, explicitSeedingOverrides } };
}
