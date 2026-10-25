import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  consecutivePairs,
  crossSizeShare,
  correlation,
  placeProfiles,
  withinRoomSpread,
  type Correlation,
  type PlaceProfile,
  type UnitPair,
} from './calibrate';
import { loadSources, observations, poolObservations, POOLS, type RoomObservation } from './real-rooms';
import { fittedModels, momentsKey, recordingModel, spreadOf, type Moments } from './matched-model';
import { simulateElimination } from './elimination';
import { runSeed, scenarioSeed } from './random';
import { LEGACY_MODEL, NOISE, parametricModel, type Level, type ScoreModel } from './score-model';
import { simulate, type Kind } from './simulate';

/**
 * Calibration of the score model against real events (`docs/real-scores.md`).
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --real             the statistics on the real data
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --noise [--runs n]  the noise of each predictability level
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --moments [--runs n] the performance-spread moments (performance-moments.json)
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --parametric [--runs n] c and tau of the superseded parametric model
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --counts [--runs n]   the correlation at other counts
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --check [--runs n]   the fit of the fitted models
 * Qualification rounds are simulated as shape Q plays them: four rounds, the first not counted, the app's draw.
 */

const two = (value: number) => value.toFixed(2);
const three = (value: number) => value.toFixed(3);

/** The qualification-round correlation targets: the pooled values of `docs/real-scores.md` (Classic FFA and Colosseum; both team events). */
const CORRELATION_SOURCES: Record<Kind, string[]> = {
  ffa: ['ffa-classic', 'ffa-colosseum'],
  '2v2v2v2': ['2v2v2v2-classic', '2v2v2v2-syb'],
};
/** The scenario the noise of each predictability level is fitted on. */
const LEVEL_FIELDS = {
  'ffa-like': { kind: 'ffa', count: 37 },
  'team-like': { kind: '2v2v2v2', count: 37 },
} as const;

/** The room sizes statistic 4 compares: the second-to-last of the larger against the last of the smaller. */
const LUCKY_LOSER_SIZES: Record<Kind, [number, number]> = { ffa: [8, 7], '2v2v2v2': [4, 3] };

interface Observed {
  profiles: Map<number, PlaceProfile>;
  luckyLoser: number;
  spread: number;
  correlation: Correlation;
}

function observed(kind: Kind, rooms: RoomObservation[], pairs: UnitPair[]): Observed {
  const [large, small] = LUCKY_LOSER_SIZES[kind];
  return {
    luckyLoser: crossSizeShare(rooms, large, small),
    profiles: placeProfiles(rooms),
    spread: withinRoomSpread(rooms),
    correlation: correlation(pairs),
  };
}

function realTarget(kind: Kind): Observed {
  const sources = loadSources();
  const rooms = poolObservations(sources, POOLS[kind]);
  const pairs = sources
    .filter((source) => CORRELATION_SOURCES[kind].includes(source.key))
    .flatMap((source) => consecutivePairs(observations(source).filter((room) => room.qualification)));
  const result = observed(kind, rooms, pairs);
  const [large, small] = LUCKY_LOSER_SIZES[kind];
  const luckyRooms = poolObservations(sources, CORRELATION_SOURCES[kind]);
  return { ...result, luckyLoser: crossSizeShare(luckyRooms, large, small) };
}

function simulated(kind: Kind, count: number, noise: number, model: ScoreModel, runs: number): Observed {
  const rooms: RoomObservation[] = [];
  const pairs: UnitPair[] = [];
  for (let run = 0; run < runs; run += 1) {
    const seed = runSeed(`fit-${kind}-${count}`, noise, run);
    const result = simulate({ kind, count, mode: 'A' }, 'current', noise, seed, model);
    rooms.push(...result.rooms);
    pairs.push(...consecutivePairs(result.rooms));
  }
  return observed(kind, rooms, pairs);
}

/** The root of a decreasing function by bisection. */
function bisect(f: (x: number) => number, low: number, high: number, steps: number): number {
  let [a, b] = [low, high];
  for (let step = 0; step < steps; step += 1) {
    const middle = (a + b) / 2;
    if (f(middle) > 0) a = middle;
    else b = middle;
  }
  return (a + b) / 2;
}

function fitNoise(level: Level, target: number, runs: number): number {
  const { kind, count } = LEVEL_FIELDS[level];
  return bisect(
    (noise) => simulated(kind, count, noise, LEGACY_MODEL, runs).correlation.share - target,
    0.3,
    3,
    9,
  );
}

/** How far a simulated set of rooms is from the real pool: place medians per size shared by both, and the spread. */
function profileLoss(real: Observed, sim: Observed): number {
  const sizes = [...real.profiles].filter(([size, profile]) => profile.rooms >= 5 && sim.profiles.has(size));
  const places = sizes.map(([size, profile]) => {
    const medians = (sim.profiles.get(size) as PlaceProfile).medians;
    return (
      profile.medians.reduce((sum, value, place) => sum + (value - medians[place]) ** 2, 0) /
      profile.medians.length
    );
  });
  const meanPlaces = places.reduce((sum, value) => sum + value, 0) / places.length;
  return meanPlaces + (real.spread - sim.spread) ** 2;
}

/** The minimum of a unimodal function by golden-section search. */
function minimise(f: (x: number) => number, low: number, high: number, steps: number): number {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let [a, b] = [low, high];
  for (let step = 0; step < steps; step += 1) {
    const left = b - ratio * (b - a);
    const right = a + ratio * (b - a);
    if (f(left) < f(right)) b = right;
    else a = left;
  }
  return (a + b) / 2;
}

interface Field {
  kind: Kind;
  count: number;
  noise: number;
  runs: number;
}

function fitC(field: Field, tau: number): number {
  const real = realTarget(field.kind);
  return minimise(
    (c) =>
      profileLoss(real, simulated(field.kind, field.count, field.noise, parametricModel(c, tau), field.runs)),
    0.05,
    0.9,
    11,
  );
}

/** The margin noise at which the relative score's consistency exceeds the place's by the real gap. */
function fitTau(field: Field, c: number, gap: number): number {
  const excess = (tau: number) => {
    const { correlation: found } = simulated(
      field.kind,
      field.count,
      field.noise,
      parametricModel(c, tau),
      field.runs,
    );
    return found.relative - found.share - gap;
  };
  return excess(0) <= 0 ? 0 : bisect(excess, 0, 2, 8);
}

function printParametric(noises: Record<Level, number>, runs: number): void {
  const ffa = { kind: 'ffa', count: 37, noise: noises['ffa-like'], runs } as const;
  const real = realTarget('ffa').correlation;
  const gap = real.relative - real.share;
  let tau = 0.3;
  for (let round = 0; round < 3; round += 1) {
    const c = fitC(ffa, tau);
    tau = fitTau(ffa, c, gap);
    console.log(`round ${round + 1}: ffa-like c ${three(c)} tau ${three(tau)}`);
  }
  console.log(`tau ${three(tau)} (target gap ${three(gap)})`);
  for (const level of Object.keys(LEVEL_FIELDS) as Level[]) {
    for (const kind of ['ffa', '2v2v2v2'] as Kind[]) {
      const field = { kind, count: 37, noise: noises[level], runs };
      console.log(`kind ${kind} at ${level} (noise ${three(noises[level])}): c ${three(fitC(field, tau))}`);
    }
  }
}

/** The mean and SD of a room's performance spread per room size, for every kind and level, from qualifications under the app's draw. */
const MOMENT_COUNTS: Record<Kind, number[]> = { ffa: [32, 37, 40, 43], '2v2v2v2': [24, 25, 31, 32, 37, 53] };

/** The counts whose elimination rounds supply the room sizes a qualification never has. */
const ELIMINATION_COUNTS: Record<Kind, number[]> = {
  ffa: [32, 37, 40, 43],
  '2v2v2v2': [16, 17, 24, 31, 37, 53],
};

function momentsOf(kind: Kind, level: Level, runs: number): Record<string, Moments> {
  const sink = new Map<number, number[][]>();
  for (const count of MOMENT_COUNTS[kind]) {
    for (let run = 0; run < runs; run += 1) {
      const seed = runSeed(`moments-${kind}-${count}`, NOISE[level], run);
      simulate({ kind, count, mode: 'A' }, 'current', NOISE[level], seed, recordingModel(sink));
    }
  }
  const fallback = new Map<number, number[][]>();
  for (const count of ELIMINATION_COUNTS[kind]) {
    for (let run = 0; run < runs / 4; run += 1) {
      const seed = scenarioSeed(`moments-E-${kind}-${count}`, level, 'nothing', run);
      simulateElimination(
        { kind, count, control: false, rounds: 99 },
        NOISE[level],
        seed,
        recordingModel(fallback),
      );
    }
  }
  for (const [size, rooms] of fallback) if (!sink.has(size)) sink.set(size, rooms);
  return Object.fromEntries(
    [...sink].map(([size, rooms]) => {
      const spreads = rooms.map(spreadOf);
      const mean = spreads.reduce((sum, value) => sum + value, 0) / spreads.length;
      return [momentsKey(kind, level, size), { mean, sd: spreadOf(spreads) }];
    }),
  );
}

function printMoments(runs: number): void {
  const moments: Record<string, Moments> = {};
  for (const kind of Object.keys(POOLS) as Kind[]) {
    for (const level of Object.keys(LEVEL_FIELDS) as Level[])
      Object.assign(moments, momentsOf(kind, level, runs));
  }
  const path = fileURLToPath(new URL('./performance-moments.json', import.meta.url));
  writeFileSync(path, JSON.stringify(moments, null, 1));
  console.log(`wrote ${Object.keys(moments).length} entries to ${path}`);
}

/** The acceptance numbers of a model against the real pool: lucky-loser points, largest place-median gap, spread, correlation gap. */
function distances(real: Observed, found: Observed): string {
  let median = 0;
  for (const [size, profile] of real.profiles) {
    const other = found.profiles.get(size);
    if (profile.rooms < 5 || !other) continue;
    profile.medians.forEach((value, place) => {
      median = Math.max(median, Math.abs(value - other.medians[place]));
    });
  }
  const gap = (observed: Observed) => observed.correlation.relative - observed.correlation.share;
  return `lucky-loser ${Math.round(100 * (found.luckyLoser - real.luckyLoser))} pts, place medians max ${two(median)}, spread ${two(found.spread - real.spread)}, correlation gap ${two(gap(found) - gap(real))}`;
}

function describe(real: Observed, label: string, found: Observed): void {
  const sizes = [...found.profiles].filter(([, profile]) => profile.rooms >= 5).sort((a, b) => b[0] - a[0]);
  console.log(
    `  ${label}: spread ${two(found.spread)}, correlation relative ${two(found.correlation.relative)} share ${two(found.correlation.share)}, lucky-loser pairs ${Math.round(100 * found.luckyLoser)}%`,
  );
  console.log(`    off real by: ${distances(real, found)}`);
  for (const [size, profile] of sizes) console.log(`    size ${size}: ${profile.medians.map(two).join(' ')}`);
}

/** The fitted models against the real pool, in every kind × level pairing. */
function printCheck(models: (kind: Kind, level: Level) => ScoreModel[], runs: number): void {
  for (const kind of Object.keys(POOLS) as Kind[]) {
    console.log(`== ${kind}: real pool`);
    const real = realTarget(kind);
    describe(real, 'real', real);
    for (const level of Object.keys(LEVEL_FIELDS) as Level[]) {
      console.log(`== ${kind} at ${level} (noise ${three(NOISE[level])})`);
      for (const model of models(kind, level)) {
        describe(real, model.label, simulated(kind, 37, NOISE[level], model, runs));
      }
    }
  }
}

/** The share-beaten correlation of other counts at the noise fitted on 37. */
function printCounts(runs: number): void {
  const fields: Array<[Kind, number, Level]> = [
    ['2v2v2v2', 25, 'team-like'],
    ['2v2v2v2', 37, 'team-like'],
    ['2v2v2v2', 53, 'team-like'],
    ['ffa', 37, 'ffa-like'],
    ['ffa', 43, 'ffa-like'],
  ];
  for (const [kind, count, level] of fields) {
    const found = simulated(kind, count, NOISE[level], LEGACY_MODEL, runs).correlation.share;
    console.log(
      `${kind} ${count} at ${level}: share correlation ${two(found)} (target ${two(realTarget(kind).correlation.share)})`,
    );
  }
}

function main(args: string[]): void {
  const runs = Number(args[args.indexOf('--runs') + 1] || 400);
  if (args.includes('--real')) printReal();
  if (args.includes('--noise')) printNoise(runs);
  if (args.includes('--moments')) printMoments(runs);
  if (args.includes('--parametric')) printParametric(NOISE, runs);
  if (args.includes('--counts')) printCounts(runs);
  if (args.includes('--check')) printCheck(fittedModels, runs);
}

function printReal(): void {
  const sources = loadSources();
  for (const source of sources) {
    const rooms = observations(source);
    console.log(`== ${source.key}: ${rooms.length} rooms, spread ${two(withinRoomSpread(rooms))}`);
    for (const [size, profile] of [...placeProfiles(rooms)].sort((a, b) => b[0] - a[0])) {
      console.log(`  size ${size} (${profile.rooms} rooms): ${profile.medians.map(two).join(' ')}`);
    }
    const qualification = correlation(consecutivePairs(rooms.filter((room) => room.qualification)));
    const every = correlation(consecutivePairs(rooms));
    console.log(
      `  correlation, qualification rooms: relative ${two(qualification.relative)} share ${two(qualification.share)} (${qualification.pairs} pairs); all rooms: ${two(every.relative)} ${two(every.share)} (${every.pairs})`,
    );
  }
  for (const kind of Object.keys(POOLS) as Kind[]) {
    const target = realTarget(kind);
    console.log(
      `pool ${kind}: relative ${two(target.correlation.relative)} share ${two(target.correlation.share)} (${target.correlation.pairs} pairs), spread ${two(target.spread)}`,
    );
  }
}

function printNoise(runs: number): void {
  for (const level of Object.keys(LEVEL_FIELDS) as Level[]) {
    const { kind } = LEVEL_FIELDS[level];
    const target = realTarget(kind).correlation.share;
    const noise = fitNoise(level, target, runs);
    console.log(`${level}: target share correlation ${two(target)} -> noise ${three(noise)}`);
  }
}

main(process.argv.slice(2));
