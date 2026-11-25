import { wholeNumber } from './round-match-formats';
import { getMinimumBracketUnits } from './schedule-generation';
import { defaultSemisSize } from './single-elimination';
import {
  type GenerationForm,
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
