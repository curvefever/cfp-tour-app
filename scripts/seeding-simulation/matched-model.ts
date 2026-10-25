import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Kind } from './cuts';
import { gaussian } from './random';
import { loadSources, poolObservations, POOLS, type RoomObservation } from './real-rooms';
import {
  distinctDownwards,
  LEGACY_MODEL,
  MARGIN_C,
  MARGIN_TAU,
  parametricModel,
  profileModel,
  profilePools,
  profilesOfSize,
  MATCH_RHO,
  type Level,
  type Margins,
  type ScoreModel,
} from './score-model';

/**
 * "Margins add a little": room-level matching. Real rooms stay whole. The pool's rooms of a size are ranked by the
 * spread of their relative scores; a simulated room picks the real room at the quantile its own performance spread
 * sits at, blended with chance by `rho`. rho = 0 is exactly the "nothing" model.
 */

export interface Moments {
  mean: number;
  sd: number;
}

/** The mean and SD of a room's performance spread per kind, level and room size: `fit.ts --moments`. */
export function loadMoments(): Record<string, Moments> {
  const path = fileURLToPath(new URL('./performance-moments.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, Moments>;
}

export function momentsKey(kind: Kind, level: Level, size: number): string {
  return `${kind}|${level}|${size}`;
}

export function spreadOf(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26). */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(x) / Math.SQRT2));
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export function matchedModel(kind: Kind, level: Level, rooms: RoomObservation[], rho: number): ScoreModel {
  const pools = profilePools(rooms);
  const moments = loadMoments();
  const bySize = new Map<number, number[][]>();
  return {
    label: `matched rooms rho=${rho.toFixed(2)}`,
    roomScores(performances, random) {
      const size = performances.length;
      if (!bySize.has(size)) {
        bySize.set(
          size,
          [...profilesOfSize(pools, size)].sort((a, b) => spreadOf(a) - spreadOf(b)),
        );
      }
      const ranked = bySize.get(size) as number[][];
      const found = moments[momentsKey(kind, level, size)];
      if (!found) throw new Error(`no performance moments for ${momentsKey(kind, level, size)}`);
      const z = (spreadOf(performances) - found.mean) / found.sd;
      const u = normalCdf(rho * z + Math.sqrt(1 - rho * rho) * gaussian(random));
      const picked = ranked[Math.min(ranked.length - 1, Math.floor(u * ranked.length))];
      return distinctDownwards(picked.map((value) => 1000 * value));
    },
  };
}

/** The legacy model that also notes each room's performances by size, to estimate their moments. */
export function recordingModel(sink: Map<number, number[][]>): ScoreModel {
  return {
    label: 'recording',
    roomScores(performances, random) {
      sink.set(performances.length, [...(sink.get(performances.length) ?? []), performances]);
      return LEGACY_MODEL.roomScores(performances, random);
    },
  };
}

export function scoreModelFor(kind: Kind, level: Level, margins: Margins): ScoreModel {
  const rooms = poolObservations(loadSources(), POOLS[kind]);
  return margins === 'nothing' ? profileModel(rooms) : matchedModel(kind, level, rooms, MATCH_RHO);
}

/** The models the fit check compares: both levels, and the superseded parametric one. */
export function fittedModels(kind: Kind, level: Level): ScoreModel[] {
  return [
    scoreModelFor(kind, level, 'nothing'),
    scoreModelFor(kind, level, 'little'),
    parametricModel(MARGIN_C[kind][level], MARGIN_TAU),
  ];
}
