import { relativeScores } from './calibrate';
import type { Kind } from './cuts';
import type { RoomObservation } from './real-rooms';
import { gaussian } from './random';

/**
 * How a room's scores follow from its places. The places come from strength plus noise as always; a model only
 * decides the scores handed out in that order, so the score order always equals the place order.
 */
export interface ScoreModel {
  label: string;
  /** Strictly decreasing integer scores for a room, given its units' performances best first. `random` is the model's own stream. */
  roomScores(performances: number[], random: () => number): number[];
}

/** Each score is a rounded step down from the previous one, so a room's scores are distinct. */
export function distinctDownwards(values: number[]): number[] {
  let previous = Number.POSITIVE_INFINITY;
  return values.map((value) => {
    previous = Math.min(Math.round(value), previous - 1);
    return previous;
  });
}

/** The model of the earlier reports: 1000 + 100 × performance. */
export const LEGACY_MODEL: ScoreModel = {
  label: 'legacy',
  roomScores: (performances) =>
    distinctDownwards(performances.map((performance) => 1000 + 100 * performance)),
};

/** "Margins add a little": each unit draws m = performance + τ × N(0,1); the sorted m-values are handed out by place as 1000 × exp(c × m). */
export function parametricModel(c: number, tau: number): ScoreModel {
  return {
    label: `parametric c=${c} tau=${tau}`,
    roomScores(performances, random) {
      const margins = performances
        .map((performance) => performance + tau * gaussian(random))
        .sort((a, b) => b - a);
      return distinctDownwards(margins.map((margin) => 1000 * Math.exp(c * margin)));
    },
  };
}

const MIN_POOL_ROOMS = 5;

/** Relative scores read at the same share beaten from a room of another size, by linear interpolation, then rescaled to average 1. */
function interpolated(relative: number[], size: number): number[] {
  const last = relative.length - 1;
  const read = Array.from({ length: size }, (_, place) => {
    const position = (place * last) / (size - 1);
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, last);
    return relative[lower] + (relative[upper] - relative[lower]) * (position - lower);
  });
  const average = read.reduce((sum, value) => sum + value, 0) / size;
  return read.map((value) => value / average);
}

/** The pool's size nearest to `size` that has enough rooms (the larger one when two are equally near). */
function poolSizeFor(pools: ProfilePools, size: number): number {
  const usable = [...pools]
    .filter(([, rooms]) => rooms.length >= MIN_POOL_ROOMS)
    .map(([poolSize]) => poolSize);
  if (usable.length === 0) throw new Error('no room size has enough real rooms');
  return usable.reduce((best, candidate) => {
    const gap = Math.abs(candidate - size) - Math.abs(best - size);
    return gap < 0 || (gap === 0 && candidate > best) ? candidate : best;
  });
}

/** The real rooms of each effective size, as relative scores best first. */
export type ProfilePools = Map<number, number[][]>;

export function profilePools(rooms: RoomObservation[]): ProfilePools {
  const pools: ProfilePools = new Map();
  for (const room of rooms) {
    const size = room.units.length;
    pools.set(size, [...(pools.get(size) ?? []), relativeScores(room.scores)]);
  }
  return pools;
}

/** The real profiles to draw a room of `size` from: those of the same size, or of the nearest size with enough rooms, read at the same share beaten. */
export function profilesOfSize(pools: ProfilePools, size: number): number[][] {
  const poolSize = poolSizeFor(pools, size);
  const rooms = pools.get(poolSize) as number[][];
  return poolSize === size ? rooms : rooms.map((room) => interpolated(room, size));
}

/** "Margins add nothing": a random real room of the same effective size lends its relative scores, handed out by place. */
export function profileModel(rooms: RoomObservation[]): ScoreModel {
  const pools = profilePools(rooms);
  return {
    label: 'real profiles',
    roomScores(performances, random) {
      const profiles = profilesOfSize(pools, performances.length);
      const picked = profiles[Math.floor(random() * profiles.length)];
      return distinctDownwards(picked.map((value) => 1000 * value));
    },
  };
}

/** Predictability: the round-to-round correlation of the share beaten in a qualification (`docs/real-scores.md`): 0.57 and 0.32. */
export type Level = 'ffa-like' | 'team-like';

/** Fitted by `fit.ts --noise` (FFA 37 and 2v2v2v2 37, shape Q, the app's draw, 1000 runs): the noise of `strength + noise × N(0,1)`. */
export const NOISE: Record<Level, number> = { 'ffa-like': 0.746, 'team-like': 1.189 };

/** The level each kind's own events sit at: where it was fitted. */
export const OWN_LEVEL: Record<Kind, Level> = { ffa: 'ffa-like', '2v2v2v2': 'team-like' };

/** Superseded by the matched rooms (it left the last of a smaller room 8–11 points too strong in statistic 4); kept for the fit report only. */
export const MARGIN_TAU = 0.31;
export const MARGIN_C: Record<Kind, Record<Level, number>> = {
  ffa: { 'ffa-like': 0.274, 'team-like': 0.224 },
  '2v2v2v2': { 'ffa-like': 0.221, 'team-like': 0.183 },
};

/** "nothing": real profiles; "little": matched rooms. */
export type Margins = 'nothing' | 'little';

/** How closely a unit's room follows its performance spread under "margins add a little": 1, the strongest the matching can be (decided after the fit scans; the correlation gap stays short of the real one). */
export const MATCH_RHO = 1;
