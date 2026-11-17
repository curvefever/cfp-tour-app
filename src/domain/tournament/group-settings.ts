import { distributeRooms } from './room-distribution';
import type { GeneratedTournamentConfig, PersistedSetup, TournamentState } from './types';

/** The group size a Setup falls back to, and the sizes a group may have (a smaller or larger one is refused). */
export const GROUP_SIZE_BOUNDS = {
  min: 3,
  max: 5,
  ideal: 4,
} as const;

const DEFAULT_QUALIFIERS_PER_GROUP = 2;

/** The sizes of the groups `unitCount` units are split into, for the Setup's group size. */
export function groupSizesOf(unitCount: number, groupSize: number): number[] {
  return distributeRooms(unitCount, {
    min: GROUP_SIZE_BOUNDS.min,
    max: GROUP_SIZE_BOUNDS.max,
    ideal: groupSize,
  });
}

/**
 * The group settings of a Setup form, the one reader of the fall-backs: the ideal group size when the field is empty or
 * not a number, 2 qualifiers per group likewise. A form without a field (a narrower `Pick`) gets the fall-back.
 */
export function groupSettingsOf(form: Partial<Pick<PersistedSetup, 'groupSize' | 'qualifiersPerGroup'>>): {
  groupSize: number;
  qualifiersPerGroup: number;
} {
  return {
    groupSize: Number.parseInt(form.groupSize ?? '', 10) || GROUP_SIZE_BOUNDS.ideal,
    qualifiersPerGroup: Number.parseInt(form.qualifiersPerGroup ?? '', 10) || DEFAULT_QUALIFIERS_PER_GROUP,
  };
}

/**
 * The group settings of a stored tournament's `cfg`, with the fall-backs for one stored without them: the ideal group
 * size, 2 qualifiers per group, a single round robin. (A stored number is kept as it is, 0 included.)
 */
export function groupSettingsOfCfg(
  cfg: Pick<TournamentState['cfg'], 'groupSize' | 'qualifiersPerGroup' | 'roundRobinMode'>,
): Pick<GeneratedTournamentConfig, 'groupSize' | 'qualifiersPerGroup' | 'roundRobinMode'> {
  return {
    groupSize: cfg.groupSize ?? GROUP_SIZE_BOUNDS.ideal,
    roundRobinMode: cfg.roundRobinMode ?? 'single',
    qualifiersPerGroup: cfg.qualifiersPerGroup ?? DEFAULT_QUALIFIERS_PER_GROUP,
  };
}
