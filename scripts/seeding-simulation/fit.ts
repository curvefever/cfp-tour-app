import {
  consecutivePairs,
  correlation,
  placeProfiles,
  withinRoomSpread,
  type Correlation,
  type PlaceProfile,
  type UnitPair,
} from './calibrate';
import { loadSources, observations, poolObservations, POOLS, type RoomObservation } from './real-rooms';
import { runSeed } from './random';
import {
  fittedModels,
  LEGACY_MODEL,
  NOISE,
  parametricModel,
  type Level,
  type ScoreModel,
} from './score-model';
import { simulate, type Kind } from './simulate';

/**
 * Calibration of the score model against real events (`docs/real-scores.md`).
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --real             the statistics on the real data
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --noise [--runs n]  the noise of each predictability level
 *   pnpm exec tsx scripts/seeding-simulation/fit.ts --margins [--runs n] c per kind and level, tau
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

interface Observed {
  profiles: Map<number, PlaceProfile>;
  spread: number;
  correlation: Correlation;
}

function observed(rooms: RoomObservation[], pairs: UnitPair[]): Observed {
  return { profiles: placeProfiles(rooms), spread: withinRoomSpread(rooms), correlation: correlation(pairs) };
}

function realTarget(kind: Kind): Observed {
  const sources = loadSources();
  const rooms = poolObservations(sources, POOLS[kind]);
  const pairs = sources
    .filter((source) => CORRELATION_SOURCES[kind].includes(source.key))
    .flatMap((source) => consecutivePairs(observations(source).filter((room) => room.qualification)));
  return observed(rooms, pairs);
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
  return observed(rooms, pairs);
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

function printMargins(noises: Record<Level, number>, runs: number): void {
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

function describe(label: string, found: Observed): void {
  const sizes = [...found.profiles].filter(([, profile]) => profile.rooms >= 5).sort((a, b) => b[0] - a[0]);
  console.log(
    `  ${label}: spread ${two(found.spread)}, correlation relative ${two(found.correlation.relative)} share ${two(found.correlation.share)}`,
  );
  for (const [size, profile] of sizes) console.log(`    size ${size}: ${profile.medians.map(two).join(' ')}`);
}

/** The fitted models against the real pool, in every kind × level pairing. */
function printCheck(models: (kind: Kind, level: Level) => ScoreModel[], runs: number): void {
  for (const kind of Object.keys(POOLS) as Kind[]) {
    console.log(`== ${kind}: real pool`);
    describe('real', realTarget(kind));
    for (const level of Object.keys(LEVEL_FIELDS) as Level[]) {
      console.log(`== ${kind} at ${level} (noise ${three(NOISE[level])})`);
      for (const model of models(kind, level)) {
        describe(model.label, simulated(kind, 37, NOISE[level], model, runs));
      }
    }
  }
}

function main(args: string[]): void {
  const runs = Number(args[args.indexOf('--runs') + 1] || 400);
  if (args.includes('--real')) printReal();
  if (args.includes('--noise')) printNoise(runs);
  if (args.includes('--margins')) printMargins(NOISE, runs);
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
