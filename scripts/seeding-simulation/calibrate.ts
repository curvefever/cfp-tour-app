import type { RoomObservation } from './real-rooms';

/**
 * The three statistics a score model is calibrated on (`docs/real-scores.md`), computed alike on real and simulated
 * rooms: relative score by place per room size, the spread inside a room, and the round-to-round correlation.
 * A room is a `RoomObservation`: its present units, best score first.
 */

export interface PlaceProfile {
  /** Rooms of this effective size. */
  rooms: number;
  /** Median relative score by place, best first. */
  medians: number[];
}

export interface Correlation {
  relative: number;
  share: number;
  pairs: number;
}

export interface UnitPair {
  relative: [number, number];
  share: [number, number];
}

/** Score ÷ room average (`relativeRoomShare`), best score first. */
export function relativeScores(scores: number[]): number[] {
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return scores.map((score) => score / average);
}

/** (room size − place) ÷ (room size − 1) for a place counted from 0. */
export function shareBeaten(place: number, size: number): number {
  return (size - 1 - place) / (size - 1);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** Statistic 1: median relative score by place, per effective room size. */
export function placeProfiles(rooms: RoomObservation[]): Map<number, PlaceProfile> {
  const bySize = new Map<number, number[][]>();
  for (const room of rooms) {
    const size = room.units.length;
    bySize.set(size, [...(bySize.get(size) ?? []), relativeScores(room.scores)]);
  }
  return new Map(
    [...bySize].map(([size, list]) => [
      size,
      {
        rooms: list.length,
        medians: Array.from({ length: size }, (_, place) => median(list.map((scores) => scores[place]))),
      },
    ]),
  );
}

/** Statistic 2: the standard deviation of the relative scores inside a room (population form), median over rooms. */
export function withinRoomSpread(rooms: RoomObservation[]): number {
  return median(rooms.map((room) => standardDeviation(relativeScores(room.scores))));
}

function isLinked(unit: string): boolean {
  return !unit.startsWith('unlinked-');
}

/** A unit's result in each of two consecutive rounds, for every unit that played both. */
export function consecutivePairs(rooms: RoomObservation[]): UnitPair[] {
  const results = new Map<string, Map<number, { relative: number; share: number }>>();
  for (const room of rooms) {
    const relative = relativeScores(room.scores);
    room.units.forEach((unit, place) => {
      if (!isLinked(unit)) return;
      const rounds = results.get(unit) ?? new Map();
      rounds.set(room.round, { relative: relative[place], share: shareBeaten(place, room.units.length) });
      results.set(unit, rounds);
    });
  }
  const pairs: UnitPair[] = [];
  for (const rounds of results.values()) {
    for (const [round, first] of rounds) {
      const second = rounds.get(round + 1);
      if (second)
        pairs.push({ relative: [first.relative, second.relative], share: [first.share, second.share] });
    }
  }
  return pairs;
}

function pearson(points: Array<[number, number]>): number {
  const n = points.length;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (const [x, y] of points) {
    covariance += (x - meanX) * (y - meanY);
    varianceX += (x - meanX) ** 2;
    varianceY += (y - meanY) ** 2;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Statistic 3: round-to-round correlation of relative score and of share beaten, over pairs pooled from several events. */
export function correlation(pairs: UnitPair[]): Correlation {
  return {
    relative: pearson(pairs.map((pair) => pair.relative)),
    share: pearson(pairs.map((pair) => pair.share)),
    pairs: pairs.length,
  };
}

/** Statistic 4: the share of pairs where the second-to-last of a room of `large` units has a higher relative score than the last of a room of `small`. */
export function crossSizeShare(rooms: RoomObservation[], large: number, small: number): number {
  const lastOf = (size: number, place: number) =>
    rooms.filter((room) => room.units.length === size).map((room) => relativeScores(room.scores)[place]);
  const candidates = lastOf(large, large - 2);
  const others = lastOf(small, small - 1);
  const wins = candidates.reduce((sum, a) => sum + others.filter((b) => a > b).length, 0);
  return wins / (candidates.length * others.length);
}
