import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { summarise } from './elim-measures';
import { writeTopCutReport } from './report-top-cut';
import type { Level } from './score-model';
import {
  CUTS,
  loadTopCutResults,
  pairedShare,
  reproductionLines,
  runTopCutScenario,
  topCutJobs,
  topCutKey,
  TOP_OPTIONS,
  type TopCutResult,
  type TopOption,
} from './top-cut';
import type { QCell } from './run-q';

/**
 * The two FFA points tables with a cut near the top (`plans/2026-10-25-ffa-table-top-cut.md`). Report only. Not part of `pnpm test`.
 *   trial:    pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --trial [--runs 300]
 *   simulate: pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --runs 3000 --out <dir> [--shard 0/4] [--only T-ffa-37]
 *   check:    pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --check24 <dir of saved jobs> <dir of the study's saved jobs>
 *   report:   pnpm exec tsx scripts/seeding-simulation/run-top-cut.ts --report <dir> <report.md> --study <dir of the study's saved jobs>
 */

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

function report(): void {
  const [dir, target] = [option('--report') as string, args[args.indexOf('--report') + 2]];
  const studyDir = option('--study') as string;
  writeFileSync(target, writeTopCutReport(loadTopCutResults(dir), reproductionLines(dir, studyDir)));
  console.log(`wrote ${target}`);
}

if (args.includes('--trial')) trial(Number(option('--runs', '300')));
else if (args.includes('--check24'))
  console.log(
    reproductionLines(option('--check24') as string, args[args.indexOf('--check24') + 2]).join('\n'),
  );
else if (args.includes('--report')) report();
else if (args.includes('--out')) simulateShard();
