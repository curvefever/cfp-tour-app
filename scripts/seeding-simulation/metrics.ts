import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { isCountedPoolingRound } from '../../src/domain/tournament/pooling';
import { countSmallerRoomSeats } from '../../src/domain/tournament/smaller-room-seats';
import type { RoundAssignment } from '../../src/domain/tournament/types';
import { CUT, type Config, type RunResult } from './simulate';

export const METRICS = [
  'topCutHit',
  'topHalfHit',
  'rankCorrelation',
  'tiedForFirst',
  'strengthVsOpponents',
  'repeatPairings',
  'seatSpread',
] as const;
export type MetricKey = (typeof METRICS)[number];

/** Round-1 carry-over: final points of middle-strength units by how they finished round 1. */
export interface Carry {
  firstSum: number;
  firstCount: number;
  lastSum: number;
  lastCount: number;
}

export interface Cell {
  runs: number;
  sums: Record<MetricKey, number>;
  carry: Carry;
}

export function emptyCell(): Cell {
  return {
    runs: 0,
    sums: Object.fromEntries(METRICS.map((key) => [key, 0])) as Record<MetricKey, number>,
    carry: { firstSum: 0, firstCount: 0, lastSum: 0, lastCount: 0 },
  };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i += 1) {
    covariance += (xs[i] - meanX) * (ys[i] - meanY);
    varianceX += (xs[i] - meanX) ** 2;
    varianceY += (ys[i] - meanY) ** 2;
  }
  return varianceX === 0 || varianceY === 0 ? 0 : covariance / Math.sqrt(varianceX * varianceY);
}

function roomsOf(lineUp: RoundAssignment[]): string[][] {
  const rooms = new Map<number, string[]>();
  for (const { name, room } of lineUp) {
    if (room !== null) rooms.set(room, [...(rooms.get(room) ?? []), name]);
  }
  return [...rooms.values()];
}

/** The mean strength of the opponents each unit met in the counted rounds, against its own strength. */
function strengthVsOpponents(run: RunResult): number {
  const { finalState, strengths } = run;
  const met = new Map<string, string[]>();
  finalState.rounds.forEach((round, index) => {
    if (!isCountedPoolingRound(round)) return;
    for (const room of roomsOf(finalState.assignments[index])) {
      for (const name of room) met.set(name, [...(met.get(name) ?? []), ...room.filter((o) => o !== name)]);
    }
  });
  const names = [...met.keys()];
  const own = names.map((name) => strengths.get(name) as number);
  const opponents = names.map((name) => {
    const list = met.get(name) as string[];
    return list.reduce((sum, other) => sum + (strengths.get(other) as number), 0) / list.length;
  });
  return pearson(own, opponents);
}

/** Pairings beyond the first meeting, over every qualification round. */
function repeatPairings(run: RunResult): number {
  const seen = new Map<string, number>();
  for (let round = 0; round < run.qualRounds; round += 1) {
    for (const room of roomsOf(run.finalState.assignments[round])) {
      for (let a = 0; a < room.length; a += 1) {
        for (let b = a + 1; b < room.length; b += 1) {
          const key = room[a] < room[b] ? `${room[a]}|${room[b]}` : `${room[b]}|${room[a]}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return [...seen.values()].reduce((sum, times) => sum + Math.max(0, times - 1), 0);
}

function seatSpread(run: RunResult): number {
  const { finalState } = run;
  const lineUps = finalState.rounds.flatMap((round, index) =>
    isCountedPoolingRound(round) ? [finalState.assignments[index]] : [],
  );
  const counts = countSmallerRoomSeats(lineUps);
  const values = finalState.assignments[0].map((entry) => counts[entry.name] ?? 0);
  return Math.max(...values) - Math.min(...values);
}

export function measure(config: Config, run: RunResult): Record<MetricKey, number> {
  const standings = computeQualificationStandings(run.finalState);
  const byStrength = [...run.strengths.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const hits = (size: number) => {
    const truth = new Set(byStrength.slice(0, size));
    return standings.slice(0, size).filter((entry) => truth.has(entry.name)).length;
  };
  const cut = CUT[config.kind];
  const trueRank = new Map(byStrength.map((name, index) => [name, index]));
  const topPoints = standings[0]?.totalFP ?? 0;
  return {
    topCutHit: hits(cut),
    topHalfHit: hits(cut / 2),
    rankCorrelation: pearson(
      standings.map((_, index) => index),
      standings.map((entry) => trueRank.get(entry.name) as number),
    ),
    tiedForFirst: standings.filter((entry) => entry.totalFP === topPoints).length,
    strengthVsOpponents: strengthVsOpponents(run),
    repeatPairings: repeatPairings(run),
    seatSpread: seatSpread(run),
  };
}

/** Adds one run to the carry-over sums: units of middle true strength that won or came last in round 1. */
export function addCarry(carry: Carry, run: RunResult): void {
  const standings = computeQualificationStandings(run.finalState);
  const points = new Map(standings.map((entry) => [entry.name, entry.totalFP ?? 0]));
  const byStrength = [...run.strengths.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const total = byStrength.length;
  byStrength.forEach((name, index) => {
    if (index < total / 3 || index >= (2 * total) / 3) return;
    const result = run.roundOnePlaces.get(name);
    if (!result) return;
    if (result.place === 0) {
      carry.firstSum += points.get(name) ?? 0;
      carry.firstCount += 1;
    } else if (result.place === result.roomSize - 1) {
      carry.lastSum += points.get(name) ?? 0;
      carry.lastCount += 1;
    }
  });
}
