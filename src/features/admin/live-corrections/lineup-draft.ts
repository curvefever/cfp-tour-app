import type { RoundAssignment } from '../../../domain/tournament/types';

/**
 * Pure helpers for the line-up draft the panel edits locally before saving
 * it in one step. The draft is the whole round (byes as `room: null`); the
 * domain (`applyLineupEdit`) validates it, so none of that is repeated here.
 */

export function moveUnit(draft: RoundAssignment[], name: string, room: number): RoundAssignment[] {
  return draft.map((entry) => (entry.name === name ? { ...entry, room } : entry));
}

export function eliminateUnit(draft: RoundAssignment[], name: string): RoundAssignment[] {
  return draft.filter((entry) => entry.name !== name);
}

export function reinstateUnit(draft: RoundAssignment[], name: string, room: number): RoundAssignment[] {
  return [...draft, { name, room }];
}

/** Units the draft moves, reinstates or eliminates, for highlighting. */
export function changedNames(base: RoundAssignment[], draft: RoundAssignment[]): Set<string> {
  const before = new Map(base.map((entry) => [entry.name, entry.room]));
  const changed = new Set<string>();
  for (const entry of draft) {
    if (before.get(entry.name) !== entry.room) changed.add(entry.name);
  }
  for (const entry of base) {
    if (!draft.some((kept) => kept.name === entry.name)) changed.add(entry.name);
  }
  return changed;
}

export function eliminatedNames(base: RoundAssignment[], draft: RoundAssignment[]): string[] {
  return base.filter((entry) => !draft.some((kept) => kept.name === entry.name)).map((entry) => entry.name);
}
