import { NEUTRAL_OPTIONS, NEUTRAL_RULES, type EOption } from './cut-rules';
import { summarise, type Accumulator } from './elim-measures';
import { allUnitsGap, fairShare } from './neutral-measures';
import {
  changes,
  gapText,
  keptText,
  label,
  MAIN,
  percent,
  row,
  signed,
  tableHead,
  VARIANTS,
  type Column,
  type Probe,
  type Variant,
} from './report-fairness';
import type { Cell, EResult } from './run-e';
import type { Kind } from './simulate';
import { jobKey, type Job, type JobResult } from './study-jobs';

/**
 * Writes the results of the neutral elimination cut (`plans/2026-10-25-neutral-elimination-cut.md`) from the saved jobs
 * of `run-neutral.ts`. Numbers and plain observations only: no recommendation.
 */

type Results = Map<string, JobResult>;

const COLUMNS: Column[] = [
  ...[17, 25, 31, 37, 43, 53].map((count) => ({ kind: '2v2v2v2' as Kind, count })),
  ...[37, 43, 53].map((count) => ({ kind: 'ffa' as Kind, count })),
];
const CONTROLS: Column[] = [
  { kind: '2v2v2v2', count: 16 },
  { kind: '2v2v2v2', count: 24 },
  { kind: 'ffa', count: 32 },
  { kind: 'ffa', count: 40 },
];

/** The average-unit gaps of the plan's table (smaller rooms minus larger, points, random places) for the first mixed cut. */
const EXPECTED: Record<string, { E2r: number; E2c: number }> = {
  '2v2v2v2 17': { E2r: -9.7, E2c: 2.1 },
  '2v2v2v2 31': { E2r: 17.9, E2c: -0.6 },
  '2v2v2v2 37': { E2r: -4.4, E2c: 3.0 },
  '2v2v2v2 53': { E2r: -1.8, E2c: 4.9 },
  'FFA 37': { E2r: -0.3, E2c: 5.2 },
  'FFA 43': { E2r: -7.5, E2c: 0.2 },
};

function find(results: Results, column: Column, variant: Variant, control = false): EResult | undefined {
  const job: Job = {
    shape: 'E',
    kind: column.kind,
    count: column.count,
    control,
    level: variant.level(column.kind),
    margins: variant.margins,
  };
  return results.get(jobKey(job))?.result as EResult | undefined;
}

function summary(result: EResult | undefined, option: EOption, round: number, placebo = false) {
  const cell = result?.cells[round]?.[option];
  return cell ? summarise(placebo ? cell.placebo : cell.real) : undefined;
}

function cellText(result: EResult | undefined, option: EOption, round: number): string {
  const found = summary(result, option, round);
  if (!found || !result) return 'not run';
  return `${gapText(found)} · ${keptText(found, option === 'E0', result.shapes[round].k)}`;
}

function roomsText(rooms: number[]): string {
  return [...rooms].sort((a, b) => b - a).join(',');
}

/** The share of rounds in which the leftover elimination fell on the smaller rooms, or why there is none. */
function leftoverText(cell: Cell): string {
  return cell.leftover.rounds === 0 ? 'no leftover' : percent(cell.leftover.toSmaller, cell.leftover.rounds);
}

function fractionText(result: EResult, round: number): string {
  const share = fairShare(result.shapes[round]);
  return share ? `${share.fair.toFixed(2)} (fraction ${share.fraction.toFixed(2)})` : 'equal rooms';
}

function table(results: Results, variant: Variant, round = 0): string[] {
  const found = COLUMNS.map((column) => find(results, column, variant));
  const lines = tableHead(COLUMNS);
  for (const option of NEUTRAL_OPTIONS)
    lines.push(
      row(
        option,
        found.map((result) => cellText(result, option, round)),
      ),
    );
  const placebo = found.map((result) => {
    const placeboSummary = summary(result, 'E0', round, true);
    return placeboSummary ? gapText(placeboSummary) : 'not run';
  });
  lines.push(row('placebo (E0)', placebo));
  return lines;
}

function shapeLines(results: Results, variant: Variant): string[] {
  return COLUMNS.flatMap((column) => {
    const result = find(results, column, variant);
    if (!result?.shapes[0]) return [];
    const shape = result.shapes[0];
    const cells = result.cells[0];
    const lucky =
      shape.lucky === 0
        ? ', no lucky losers'
        : ` + ${shape.lucky} lucky ${shape.lucky === 1 ? 'loser' : 'losers'}`;
    const same = (['ER', ...NEUTRAL_RULES] as EOption[])
      .map((option) => `${option} ${percent(cells[option].sameAsE0, cells[option].rounds)}`)
      .join(', ');
    const leftover = NEUTRAL_RULES.map((rule) => `${rule} ${leftoverText(cells[rule])}`).join(', ');
    const fraction = fairShare(shape);
    const target = fraction ? `${Math.round(100 * fraction.fraction)}%` : 'n/a';
    return [
      `- **${label(column)}**: k ${shape.k}, rooms [${roomsText(shape.rooms)}], ${shape.perRoom} per room${lucky}; the smaller rooms' fair share of the eliminations ${fractionText(result, 0)}; same set as E0 in: ${same}.`,
      `  Leftover to the smaller rooms: ${leftover} (proportional target ${target}).`,
    ];
  });
}

function controlLines(results: Results, variant: Variant): string[] {
  const parts = CONTROLS.flatMap((column) => {
    const result = find(results, column, variant, true);
    const cells = result?.cells[0];
    if (!result || !cells) return [];
    const same = NEUTRAL_RULES.map((rule) => percent(cells[rule].sameAsE0, cells[rule].rounds)).join('/');
    return [
      `${label(column)}: ${same} (top-k kept ${cells.E0 ? summarise(cells.E0.real).kept.toFixed(2) : 'n/a'}/${result.shapes[0].k})`,
    ];
  });
  return [
    `Equal-room controls, share of runs in which E2r/E2c/E2p advance exactly E0's set: ${parts.join('; ') || 'not run'}.`,
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Where the other level or margins change a conclusion

function probe(results: Results): (variant: Variant, column: Column, option: string) => Probe | undefined {
  return (variant, column, option) => {
    const found = summary(find(results, column, variant), option as EOption, 0);
    return found && !Number.isNaN(found.gap) ? { gap: found.gap, error: found.error } : undefined;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Appendix

function allUnitsTable(results: Results, variant: Variant): string[] {
  const lines = tableHead(COLUMNS);
  for (const option of NEUTRAL_OPTIONS) {
    const cells = COLUMNS.map((column) => {
      const cell = find(results, column, variant)?.cells[0]?.[option];
      if (!cell) return 'not run';
      const gap = allUnitsGap(cell.all);
      return `${signed(gap.gap)} ± ${gap.error.toFixed(1)}`;
    });
    lines.push(row(option, cells));
  }
  const expected = COLUMNS.map((column) => {
    const found = EXPECTED[label(column)];
    return found ? `E2r ${signed(found.E2r)}, E2c ${signed(found.E2c)}` : 'not in the plan';
  });
  lines.push(row("plan's table", expected));
  return lines;
}

function checkLines(results: Results): string[] {
  const all = [...results.values()];
  const mismatches = all.reduce((sum, entry) => sum + (entry.result as EResult).mismatches, 0);
  const totals = { count: 0, share: 0, winnersOut: 0 };
  let controlRuns = 0;
  let controlSame = 0;
  for (const { job, result } of all) {
    for (const cells of (result as EResult).cells) {
      for (const option of NEUTRAL_OPTIONS) {
        totals.count += cells[option].breaches.count;
        totals.share += cells[option].breaches.share;
        totals.winnersOut += cells[option].breaches.winnersOut;
      }
      if (!job.control) continue;
      for (const rule of NEUTRAL_RULES) {
        controlRuns += cells[rule].rounds;
        controlSame += cells[rule].sameAsE0;
      }
    }
  }
  return [
    `- **Engine equivalence:** the tool's E0 against the engine's advancing set in every measured round: ${mismatches} mismatches in ${all.length} jobs.`,
    `- **Equal rooms:** on the controls (${all.filter((entry) => entry.job.control).length} jobs) every E2 rule gave exactly E0's set in ${controlSame} of ${controlRuns} rounds.`,
    `- **Counts:** rounds in which a rule advanced a number other than k: ${totals.count}; rounds in which an E2 rule took fewer than floor(e_g) or more than floor(e_g) + 1 from a group: ${totals.share}; units that won their room but were eliminated, all rules: ${totals.winnersOut}.`,
    `- **Placebo:** ${placeboSummary(all)}`,
  ];
}

function placeboSummary(all: JobResult[]): string {
  let cells = 0;
  let inside = 0;
  const check = (accumulator: Accumulator) => {
    const found = summarise(accumulator);
    if (Number.isNaN(found.gap)) return;
    cells += 1;
    if (Math.abs(found.gap) <= found.error) inside += 1;
  };
  for (const { job, result } of all) {
    if (job.control) continue;
    for (const round of (result as EResult).cells)
      for (const option of NEUTRAL_OPTIONS) check(round[option].placebo);
  }
  return `${inside} of ${cells} placebo gaps (${percent(inside, cells)}) lie within ±2 SE of 0 (aim: at least 95%).`;
}

/** Every measured round: the shape, the smaller rooms' fair share, each rule's gap and the leftover next to its fraction. */
function roundLines(results: Results): string[] {
  const lines: string[] = [];
  for (const column of COLUMNS) {
    const result = find(results, column, MAIN);
    if (!result) continue;
    lines.push(
      `**${label(column)}** (own level, margins "a little")`,
      '',
      "| round | shape | smaller rooms' fair share | " +
        NEUTRAL_OPTIONS.join(' | ') +
        ' | leftover to smaller: E2r / E2c / E2p |',
      '| --- | --- | --- | ' + NEUTRAL_OPTIONS.map(() => '---').join(' | ') + ' | --- |',
    );
    result.cells.forEach((cells, round) => {
      const shape = result.shapes[round];
      const leftover = NEUTRAL_RULES.map((rule) => leftoverText(cells[rule])).join(' / ');
      lines.push(
        `| ${round + 1} | k ${shape.k}, [${roomsText(shape.rooms)}], ${shape.perRoom}+${shape.lucky} | ${fractionText(result, round)} | ${NEUTRAL_OPTIONS.map((option) => cellText(result, option, round)).join(' | ')} | ${leftover} |`,
      );
    });
    lines.push('');
  }
  return lines;
}

export function writeNeutralReport(results: Results): string {
  const lines: string[] = [
    '# Neutral elimination cut: results',
    '',
    'Report only: numbers and plain observations, no recommendation. Nothing in `src/` changed. Plan: `plans/2026-10-25-neutral-elimination-cut.md`, extending the room-size fairness study (`plans/2026-10-25-room-size-fairness-results.md`, same score model, seeds and measures); tool: `scripts/seeding-simulation/` (`run-neutral.ts`). 3000 runs per cell. This is a separate results file.',
    '',
    '## The rules',
    '',
    "- `E0`: today, per-room advancement plus lucky losers. `ER`: one cut across all rooms by relative score (the study's reference).",
    "- `E2r`, `E2c`, `E2p`: each room-size group is ranked on its own (share beaten, then relative score) and loses `floor(e_g)` of its worst, where `e_g` is its fair share of the eliminations (eliminations × units in the group ÷ units in the round). They differ only in how the one leftover elimination is settled: `E2r` gives it to the group with the larger fractional part (ties: the larger group); `E2c` to the lower relative score of the two groups' next candidates (ties: the lower room number); `E2p` to the lower percentile of that relative score among all units that played in rooms of their size in this tournament so far (ties: relative score, then room number).",
    '',
    '## Main table: first mixed elimination round',
    '',
    'Cells read `gap ± 2 SE · true top-k kept` (E0: absolute, out of k; the others: paired per-run difference to E0, ± 2 SE). Gap = chance to advance of units from a smaller room minus that of units from a larger room, at the same true rank within one largest room size of the cut, in percentage points; positive = the smaller rooms do better. 2v2v2v2 at "team-like", FFA at "FFA-like"; margins "a little".',
    '',
    ...table(results, MAIN),
    '',
    ...shapeLines(results, MAIN),
    '',
    "`E2c` sends the leftover to the smaller rooms more often than a coin flip would (see the leftover line of each column): after the floors, the larger group's next candidate is the best of its remaining units at that level (at 31, the 5th-worst of 7 last places) while the smaller group's is its worst, and a last of 3 scores a little lower relative to its room.",
    '',
    ...controlLines(results, MAIN),
    '',
    'Where the other predictability level or margins "nothing" change a conclusion:',
    '',
    ...changes(COLUMNS, ['ER', ...NEUTRAL_RULES], 'E0', probe(results)),
    '',
    '## Appendix',
    '',
    '### A. Checks',
    '',
    ...checkLines(results),
    '',
    '### B. The average unit: all-units gap, first round',
    '',
    "Every unit of the round, not only the bubble: chance to advance in the smaller rooms minus the larger, points, ± 2 SE (units counted as independent). The last row is the plan's average-unit table (random places), for the cells it covers.",
    '',
    ...allUnitsTable(results, MAIN),
    '',
    '### C. Every measured round, with the leftover next to the fraction',
    '',
    'Own level, margins "a little". In later rounds the field is the strong units only, so the matched-room model (its performance-spread moments come from qualifications) picks flatter real rooms than the real spread of such rounds; read these as indications. The last column is the share of runs in which the leftover elimination fell on the smaller rooms, to be read against the fraction in the third column.',
    '',
    ...roundLines(results),
    '### D. The other level and margins "nothing"',
    '',
    ...VARIANTS.slice(1).flatMap((variant) => [`**${variant.label}**`, '', ...table(results, variant), '']),
  ];
  return lines.join('\n');
}
