import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { smallerRoomSeatsBefore } from '../../src/domain/tournament/smaller-room-seats';
import {
  addObservations,
  emptyAccumulator,
  summarise,
  type Accumulator,
  type Observation,
  type Summary,
} from './elim-measures';
import { CUT } from './cuts';
import { scoreModelFor } from './matched-model';
import { byesApply } from './q-draws';
import {
  cutDecidedByTieBreak,
  extractUnits,
  largestRoomOf,
  Q_OPTIONS,
  standingsUnder,
  type QOption,
  type QualUnit,
} from './qualification';
import { scenarioSeed, seededRandom, shuffled } from './random';
import { NOISE, type Level, type Margins } from './score-model';
import { simulate, type Kind, type RunResult } from './simulate';
import type { Policy } from './policies';

/**
 * Shape Q scenarios: a qualification table of four rounds, the first not counted, cut at 16 (2v2v2v2) or 24 (FFA).
 *   pnpm exec tsx scripts/seeding-simulation/run-q.ts --trial
 *   pnpm exec tsx scripts/seeding-simulation/run-q.ts --draw-check [--runs 40]   the rebuilt draw equals the engine's
 *   pnpm exec tsx scripts/seeding-simulation/run-q.ts --kind ffa --count 37 --level ffa-like --margins little --runs 200
 */

export interface QScenario {
  kind: Kind;
  count: number;
  level: Level;
  margins: Margins;
  runs: number;
}

interface QCell {
  real: Accumulator;
  placebo: Accumulator;
  /** Runs in which equal primary values straddled the cut. */
  tieDecided: number;
  runs: number;
}

/** Mean of a measure by true-strength quarter and room size: the theory check. */
type Theory = Map<string, { sum: number; count: number }>;

export interface QResult {
  scenario: QScenario;
  /** Null where the option does not exist for the scenario (an FFA table, byes that do not apply). */
  cells: Record<QOption, QCell | null>;
  theory: { Q0: Theory; QS: Theory; relative: Theory };
  /** Runs in which the tool's `Q0` order differs from `computeQualificationStandings`. */
  orderMismatches: number;
  /** Runs in which the smaller-room seat counts differ by more than 1. */
  seatSpreadBreaches: number;
}

function emptyCell(): QCell {
  return { real: emptyAccumulator(), placebo: emptyAccumulator(), tieDecided: 0, runs: 0 };
}

function seatCounts(units: QualUnit[]): { min: number; max: number } {
  const seats = units.map((unit) => unit.seats);
  return { min: Math.min(...seats), max: Math.max(...seats) };
}

/** Adds one qualification, ranked under `option`, to a cell. */
function addQualification(
  cell: QCell,
  option: QOption,
  units: QualUnit[],
  advantage: (unit: QualUnit) => boolean,
  random: () => number,
  cut: number,
): void {
  const standing = standingsUnder(option, units);
  const qualified = new Set(standing.order.slice(0, cut).map((unit) => unit.name));
  const window = largestRoomOf(units);
  const labelled = units.filter(advantage);
  const placebo = new Set(
    shuffled(
      units.map((unit) => unit.name),
      random,
    ).slice(0, labelled.length),
  );
  const observe = (labels: (unit: QualUnit) => boolean): Observation[] =>
    units.map((unit) => ({
      trueRank: unit.trueRank,
      advantaged: labels(unit),
      won: qualified.has(unit.name),
    }));
  addObservations(cell.real, observe(advantage), cut, window);
  addObservations(
    cell.placebo,
    observe((unit) => placebo.has(unit.name)),
    cut,
    window,
  );
  if (cutDecidedByTieBreak(standing, cut)) cell.tieDecided += 1;
  cell.runs += 1;
}

function addTheory(theory: QResult['theory'], units: QualUnit[]): void {
  const top = largestRoomOf(units);
  const bump = (map: Theory, key: string, value: number) => {
    const found = map.get(key) ?? { sum: 0, count: 0 };
    map.set(key, { sum: found.sum + value, count: found.count + 1 });
  };
  for (const unit of units) {
    const quarter = Math.floor(((unit.trueRank - 1) * 4) / units.length);
    for (const round of unit.rounds) {
      if (!round) continue;
      const key = `${quarter}|${round.size}`;
      bump(theory.Q0, key, Math.max(0, top + 1 - round.place));
      bump(theory.QS, key, 1 + ((top - 1) * (round.size - round.place)) / (round.size - 1));
      bump(theory.relative, key, round.relative);
    }
  }
}

function sameOrder(result: RunResult, units: QualUnit[]): boolean {
  const engine = computeQualificationStandings(result.finalState).map((entry) => entry.name);
  const mine = standingsUnder('Q0', units).order.map((unit) => unit.name);
  return engine.length === mine.length && engine.every((name, index) => name === mine[index]);
}

function seatSpreadBreach(result: RunResult): boolean {
  const counts = smallerRoomSeatsBefore(result.finalState, result.qualRounds);
  const values = result.finalState.assignments[0].map((entry) => counts[entry.name] ?? 0);
  return Math.max(...values) - Math.min(...values) > 1;
}

const BASE_OPTIONS: QOption[] = ['Q0', 'QS', 'QH', 'QR', 'Q0c', 'QSc'];

export function runQScenario(scenario: QScenario): QResult {
  const { kind, count, level, margins, runs } = scenario;
  const cut = CUT[kind];
  const model = scoreModelFor(kind, level, margins);
  const config = { kind, count, mode: 'A' as const };
  const cells = Object.fromEntries(Q_OPTIONS.map((option) => [option, emptyCell()])) as Record<
    QOption,
    QCell | null
  >;
  const theory: QResult['theory'] = { Q0: new Map(), QS: new Map(), relative: new Map() };
  let orderMismatches = 0;
  let seatSpreadBreaches = 0;
  let byesUsed = true;
  const run = (policy: Policy, seed: number) => simulate(config, policy, NOISE[level], seed, model);
  for (let index = 0; index < runs; index += 1) {
    const seed = scenarioSeed(`Q-${kind}-${count}`, level, margins, index);
    const random = seededRandom(seed ^ 0x27d4eb2f);
    const base = run('current', seed);
    const units = extractUnits(base);
    const seats = seatCounts(units);
    const moreSeats = (unit: QualUnit) => unit.seats > seats.min;
    if (!sameOrder(base, units)) orderMismatches += 1;
    if (seatSpreadBreach(base)) seatSpreadBreaches += 1;
    addTheory(theory, units);
    for (const option of BASE_OPTIONS)
      addQualification(cells[option] as QCell, option, units, moreSeats, random, cut);
    const stake = extractUnits(run('QK', seed));
    const stakeSeats = seatCounts(stake);
    addQualification(cells.QK as QCell, 'QK', stake, (unit) => unit.seats > stakeSeats.min, random, cut);
    if (byesApply(base.finalState.rounds[base.firstCounted].rooms, count)) {
      const byes = extractUnits(run('QB', seed));
      const hadBye = (unit: QualUnit) => unit.rounds.some((round) => round === null);
      addQualification(cells.QB as QCell, 'QB', byes, hadBye, random, cut);
    } else {
      byesUsed = false;
    }
  }
  if (kind !== 'ffa') {
    cells.Q0c = null;
    cells.QSc = null;
  }
  if (!byesUsed) cells.QB = null;
  return { scenario, cells, theory, orderMismatches, seatSpreadBreaches };
}

function describe(cell: QCell | null, applicable = true): string {
  if (!cell) return 'n/a';
  const summary: Summary = summarise(cell.real);
  const placebo = summarise(cell.placebo);
  const gap = Number.isNaN(summary.gap) ? 'n/a' : `${summary.gap.toFixed(1)} ± ${summary.error.toFixed(1)}`;
  const tie = applicable ? `, tie-break decides ${Math.round((100 * cell.tieDecided) / cell.runs)}%` : '';
  const empty = Number.isNaN(placebo.gap) ? 'n/a' : `${placebo.gap.toFixed(1)} ± ${placebo.error.toFixed(1)}`;
  return `gap ${gap} · top-k kept ${summary.kept.toFixed(2)}${tie} | placebo ${empty}`;
}

/** Mean of a theory measure at the smaller room size minus at the largest, per strength quarter. */
function theoryDifference(theory: Theory): string {
  const sizes = [...new Set([...theory.keys()].map((key) => Number(key.split('|')[1])))].sort(
    (a, b) => a - b,
  );
  if (sizes.length < 2) return 'one room size';
  const small = sizes[sizes.length - 2];
  const large = sizes[sizes.length - 1];
  const mean = (quarter: number, size: number) => {
    const found = theory.get(`${quarter}|${size}`);
    return found ? found.sum / found.count : Number.NaN;
  };
  return [0, 1, 2, 3].map((quarter) => (mean(quarter, small) - mean(quarter, large)).toFixed(2)).join(' ');
}

function print(result: QResult): void {
  const { scenario } = result;
  console.log(
    `Q ${scenario.kind} ${scenario.count} ${scenario.level} margins ${scenario.margins}, ${scenario.runs} runs; Q0 order mismatches ${result.orderMismatches}, seat-spread breaches ${result.seatSpreadBreaches}`,
  );
  for (const option of Q_OPTIONS) {
    console.log(`  ${option}: ${describe(result.cells[option], option !== 'QR')}`);
  }
  console.log(`  theory, smaller minus largest room by strength quarter (strongest first):`);
  console.log(`    Q0 points ${theoryDifference(result.theory.Q0)}`);
  console.log(`    QS points ${theoryDifference(result.theory.QS)}`);
  console.log(`    relative score ${theoryDifference(result.theory.relative)}`);
}

/** The draw rebuilt from the engine's pieces (`engine-like`) against the engine's own, over whole qualifications. */
function drawCheck(runs: number): void {
  const fields: Array<[Kind, number]> = [
    ['ffa', 37],
    ['ffa', 43],
    ['2v2v2v2', 25],
    ['2v2v2v2', 31],
    ['2v2v2v2', 53],
  ];
  for (const [kind, count] of fields) {
    const lineUps = (policy: Policy, seed: number) =>
      JSON.stringify(
        simulate({ kind, count, mode: 'A' }, policy, NOISE['ffa-like'], seed).finalState.assignments.map(
          (round) => round.map((entry) => [entry.name, entry.room]),
        ),
      );
    let different = 0;
    for (let run = 0; run < runs; run += 1) {
      const seed = scenarioSeed(`draw-${kind}-${count}`, 'ffa-like', 'none', run);
      if (lineUps('current', seed) !== lineUps('engine-like', seed)) different += 1;
    }
    console.log(`${kind} ${count}: ${different} of ${runs} qualifications with a different line-up`);
  }
}

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const args = process.argv.slice(2);
if (args.includes('--draw-check')) {
  drawCheck(Number(option(args, '--runs', '40')));
} else if (args.includes('--trial')) {
  const trial = { margins: 'little', runs: 200 } as const;
  print(runQScenario({ kind: '2v2v2v2', count: 25, level: 'team-like', ...trial }));
  print(runQScenario({ kind: 'ffa', count: 37, level: 'ffa-like', ...trial }));
} else if (args.includes('--kind')) {
  print(
    runQScenario({
      kind: option(args, '--kind', 'ffa') as Kind,
      count: Number(option(args, '--count', '37')),
      level: option(args, '--level', 'ffa-like') as Level,
      margins: option(args, '--margins', 'little') as Margins,
      runs: Number(option(args, '--runs', '200')),
    }),
  );
}
