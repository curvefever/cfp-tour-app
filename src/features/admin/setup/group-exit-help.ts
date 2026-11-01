import { clampAdvanceToBracket, parseAdvanceToBracket } from '../../../domain/tournament/bracket-entry';
import {
  groupExitIsTotal,
  groupExitRefusal,
  groupExitShape,
  groupSizesOf,
} from '../../../domain/tournament/group-exit';
import { GROUP_SIZE_BOUNDS } from '../../../domain/tournament/pooling';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { groupExitHelp } from '../../standings/group-exit-text';

/**
 * The help line under "Teams out of the groups": what the current roster would do with a total, in words, or why
 * generation would refuse it. Null when it can't be known yet (no roster, a field still being typed), and, for so many
 * per group, whenever generation would accept it: only the refusal is shown.
 */
export function groupExitHelpLine(
  setup: Pick<PersistedSetup, 'groupExit' | 'groupSize' | 'qualAdv' | 'qualifiersPerGroup'>,
  registered: number | null,
  unitPlural: string,
): { text: string; refused: boolean } | null {
  if (!registered) return null;
  const groupSize = Number.parseInt(setup.groupSize, 10);
  if (!(groupSize >= GROUP_SIZE_BOUNDS.min && groupSize <= GROUP_SIZE_BOUNDS.max)) return null;
  if (!groupExitIsTotal(setup)) return perGroupHelpLine(setup, registered, groupSize, unitPlural);
  const requested = parseAdvanceToBracket(setup.qualAdv);
  if (requested === null) return null;
  const total = clampAdvanceToBracket(requested, registered);
  const refusal = groupExitRefusal(registered, groupSize, setup.groupExit, total, unitPlural);
  if (refusal) return { text: refusal, refused: true };
  const sizes = groupSizesOf(registered, groupSize);
  return {
    text: groupExitHelp(groupExitShape(sizes, setup.groupExit, total), sizes, registered, unitPlural),
    refused: false,
  };
}

function perGroupHelpLine(
  setup: Pick<PersistedSetup, 'qualifiersPerGroup'>,
  registered: number,
  groupSize: number,
  unitPlural: string,
): { text: string; refused: true } | null {
  const qualifiers = Number.parseInt(setup.qualifiersPerGroup, 10) || 2;
  const refusal = groupExitRefusal(registered, groupSize, 'per-group', qualifiers, unitPlural);
  return refusal ? { text: refusal, refused: true } : null;
}

/**
 * What the Setup shows for "Advance to bracket" (or "Qualifiers per group") when the Groups line of the custom
 * bracket graph decides it: the value it implies, or why it can't be used. `total` is the highest rank the line
 * routes; `groupCount` is null while no roster is loaded.
 */
export function groupsLineExitText(input: {
  total: number;
  perGroup: boolean;
  groupCount: number | null;
}): string {
  const { total, perGroup, groupCount } = input;
  if (total === 0) return 'not set yet — route the ranks of the groups in the custom bracket graph below';
  if (!perGroup) return `${total}, set by the Groups line`;
  if (!groupCount) return `${total} in all, set by the Groups line (load a roster to see it per group)`;
  if (total % groupCount !== 0) {
    return `the Groups line sends ${total}, which ${groupCount} groups can't share — route a multiple of ${groupCount}`;
  }
  return `${total / groupCount}, set by the Groups line`;
}
