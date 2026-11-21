/**
 * The seed a unit would arrive with in a Custom bracket round, worked out ahead of play for the Bracket's preview:
 * the same numbers the real pool carries (`PendingBracketSeed.seed`). A qualification place is its own seed; a unit
 * from a room of an earlier round carries that room's seed, the best seed of the units projected into the room (or,
 * when the earlier round is drawn already, of the seats it holds). A slot nobody can name the seed of (a best of a
 * place) has none, and a pool with one such slot is drawn without seed lines.
 */
import type { ProjectedSlotLabel } from './bracket';
import type { RoundAssignment } from './types';

export function projectedSeeds(options: {
  assignments: ReadonlyArray<readonly RoundAssignment[]>;
  /** The slots projected so far, by round (null: not projectable). */
  projected: Readonly<Record<number, ProjectedSlotLabel[][] | null>>;
  /** The round each waterfall slot comes from. */
  sourceIndexOf: ReadonlyMap<ProjectedSlotLabel, number>;
}): (slot: ProjectedSlotLabel) => number | undefined {
  const { assignments, projected, sourceIndexOf } = options;
  const roomSeeds = new Map<string, number | undefined>();

  const best = (seeds: Array<number | undefined>): number | undefined => {
    const known = seeds.filter((seed): seed is number => seed !== undefined);
    return known.length > 0 ? Math.min(...known) : undefined;
  };

  const roomSeed = (sourceIndex: number, room: number): number | undefined => {
    const key = `${sourceIndex}:${room}`;
    if (roomSeeds.has(key)) return roomSeeds.get(key);
    roomSeeds.set(key, undefined);
    const slots = projected[sourceIndex]?.[room - 1];
    const seed = slots
      ? best(slots.map(seedOf))
      : best(
          (assignments[sourceIndex] ?? []).filter((entry) => entry.room === room).map((entry) => entry.seed),
        );
    roomSeeds.set(key, seed);
    return seed;
  };

  function seedOf(slot: ProjectedSlotLabel): number | undefined {
    if (slot.kind === 'standings-rank') return slot.rank;
    const sourceIndex = slot.kind === 'waterfall-rank' ? sourceIndexOf.get(slot) : undefined;
    return sourceIndex === undefined || slot.kind !== 'waterfall-rank'
      ? undefined
      : roomSeed(sourceIndex, slot.room);
  }

  return seedOf;
}
