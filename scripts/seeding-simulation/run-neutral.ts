import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEUTRAL_OPTIONS, type EOption } from './cut-rules';
import { neutralJobs } from './neutral-jobs';
import { allUnitsGap, fairShare } from './neutral-measures';
import { writeNeutralReport } from './report-neutral';
import { runEScenario, type Cell, type EResult } from './run-e';
import { summarise } from './elim-measures';
import { OWN_LEVEL } from './score-model';
import type { Kind } from './simulate';
import { jobKey, type Job, type JobResult } from './study-jobs';

/**
 * The neutral elimination cut (`plans/2026-10-25-neutral-elimination-cut.md`):
 *   trial:    pnpm exec tsx scripts/seeding-simulation/run-neutral.ts --trial [--runs 300]
 *   simulate: pnpm exec tsx scripts/seeding-simulation/run-neutral.ts --runs 3000 --out <dir> [--shard 0/6] [--only E-ffa-43]
 *   report:   pnpm exec tsx scripts/seeding-simulation/run-neutral.ts --report <dir> <report.md>
 * Not part of `pnpm test`.
 */

const TRIAL: Array<[Kind, number, boolean]> = [
  ['2v2v2v2', 31, false],
  ['2v2v2v2', 37, false],
  ['ffa', 43, false],
  ['2v2v2v2', 16, true],
  ['ffa', 32, true],
];

function points(value: number, error: number): string {
  return Number.isNaN(value) ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} ±${error.toFixed(1)}`;
}

function describe(result: EResult): string[] {
  const { kind, count, control, runs } = { ...result.scenario };
  const lines = [
    `## ${kind} ${count}${control ? ' (control)' : ''}, ${runs} runs, E0 against the engine: ${result.mismatches} mismatches`,
  ];
  result.cells.forEach((cells, round) => {
    const shape = result.shapes[round];
    const share = fairShare(shape);
    lines.push(
      `round ${round + 1}: k ${shape.k}, rooms [${shape.rooms.join(',')}], ${shape.perRoom} per room + ${shape.lucky} lucky` +
        (share
          ? `, smaller rooms' fair share ${share.fair.toFixed(2)} (fraction ${share.fraction.toFixed(2)})`
          : ''),
    );
    for (const option of NEUTRAL_OPTIONS) lines.push(`  ${row(cells[option], option)}`);
  });
  return lines;
}

function row(cell: Cell, option: EOption): string {
  const bubble = summarise(cell.real);
  const all = allUnitsGap(cell.all);
  const leftover =
    cell.leftover.rounds === 0
      ? ''
      : `, leftover to smaller ${((100 * cell.leftover.toSmaller) / cell.leftover.rounds).toFixed(0)}% of ${cell.leftover.rounds}`;
  const kept =
    option === 'E0' ? `${bubble.kept.toFixed(2)}` : points(bubble.keptDifference, bubble.keptDifferenceError);
  return (
    `${option.padEnd(4)} bubble gap ${points(bubble.gap, bubble.error)}, all units ${points(all.gap, all.error)}, ` +
    `top-k kept ${kept}, same as E0 ${((100 * cell.sameAsE0) / cell.rounds).toFixed(0)}%${leftover}, ` +
    `breaches ${cell.breaches.count}/${cell.breaches.share}/${cell.breaches.winnersOut}`
  );
}

function trial(runs: number): void {
  for (const [kind, count, control] of TRIAL) {
    const scenario = {
      kind,
      count,
      level: OWN_LEVEL[kind],
      margins: 'little' as const,
      runs,
      rounds: control ? 1 : 99,
      control,
    };
    console.log(describe(runEScenario(scenario)).join('\n'));
  }
}

const args = process.argv.slice(2);

function option(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function runJob(job: Job, runs: number): JobResult {
  const { kind, count, level, margins, control } = job;
  return {
    job,
    result: runEScenario({ kind, count, level, margins, runs, rounds: control ? 1 : 99, control }),
  };
}

function simulateShard(): void {
  const runs = Number(option('--runs', '3000'));
  const out = option('--out') as string;
  const [shard, shards] = (option('--shard', '0/1') as string).split('/').map(Number);
  const only = option('--only');
  mkdirSync(out, { recursive: true });
  const jobs = neutralJobs()
    .filter((job) => !only || jobKey(job).startsWith(only))
    .filter((_, index) => index % shards === shard);
  for (const job of jobs) {
    const path = join(out, `${jobKey(job)}.json`);
    if (existsSync(path)) continue;
    const started = Date.now();
    writeFileSync(path, JSON.stringify(runJob(job, runs)));
    console.log(`${jobKey(job)}: ${runs} runs in ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

function report(): void {
  const dir = option('--report') as string;
  const target = args[args.indexOf('--report') + 2];
  const results = new Map<string, JobResult>();
  for (const job of neutralJobs()) {
    const path = join(dir, `${jobKey(job)}.json`);
    if (existsSync(path)) results.set(jobKey(job), JSON.parse(readFileSync(path, 'utf8')) as JobResult);
  }
  writeFileSync(target, writeNeutralReport(results));
  console.log(`wrote ${target}`);
}

if (args.includes('--trial')) trial(Number(option('--runs', '300')));
else if (args.includes('--report')) report();
else if (args.includes('--out')) simulateShard();
