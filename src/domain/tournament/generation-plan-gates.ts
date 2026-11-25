import { MAX_KINGS_VALLEY_ROUNDS, kingsValleyMaxEntrants } from './kings-valley';
import { type PlanAfterScoring, type Planned, refuse } from './generation-plan-types';

function kingsValleyTooLargeMessage(input: {
  limit: number;
  entrants: number;
  unitPlural: string;
  formatLabel: string;
  hasQualification: boolean;
}): string {
  const fix = input.hasQualification
    ? 'Lower "Advance to bracket", or add a qualification phase.'
    : 'Add a qualification phase to cut the field first, or pick another schedule logic.';
  return `Kings Valley can take at most ${input.limit} ${input.unitPlural} into the ladder in ${input.formatLabel}: it has to reach the Final within ${MAX_KINGS_VALLEY_ROUNDS} rounds, and ${input.entrants} would enter. ${fix}`;
}

/** What each bracket phase and odd-count strategy allows: refuses, and adds nothing to the plan. */
export function checkFormatGates(plan: PlanAfterScoring): Planned<PlanAfterScoring> {
  const { format, schedule, config, oddCountStrategy, roomSize, bracketEntryCount, unitPlural } = plan;

  // Defense-in-depth: the Setup UI only ever offers 'double-elimination' as
  // an option when the format/odd-count-strategy combination is compatible,
  // but a stale selection can survive an odd-count-strategy change made
  // after schedule logic was picked (the option disappears from the
  // dropdown without resetting the already-selected value). Catch it here
  // with a clear message instead of the raw exception this would otherwise
  // hit two calls deep inside doubleEliminationBracketPhase.
  if (schedule === 'double-elimination') {
    if (format.idealRoomSize !== 2) {
      return refuse(
        `Double elimination isn't available for ${format.label} — it requires a head-to-head room shape (exactly 2 units per room). Pick "Double elimination — FFA/Team" instead.`,
      );
    }
    if (oddCountStrategy === 'flex') {
      return refuse(
        `Double elimination doesn't support the "Flex" odd-count strategy — a 3-unit room isn't double elimination. Pick "None" or "Bye" instead, or switch to "Double elimination — FFA/Team".`,
      );
    }
  }
  // Defense-in-depth, same shape as the double-elimination gate above: the
  // Setup UI only ever offers 'kings-valley' when the format isn't
  // head-to-head, but a stale selection can survive a format change made
  // after schedule logic was picked (the option disappears from the
  // dropdown without resetting an already-selected value). Head-to-head
  // Kings Valley tournaments generated before this gate keep working --
  // this only blocks new generation.
  if (schedule === 'kings-valley' && format.idealRoomSize === 2) {
    return refuse(
      `Kings Valley isn't available for ${format.label} — a head-to-head room shape (exactly 2 units per room) cuts only one unit per round, too slow to reach a Final. Pick another schedule logic.`,
    );
  }
  if (schedule === 'kings-valley') {
    const limit = kingsValleyMaxEntrants(roomSize);
    if (bracketEntryCount > limit) {
      return refuse(
        kingsValleyTooLargeMessage({
          limit,
          entrants: bracketEntryCount,
          unitPlural,
          formatLabel: format.label,
          hasQualification: config.poolingPhase !== 'none',
        }),
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
      return refuse(
        `With "None" selected as the odd-count strategy, the registered ${unitPlural} must be an exact multiple of ${ideal} (this format's room size) so the pooling phase itself can pair everyone cleanly — got ${config.n}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
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
      return refuse(
        `With "None" selected as the odd-count strategy, the ${config.poolingPhase !== 'none' ? 'number advancing to the bracket' : `registered ${unitPlural}`} ${requirement} — got ${eliminationEntryCount}.${alternatives ? ` Adjust the count, or pick ${alternatives} instead.` : ' Adjust the count.'}`,
      );
    }
  }

  return { ok: true, plan };
}
