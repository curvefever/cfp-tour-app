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
