import { NEUTRAL_OPTIONS, type EOption } from './cut-rules';
import { allUnitsGap, fairShare } from './neutral-measures';
import { runEScenario, type Cell, type EResult } from './run-e';
import { summarise } from './elim-measures';
import { OWN_LEVEL } from './score-model';
import type { Kind } from './simulate';

/**
 * The neutral elimination cut (`plans/2026-10-25-neutral-elimination-cut.md`), trial of stage 1:
 *   pnpm exec tsx scripts/seeding-simulation/run-neutral.ts --trial [--runs 300]
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
if (args.includes('--trial')) trial(Number(args[args.indexOf('--runs') + 1] || 300));
