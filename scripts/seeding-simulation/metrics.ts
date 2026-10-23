import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { isCountedPoolingRound } from '../../src/domain/tournament/pooling';
import { countSmallerRoomSeats } from '../../src/domain/tournament/smaller-room-seats';
import type { RoundAssignment } from '../../src/domain/tournament/types';
import { HALF, PROFILE_KEYS, cutLines, profileOf, swingOf } from './cuts';
import { CUT, type Config, type RunResult } from './simulate';

export const METRICS = [
  'topCutHit',
  'topHalfHit',
  'rankCorrelation',
  'tiedForFirst',
  'strengthVsOpponents',
  'repeatPairings',
  'seatSpread',
  'misP1',
  'misP2',
  'misP3',
  'oppHalf',
  'oppFull',
] as const;
export type MetricKey = (typeof METRICS)[number];

/** Round-1 carry-over: final points of middle-strength units by how they finished round 1. */
export interface Carry {
  firstSum: number;
  firstCount: number;
  lastSum: number;
  lastCount: number;
}

/** Pairs inside a cut's points window that ended on opposite sides of it, and how many had the truly stronger unit above. */
export interface Decided {
  correct: number;
  pairs: number;
}

export interface Cell {
  runs: number;
  sums: Record<MetricKey, number>;
  carry: Carry;
  decided: { half: Decided; full: Decided };
}

export function emptyCell(): Cell {
  return {
    runs: 0,
    sums: Object.fromEntries(METRICS.map((key) => [key, 0])) as Record<MetricKey, number>,
    carry: { firstSum: 0, firstCount: 0, lastSum: 0, lastCount: 0 },
    decided: { half: { correct: 0, pairs: 0 }, full: { correct: 0, pairs: 0 } },
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

/** Value handed to the wrong units: the sum over units of |v(true rank) - v(final rank)| / 2 (lower is better). */
function misplacement(
  config: Config,
  run: RunResult,
  finalOrder: string[],
): Record<'misP1' | 'misP2' | 'misP3', number> {
  const trueOrder = [...run.strengths.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const trueRank = new Map(trueOrder.map((name, index) => [name, index + 1]));
  const out = { misP1: 0, misP2: 0, misP3: 0 };
  for (const key of PROFILE_KEYS) {
    const { value } = profileOf(key, config.kind);
    let total = 0;
    finalOrder.forEach((name, index) => {
      total += Math.abs(value(trueRank.get(name) as number) - value(index + 1));
    });
    out[`mis${key}` as 'misP1'] = total / 2;
  }
  return out;
}

function lastRoomSizes(run: RunResult): number[] {
  const last = run.finalState.assignments[run.qualRounds - 1];
  const sizes = new Map<number, number>();
  for (const { room } of last) if (room !== null) sizes.set(room, (sizes.get(room) ?? 0) + 1);
  return [...sizes.values()];
}

/** The mean true strength of a unit's opponents in the last round. */
function opponentStrength(run: RunResult, name: string): number {
  const last = run.finalState.assignments[run.qualRounds - 1];
  const room = last.find((entry) => entry.name === name)?.room;
  const others = last.filter((entry) => entry.room === room && entry.name !== name);
  return others.reduce((sum, entry) => sum + (run.strengths.get(entry.name) as number), 0) / others.length;
}

/** Last-round opposition of the unit ranked #c before the round minus that of #c+1 (0 = the same). */
function oppositionAtCut(run: RunResult, cut: number): number {
  const { order } = run.beforeLast;
  return opponentStrength(run, order[cut - 1]) - opponentStrength(run, order[cut]);
}

/** Among the units within one swing of the cut's points line, the pairs that end on opposite sides of it. */
function decidedAtCut(run: RunResult, finalOrder: string[], cut: number): Decided {
  const { order, points } = run.beforeLast;
  const swing = swingOf(Math.max(...lastRoomSizes(run)));
  const [line] = cutLines(
    order.map((name) => points.get(name) as number),
    [{ position: cut, weight: 1 }],
  );
  const inside = order.filter((name) => Math.abs((points.get(name) as number) - line) <= swing);
  const finalRank = new Map(finalOrder.map((name, index) => [name, index + 1]));
  const result = { correct: 0, pairs: 0 };
  for (let a = 0; a < inside.length; a += 1) {
    for (let b = a + 1; b < inside.length; b += 1) {
      const first = inside[a];
      const second = inside[b];
      const firstAbove = (finalRank.get(first) as number) <= cut;
      if (firstAbove === (finalRank.get(second) as number) <= cut) continue;
      result.pairs += 1;
      const above = firstAbove ? first : second;
      const below = firstAbove ? second : first;
      if ((run.strengths.get(above) as number) > (run.strengths.get(below) as number)) result.correct += 1;
    }
  }
  return result;
}

/** Adds one run's cut-decision counts to a cell. */
export function addDecided(cell: Cell, config: Config, run: RunResult): void {
  const finalOrder = computeQualificationStandings(run.finalState).map((entry) => entry.name);
  for (const [key, cut] of [
    ['half', HALF[config.kind]],
    ['full', CUT[config.kind]],
  ] as const) {
    const counts = decidedAtCut(run, finalOrder, cut);
    cell.decided[key].correct += counts.correct;
    cell.decided[key].pairs += counts.pairs;
  }
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
    ...misplacement(
      config,
      run,
      standings.map((entry) => entry.name),
    ),
    oppHalf: oppositionAtCut(run, HALF[config.kind]),
    oppFull: oppositionAtCut(run, CUT[config.kind]),
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
