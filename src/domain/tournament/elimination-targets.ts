import type { ScheduleLogicKey } from './types';

export interface EliminationTargetContext {
  schedule: ScheduleLogicKey;
  /** How many units enter the first elimination round. */
  bracketEntryCount: number;
  /** Phrase for the entry count in the "first target can't exceed" message. */
  entryLabel: string;
  /** Semis size (single elimination): the smallest allowed last target. */
  semisSize: number;
  /** Shared-Final double elimination: the exact required last target. */
  winnersQualifiers: number;
  /** Shared-Final double elimination: only used in the last-target message. */
  finalSize: number;
  lbQualifiers: number;
}

export type EliminationTargetsResult =
  { ok: true; values: number[] | undefined } | { ok: false; error: string };

/**
 * Parses and validates the "elimination round targets" text: an ordered list
 * of exact survivor counts for the elimination rounds leading into Semis
 * (single elimination) or the shared Final. Blank = automatic (`values`
 * undefined). Shared by generation and live advancement edits.
 */
export function parseEliminationTargets(
  text: string,
  context: EliminationTargetContext,
): EliminationTargetsResult {
  const usesTargets =
    context.schedule === 'single-elimination' || context.schedule === 'double-elimination-shared-final';
  if (!text.trim() || !usesTargets) return { ok: true, values: undefined };

  const parts = text.split(',').map((part) => part.trim());
  const values = parts.map((part) => Number.parseInt(part, 10));
  const isValidInteger = (value: number, part: string) =>
    Number.isFinite(value) && value >= 1 && String(value) === part;
  if (values.some((value, index) => !isValidInteger(value, parts[index]))) {
    return {
      ok: false,
      error: `Elimination round targets must be a comma-separated list of positive whole numbers — got "${text}".`,
    };
  }
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > values[index - 1]) {
      return {
        ok: false,
        error: `Elimination round targets must not increase from round to round — got ${values.join(',')}.`,
      };
    }
  }
  if (values[0] > context.bracketEntryCount) {
    return {
      ok: false,
      error: `The first elimination round target (${values[0]}) can't exceed the ${context.entryLabel} (${context.bracketEntryCount}).`,
    };
  }
  const lastTarget = values[values.length - 1];
  if (context.schedule === 'double-elimination-shared-final') {
    // The list is the whole winners-bracket curve and its last round feeds
    // the Final directly, so its last value is exactly the Final's
    // winners-bracket share, not a minimum.
    if (lastTarget !== context.winnersQualifiers) {
      return {
        ok: false,
        error: `The last elimination round target (${lastTarget}) must be exactly ${context.winnersQualifiers} for a shared Final: the ${context.finalSize}-seat Final takes ${context.winnersQualifiers} from the winners bracket and ${context.lbQualifiers} from the losers bracket (LB qualifiers). End the list at ${context.winnersQualifiers}, or change the Final size override / LB qualifiers.`,
      };
    }
  } else if (lastTarget < context.semisSize) {
    return {
      ok: false,
      error: `The last elimination round target (${lastTarget}) must be at least ${context.semisSize} (the Semis size) — there'd be nothing left to feed the next phase.`,
    };
  }
  return { ok: true, values };
}
