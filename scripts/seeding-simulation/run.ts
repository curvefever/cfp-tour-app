import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addCarry, emptyCell, measure, METRICS, type Cell } from './metrics';
import { POLICIES, type Policy } from './policies';
import { runSeed } from './random';
import { writeReport } from './report';
import { configKey, simulate, type Config, type Kind, type Mode } from './simulate';

/**
 * Seeding simulation on the real engine. Run (simulate, one shard of the jobs):
 *   pnpm exec tsx scripts/seeding-simulation/run.ts --runs 300 --out <dir> [--shard 0/4] [--only ffa-37]
 * then merge the shards into the markdown report:
 *   pnpm exec tsx scripts/seeding-simulation/run.ts --report <dir> <report.md>
 * Not part of `pnpm test`. Results are not a recommendation: see the report's header.
 */

const COUNTS: Record<Kind, number[]> = { '2v2v2v2': [25, 31, 37, 43, 53], ffa: [37, 43, 53] };
const MODES: Mode[] = ['A', 'B'];
export const NOISES = [0.7, 1.2];

export interface Job {
  config: Config;
  noise: number;
}

export interface JobResult extends Job {
  runs: number;
  cells: Record<Policy, Cell>;
}

function allJobs(): Job[] {
  const kinds = Object.keys(COUNTS) as Kind[];
  return kinds.flatMap((kind) =>
    COUNTS[kind].flatMap((count) =>
      MODES.flatMap((mode) => NOISES.map((noise) => ({ config: { kind, count, mode }, noise }))),
    ),
  );
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function runJob(job: Job, runs: number): JobResult {
  const cells = Object.fromEntries(POLICIES.map((policy) => [policy, emptyCell()])) as Record<Policy, Cell>;
  for (let run = 0; run < runs; run += 1) {
    const seed = runSeed(configKey(job.config), job.noise, run);
    for (const policy of POLICIES) {
      const result = simulate(job.config, policy, job.noise, seed);
      const cell = cells[policy];
      const values = measure(job.config, result);
      for (const key of METRICS) cell.sums[key] += values[key];
      if (job.config.mode === 'A') addCarry(cell.carry, result);
      cell.runs += 1;
    }
  }
  return { ...job, runs, cells };
}

function simulateShard(args: string[]): void {
  const runs = Number(option(args, '--runs') ?? 300);
  const out = option(args, '--out');
  if (!out) throw new Error('--out <dir> is required');
  const [shard, shards] = (option(args, '--shard') ?? '0/1').split('/').map(Number);
  const only = option(args, '--only');
  const jobs = allJobs()
    .filter((job) => !only || configKey(job.config).startsWith(only))
    .filter((_, index) => index % shards === shard);
  mkdirSync(out, { recursive: true });
  const results: JobResult[] = [];
  for (const job of jobs) {
    const started = Date.now();
    results.push(runJob(job, runs));
    console.log(`${configKey(job.config)} noise ${job.noise}: ${runs} runs in ${Date.now() - started} ms`);
    writeFileSync(join(out, `shard-${shard}.json`), JSON.stringify(results));
  }
}

function report(args: string[]): void {
  const dir = option(args, '--report');
  const target = args[args.indexOf('--report') + 2];
  if (!dir || !target) throw new Error('usage: --report <dir> <report.md>');
  const results = readdirSync(dir)
    .filter((file) => file.startsWith('shard-') && file.endsWith('.json'))
    .flatMap((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as JobResult[]);
  writeFileSync(target, writeReport(results));
  console.log(`wrote ${target} from ${results.length} jobs`);
}

const args = process.argv.slice(2);
if (args.includes('--report')) report(args);
else simulateShard(args);
