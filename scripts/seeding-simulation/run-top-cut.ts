import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordDifference, summarise } from './elim-measures';
import { scoreModelFor } from './matched-model';
import { addQualification, emptyCell, sameOrder, type QCell } from './run-q';
import { extractUnits, standingsUnder, type QOption, type QualUnit } from './qualification';
import { scenarioSeed, seededRandom } from './random';
import { NOISE, type Level, type Margins } from './score-model';
import { simulate } from './simulate';

/**
 * The two FFA points tables with a cut near the top (`plans/2026-10-25-ffa-table-top-cut.md`): shape Q of the room-size
 * study with several cuts read from the same runs. Report only. Not part of `pnpm test`.
 *   trial:    pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --trial [--runs 300]
 *   simulate: pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --runs 3000 --out <dir> [--shard 0/4] [--only T-ffa-37]
 *   check:    pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --check24 <dir of saved jobs> <dir of the study's saved jobs>
 */

/** The options reported: Standard points, the community table, and their scaled versions. */
export const TOP_OPTIONS = ['Q0', 'Q0c', 'QS', 'QH', 'QSc'] as const;
export type TopOption = (typeof TOP_OPTIONS)[number];

/** The study's own order within a run, `QR` included: the placebo labels draw from one random source in this order. */
const STUDY_ORDER: QOption[] = ['Q0', 'QS', 'QH', 'QR', 'Q0c', 'QSc'];

/** The cut of the study first (so that its random draws come first and its cells reproduce), then the new ones. */
export const REPRODUCTION_CUT = 24;
export const CUTS = [REPRODUCTION_CUT, 8, 16];

/** Scaled options and the plain option whose order they must equal when every room has the largest size. */
const PLAIN_OF: Record<'QS' | 'QH' | 'QSc', TopOption> = { QS: 'Q0', QH: 'Q0', QSc: 'Q0c' };

export interface TopCutScenario {
  count: number;
  level: Level;
  margins: Margins;
  runs: number;
}

interface PairedShare {
  hits: number;
  /** Per-run difference of a hit (0 or 1) to the reference option's. */
  difference: { sum: number; sumSquares: number; count: number };
}

export interface TopCutResult {
  scenario: TopCutScenario;
  /** By cut, then option. */
  cells: Record<string, Record<TopOption, QCell>>;
  /** Runs in which the true best unit finished in the top 2 of the standings, by option. */
  top2: Record<TopOption, PairedShare>;
  /** Runs in which the tool's `Q0` order differs from `computeQualificationStandings`. */
  orderMismatches: number;
  /** Runs in which a scaled option's order equals its plain option's. */
  sameAsPlain: Record<'QS' | 'QH' | 'QSc', number>;
}

function emptyShare(): PairedShare {
  return { hits: 0, difference: { sum: 0, sumSquares: 0, count: 0 } };
}

function emptyResult(scenario: TopCutScenario): TopCutResult {
  const cells: TopCutResult['cells'] = {};
  for (const cut of CUTS) {
    cells[cut] = Object.fromEntries(TOP_OPTIONS.map((option) => [option, emptyCell()])) as Record<
      TopOption,
      QCell
    >;
  }
  return {
    scenario,
    cells,
    top2: Object.fromEntries(TOP_OPTIONS.map((option) => [option, emptyShare()])) as Record<
      TopOption,
      PairedShare
    >,
    orderMismatches: 0,
    sameAsPlain: { QS: 0, QH: 0, QSc: 0 },
  };
}

function namesInOrder(option: QOption, units: QualUnit[]): string[] {
  return standingsUnder(option, units)
    .order.map((unit) => unit.name)
    .slice();
}

function sameNames(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((name, index) => name === second[index]);
}

/** Whether the truly best unit is among the first two of the standings under `option`. */
function bestInTopTwo(option: QOption, units: QualUnit[]): number {
  return standingsUnder(option, units)
    .order.slice(0, 2)
    .some((unit) => unit.trueRank === 1)
    ? 1
    : 0;
}

function addTopTwo(result: TopCutResult, units: QualUnit[]): void {
  const reference = bestInTopTwo('Q0', units);
  for (const option of TOP_OPTIONS) {
    const hit = bestInTopTwo(option, units);
    const share = result.top2[option];
    share.hits += hit;
    share.difference.sum += hit - reference;
    share.difference.sumSquares += (hit - reference) ** 2;
    share.difference.count += 1;
  }
}

function addScaledOrders(result: TopCutResult, units: QualUnit[]): void {
  const plain: Partial<Record<TopOption, string[]>> = {
    Q0: namesInOrder('Q0', units),
    Q0c: namesInOrder('Q0c', units),
  };
  for (const option of Object.keys(PLAIN_OF) as Array<keyof typeof PLAIN_OF>) {
    if (sameNames(namesInOrder(option, units), plain[PLAIN_OF[option]] as string[]))
      result.sameAsPlain[option] += 1;
  }
}

export function runTopCutScenario(scenario: TopCutScenario): TopCutResult {
  const { count, level, margins, runs } = scenario;
  const model = scoreModelFor('ffa', level, margins);
  const config = { kind: 'ffa' as const, count, mode: 'A' as const };
  const result = emptyResult(scenario);
  for (let index = 0; index < runs; index += 1) {
    const seed = scenarioSeed(`Q-ffa-${count}`, level, margins, index);
    const random = seededRandom(seed ^ 0x27d4eb2f);
    const base = simulate(config, 'current', NOISE[level], seed, model);
    const units = extractUnits(base);
    const fewest = Math.min(...units.map((unit) => unit.seats));
    if (!sameOrder(base, units)) result.orderMismatches += 1;
    addTopTwo(result, units);
    addScaledOrders(result, units);
    for (const cut of CUTS) {
      let referenceKept = 0;
      for (const option of STUDY_ORDER) {
        // `QR` is not reported, but its placebo draw keeps the later options' draws those of the study.
        const cell = option === 'QR' ? emptyCell() : result.cells[cut][option as TopOption];
        const kept = addQualification(cell, option, units, (unit) => unit.seats > fewest, random, cut);
        if (option === 'Q0') referenceKept = kept;
        else recordDifference(cell.real, kept, referenceKept);
      }
    }
  }
  return result;
}

/** A paired difference of shares: mean and two standard errors, in the share's own units (0–1). */
export function pairedShare(share: PairedShare): { difference: number; error: number } {
  const { sum, sumSquares, count } = share.difference;
  const mean = sum / count;
  const variance = (sumSquares - count * mean * mean) / (count - 1);
  return { difference: mean, error: 2 * Math.sqrt(Math.max(variance, 0) / count) };
}

// ---------------------------------------------------------------------------------------------------------------
// Trial

const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`;

function cellLine(cell: QCell, option: TopOption, cut: number): string {
  const found = summarise(cell.real);
  const gap = Number.isNaN(found.gap) ? 'n/a' : `${signed(found.gap)} ± ${found.error.toFixed(1)}`;
  const kept =
    option === 'Q0'
      ? `${found.kept.toFixed(2)}/${cut}`
      : `Δ${signed(found.keptDifference, 2)} ± ${found.keptDifferenceError.toFixed(2)}`;
  return `${option.padEnd(4)} gap ${gap} · top-${cut} kept ${kept} · tie ${Math.round((100 * cell.tieDecided) / cell.runs)}%`;
}

function describe(result: TopCutResult, control: boolean): string[] {
  const { count, runs } = result.scenario;
  const lines = [
    `## FFA ${count}${control ? ' (control)' : ''}, ${runs} runs, Q0 order vs engine: ${result.orderMismatches} mismatching runs; scaled order equals plain: QS ${result.sameAsPlain.QS}, QH ${result.sameAsPlain.QH}, QSc ${result.sameAsPlain.QSc} of ${runs}`,
  ];
  for (const cut of CUTS) {
    lines.push(`cut ${cut}:`);
    for (const option of TOP_OPTIONS) lines.push(`  ${cellLine(result.cells[cut][option], option, cut)}`);
  }
  const top2 = TOP_OPTIONS.map((option) => {
    const share = result.top2[option];
    if (option === 'Q0') return `Q0 ${((100 * share.hits) / runs).toFixed(1)}%`;
    const paired = pairedShare(share);
    return `${option} Δ${signed(100 * paired.difference)} ± ${(100 * paired.error).toFixed(1)}`;
  });
  lines.push(`best unit in the top 2 (points of runs): ${top2.join(', ')}`);
  return lines;
}

function trial(runs: number): void {
  const level: Level = 'ffa-like';
  for (const [count, control] of [
    [37, false],
    [43, false],
    [32, true],
  ] as Array<[number, boolean]>) {
    console.log(describe(runTopCutScenario({ count, level, margins: 'little', runs }), control).join('\n'));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Jobs, the reproduction check

export interface TopCutJob {
  count: number;
  /** An equal-room scenario: accuracy and ties only. */
  control: boolean;
  level: Level;
  margins: Margins;
}

export function topCutJobs(): TopCutJob[] {
  const jobs: TopCutJob[] = [];
  for (const [count, control] of [
    [37, false],
    [43, false],
    [32, true],
    [40, true],
  ] as Array<[number, boolean]>) {
    for (const level of ['ffa-like', 'team-like'] as Level[]) {
      for (const margins of ['little', 'nothing'] as Margins[]) jobs.push({ count, control, level, margins });
    }
  }
  return jobs;
}

export const topCutKey = (job: TopCutJob) => `T-ffa-${job.count}-${job.level}-${job.margins}`;
/** The study's saved job of the same scenario. */
const studyKey = (job: TopCutJob) => `Q-ffa-${job.count}-${job.level}-${job.margins}`;

export interface TopCutJobResult {
  job: TopCutJob;
  result: TopCutResult;
}

/** At the study's cut, every reported option's cell equals the study's saved cell, counts and all. Returns the differences. */
export function reproductionDifferences(
  saved: TopCutJobResult,
  studyJob: { result: { cells: Record<string, unknown>; orderMismatches: number } },
): string[] {
  const differences: string[] = [];
  for (const option of TOP_OPTIONS) {
    const mine = saved.result.cells[REPRODUCTION_CUT][option];
    const theirs = studyJob.result.cells[option] as QCell;
    for (const part of ['real', 'placebo', 'tieDecided', 'runs'] as const) {
      if (JSON.stringify(mine[part]) !== JSON.stringify(theirs[part])) differences.push(`${option}.${part}`);
    }
  }
  if (saved.result.orderMismatches !== studyJob.result.orderMismatches) differences.push('orderMismatches');
  return differences;
}

const args = process.argv.slice(2);

function option(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function simulateShard(): void {
  const runs = Number(option('--runs', '3000'));
  const out = option('--out') as string;
  const [shard, shards] = (option('--shard', '0/1') as string).split('/').map(Number);
  const only = option('--only');
  mkdirSync(out, { recursive: true });
  const jobs = topCutJobs()
    .filter((job) => !only || topCutKey(job).startsWith(only))
    .filter((_, index) => index % shards === shard);
  for (const job of jobs) {
    const path = join(out, `${topCutKey(job)}.json`);
    if (existsSync(path)) continue;
    const started = Date.now();
    const { count, level, margins } = job;
    writeFileSync(path, JSON.stringify({ job, result: runTopCutScenario({ count, level, margins, runs }) }));
    console.log(`${topCutKey(job)}: ${runs} runs in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

function checkReproduction(): void {
  const [dir, studyDir] = [option('--check24') as string, args[args.indexOf('--check24') + 2]];
  for (const job of topCutJobs()) {
    const mine = join(dir, `${topCutKey(job)}.json`);
    const theirs = join(studyDir, `${studyKey(job)}.json`);
    if (!existsSync(mine) || !existsSync(theirs)) {
      console.log(`${topCutKey(job)}: missing`);
      continue;
    }
    const differences = reproductionDifferences(
      JSON.parse(readFileSync(mine, 'utf8')),
      JSON.parse(readFileSync(theirs, 'utf8')),
    );
    console.log(
      `${topCutKey(job)}: ${differences.length === 0 ? 'identical to the study' : `DIFFERENT: ${differences.join(', ')}`}`,
    );
  }
}

if (args.includes('--trial')) trial(Number(option('--runs', '300')));
else if (args.includes('--check24')) checkReproduction();
else if (args.includes('--out')) simulateShard();
