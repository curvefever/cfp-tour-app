import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFairnessReport } from './report-fairness';
import { runEScenario } from './run-e';
import { runQScenario } from './run-q';
import { scenarioSeed } from './random';
import { NOISE, OWN_LEVEL } from './score-model';
import { allJobs, jobKey, type Job, type JobResult } from './study-jobs';
import { simulate, type Kind } from './simulate';
import type { Policy } from './policies';

/**
 * The room-size fairness study (`plans/2026-10-25-room-size-fairness-simulation.md`). Report only: nothing in `src/` changes.
 *   simulate (one shard of the jobs, each job saved as <dir>/<key>.json; saved jobs are skipped):
 *     pnpm exec tsx scripts/seeding-simulation/run-study.ts --runs 3000 --out <dir> [--shard 0/7] [--only E-ffa-37]
 *   the report:
 *     pnpm exec tsx scripts/seeding-simulation/run-study.ts --report <dir> <report.md> [--calibration <real.txt> <fit.txt>]
 *   the rebuilt-draw check:
 *     pnpm exec tsx scripts/seeding-simulation/run-study.ts --draw-check [--runs 40]
 * Not part of `pnpm test`.
 */

function runJob(job: Job, runs: number): JobResult {
  const { kind, count, level, margins } = job;
  if (job.shape === 'Q') return { job, result: runQScenario({ kind, count, level, margins, runs }) };
  const scenario = { kind, count, level, margins, runs, rounds: job.control ? 1 : 99, control: job.control };
  return { job, result: runEScenario(scenario) };
}

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function simulateShard(args: string[]): void {
  const runs = Number(option(args, '--runs', '3000'));
  const out = option(args, '--out');
  if (!out) throw new Error('--out <dir> is required');
  const [shard, shards] = (option(args, '--shard', '0/1') as string).split('/').map(Number);
  const only = option(args, '--only');
  mkdirSync(out, { recursive: true });
  const jobs = allJobs()
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

export function loadResults(dir: string): Map<string, JobResult> {
  const results = new Map<string, JobResult>();
  for (const job of allJobs()) {
    const path = join(dir, `${jobKey(job)}.json`);
    if (existsSync(path)) results.set(jobKey(job), JSON.parse(readFileSync(path, 'utf8')) as JobResult);
  }
  return results;
}

/** The engine's draw rebuilt from its pieces against the engine's own, over whole qualifications. */
export function drawCheck(runs: number): string[] {
  const fields: Array<[Kind, number]> = [
    ['ffa', 37],
    ['ffa', 43],
    ['2v2v2v2', 25],
    ['2v2v2v2', 31],
    ['2v2v2v2', 53],
  ];
  return fields.map(([kind, count]) => {
    const level = OWN_LEVEL[kind];
    const lineUps = (policy: Policy, seed: number) =>
      JSON.stringify(
        simulate({ kind, count, mode: 'A' }, policy, NOISE[level], seed).finalState.assignments.map((round) =>
          round.map((entry) => [entry.name, entry.room]),
        ),
      );
    let different = 0;
    for (let run = 0; run < runs; run += 1) {
      const seed = scenarioSeed(`draw-${kind}-${count}`, level, 'none', run);
      if (lineUps('current', seed) !== lineUps('engine-like', seed)) different += 1;
    }
    return `${kind} ${count}: ${different} of ${runs} qualifications with a different line-up`;
  });
}

function report(args: string[]): void {
  const dir = option(args, '--report');
  const target = args[args.indexOf('--report') + 2];
  if (!dir || !target) throw new Error('usage: --report <dir> <report.md>');
  const calibration = args.includes('--calibration')
    ? args
        .slice(args.indexOf('--calibration') + 1, args.indexOf('--calibration') + 3)
        .map((path) => readFileSync(path, 'utf8'))
    : [];
  writeFileSync(target, writeFairnessReport(loadResults(dir), drawCheck(40), calibration));
  console.log(`wrote ${target}`);
}

const args = process.argv.slice(2);
if (args.includes('--draw-check')) console.log(drawCheck(Number(option(args, '--runs', '40'))).join('\n'));
else if (args.includes('--report')) report(args);
else if (args.includes('--out')) simulateShard(args);
