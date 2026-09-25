import { GROUP_SIZE_BOUNDS } from './pooling';
import { distributeRooms } from './room-distribution';
import type { PersistedSetup, PoolingPhaseKey } from './types';

/**
 * How many units actually enter the bracket phase. Generation and the Setup
 * screen both need this number, so it lives here once.
 */

/** "Advance to bracket" as typed in Setup; null unless it starts with a positive whole number. */
export function parseAdvanceToBracket(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/** Keeps the requested count between the format's minimum and the number of confirmed units. */
export function clampAdvanceToBracket(requested: number, floor: number, confirmedCount: number): number {
  return Math.min(Math.max(requested, floor), confirmedCount);
}

/**
 * Group Stage derives the count itself (groups times qualifiers per group,
 * ignoring `qualAdv`); every other pooling phase advances `qualAdv` units,
 * already clamped by the caller; with no pooling phase everyone enters.
 */
export function resolveBracketEntryCount(input: {
  poolingPhase: PoolingPhaseKey;
  confirmedCount: number;
  qualAdv: number;
  groupSize: number;
  qualifiersPerGroup: number;
}): number {
  const { poolingPhase, confirmedCount, qualAdv, groupSize, qualifiersPerGroup } = input;
  if (poolingPhase === 'group-stage') {
    const groups = distributeRooms(confirmedCount, {
      min: GROUP_SIZE_BOUNDS.min,
      max: GROUP_SIZE_BOUNDS.max,
      ideal: groupSize,
    });
    return groups.length * qualifiersPerGroup;
  }
  return poolingPhase === 'none' ? confirmedCount : qualAdv;
}

/**
 * The same number from the raw Setup fields, for showing it before anyone
 * clicks Generate. Null while it can't be known: no roster loaded yet, or a
 * field that generation would reject.
 */
export function bracketEntryCountFromSetup(
  setup: Pick<PersistedSetup, 'poolingPhase' | 'qualAdv' | 'groupSize' | 'qualifiersPerGroup'>,
  confirmedCount: number | null | undefined,
  floor: number,
): number | null {
  if (!confirmedCount || confirmedCount < floor) return null;
  const groupSize = Number.parseInt(setup.groupSize, 10) || GROUP_SIZE_BOUNDS.ideal;
  const qualifiersPerGroup = Number.parseInt(setup.qualifiersPerGroup, 10) || 2;
  if (setup.poolingPhase === 'group-stage') {
    const validGroups =
      groupSize >= GROUP_SIZE_BOUNDS.min &&
      groupSize <= GROUP_SIZE_BOUNDS.max &&
      qualifiersPerGroup >= 1 &&
      groupSize > qualifiersPerGroup;
    if (!validGroups) return null;
  }
  let qualAdv = confirmedCount;
  if (setup.poolingPhase !== 'none') {
    const requested = parseAdvanceToBracket(setup.qualAdv);
    if (requested === null) return null;
    qualAdv = clampAdvanceToBracket(requested, floor, confirmedCount);
  }
  return resolveBracketEntryCount({
    poolingPhase: setup.poolingPhase,
    confirmedCount,
    qualAdv,
    groupSize,
    qualifiersPerGroup,
  });
}
