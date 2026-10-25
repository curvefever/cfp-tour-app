import { summarise } from './elim-measures';
import {
  beyond,
  gapText,
  keptText,
  percent,
  row,
  signed,
  VARIANTS,
  MAIN,
  type Probe,
  type Variant,
} from './report-fairness';
import {
  pairedShare,
  REPRODUCTION_CUT,
  topCutKey,
  TOP_OPTIONS,
  type TopCutJob,
  type TopCutJobResult,
  type TopCutResult,
  type TopOption,
} from './top-cut';

/**
 * Writes the results of the FFA top-cut study (`plans/2026-10-25-ffa-table-top-cut.md`) from the saved jobs of
 * `run-top-cut.ts`. Numbers and plain observations only: no recommendation.
 */

type Results = Map<string, TopCutJobResult>;

interface Column {
  count: number;
  cut: number;
}

const COLUMNS: Column[] = [
  { count: 37, cut: 8 },
  { count: 37, cut: 16 },
  { count: 43, cut: 8 },
  { count: 43, cut: 16 },
];
const CONTROL_COLUMNS: Column[] = [
  { count: 32, cut: 8 },
  { count: 32, cut: 16 },
  { count: 40, cut: 8 },
  { count: 40, cut: 16 },
];
const REPRODUCTION_COLUMNS: Column[] = [37, 43].map((count) => ({ count, cut: REPRODUCTION_CUT }));

const label = (column: Column) => `FFA ${column.count}, cut ${column.cut}`;

function find(results: Results, count: number, variant: Variant, control = false): TopCutResult | undefined {
  const job: TopCutJob = { count, control, level: variant.level('ffa'), margins: variant.margins };
  return results.get(topCutKey(job))?.result;
}

function cellOf(result: TopCutResult | undefined, column: Column, option: TopOption) {
  return result?.cells[column.cut]?.[option];
}

function cellText(result: TopCutResult | undefined, column: Column, option: TopOption): string {
  const cell = cellOf(result, column, option);
  if (!cell) return 'not run';
  const found = summarise(cell.real);
  return `${gapText(found)} · ${keptText(found, option === 'Q0', column.cut)} · ${percent(cell.tieDecided, cell.runs)}`;
}

function tableHead(columns: Column[]): string[] {
  return [
    row('', columns.map(label)),
    row(
      '---',
      columns.map(() => '---'),
    ),
  ];
}

function table(results: Results, variant: Variant, columns: Column[], placebo = true): string[] {
  const lines = tableHead(columns);
  for (const option of TOP_OPTIONS)
    lines.push(
      row(
        option,
        columns.map((column) =>
          cellText(find(results, column.count, variant, columns === CONTROL_COLUMNS), column, option),
        ),
      ),
    );
  if (placebo)
    lines.push(
      row(
        'placebo (Q0)',
        columns.map((column) => {
          const cell = cellOf(find(results, column.count, variant), column, 'Q0');
          return cell ? gapText(summarise(cell.placebo)) : 'not run';
        }),
      ),
    );
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------
// The top-2 share

/** How many runs the option's top-2 hit differs from Q0's: each difference is +1 or -1, so the sum of squares counts them. */
function differing(result: TopCutResult, option: TopOption): number {
  return result.top2[option].difference.sumSquares;
}

function top2Text(result: TopCutResult | undefined): string {
  if (!result) return 'not run';
  const runs = result.scenario.runs;
  const parts = TOP_OPTIONS.filter((option) => option !== 'Q0').map((option) => {
    const paired = pairedShare(result.top2[option]);
    const same =
      differing(result, option) === 0
        ? 'same as Q0 in every run'
        : `${differing(result, option)} runs differ`;
    return `${option} Δ${signed(100 * paired.difference)} ± ${(100 * paired.error).toFixed(1)} (${same})`;
  });
  return `Q0 ${((100 * result.top2.Q0.hits) / runs).toFixed(1)}%; ${parts.join('; ')}`;
}

function top2Lines(results: Results, variant: Variant): string[] {
  return [37, 43].map((count) => `- FFA ${count}: ${top2Text(find(results, count, variant))}`);
}

function tenths(part: number, whole: number): string {
  return `${((100 * part) / whole).toFixed(1)}%`;
}

/** The community table against Standard points: in how many runs of how many their top-2 results differ. */
function top2Sentence(results: Results): string {
  const sum = (control: boolean) => {
    let differs = 0;
    let runs = 0;
    for (const { job, result } of results.values()) {
      if (job.control !== control) continue;
      differs += differing(result, 'Q0c');
      runs += result.scenario.runs;
    }
    return { differs, runs };
  };
  const main = sum(false);
  const controls = sum(true);
  const mainText =
    main.differs === 0
      ? `equals Standard points' in every one of the ${main.runs} runs of the main scenarios (4 level/margin settings × FFA 37, 43)`
      : `differs from Standard points' in ${main.differs} of ${main.runs} runs of the main scenarios (${tenths(main.differs, main.runs)}; the other level or margins "nothing" included, so not equal in every run)`;
  return `The community table's top-2 share ${mainText}; in the equal-room controls (FFA 32, 40) the two differ in ${controls.differs} of ${controls.runs} runs (${tenths(controls.differs, controls.runs)}).`;
}

// ---------------------------------------------------------------------------------------------------------------
// Where the other level or margins change a conclusion

function probe(results: Results) {
  return (variant: Variant, column: Column, option: TopOption): Probe | undefined => {
    const cell = cellOf(find(results, column.count, variant), column, option);
    if (!cell) return undefined;
    const found = summarise(cell.real);
    return Number.isNaN(found.gap) ? undefined : { gap: found.gap, error: found.error };
  };
}

/** A sign flip of a gap that is beyond its own error on both sides, or a difference to Q0 that appears or disappears beyond 2 SE. */
function changeLines(results: Results): string[] {
  const read = probe(results);
  const events: Array<{ size: number; text: string }> = [];
  for (const column of COLUMNS) {
    for (const option of TOP_OPTIONS.filter((candidate) => candidate !== 'Q0')) {
      const main = read(MAIN, column, option);
      const base = read(MAIN, column, 'Q0');
      if (!main || !base) continue;
      for (const variant of VARIANTS.slice(1)) {
        const alt = read(variant, column, option);
        const altBase = read(variant, column, 'Q0');
        if (!alt || !altBase) continue;
        if (Math.abs(main.gap) > main.error && Math.abs(alt.gap) > alt.error && main.gap * alt.gap < 0) {
          events.push({
            size: Math.abs(main.gap - alt.gap),
            text: `${label(column)}, ${option}: gap ${signed(main.gap)} at ${MAIN.label}, ${signed(alt.gap)} at ${variant.label} (sign flip)`,
          });
        }
        if (beyond(main, base) !== beyond(alt, altBase)) {
          const verb = beyond(main, base) ? 'differs from' : 'does not differ from';
          const alter = beyond(main, base) ? 'no longer beyond' : 'beyond';
          events.push({
            size: Math.abs(main.gap - base.gap - (alt.gap - altBase.gap)),
            text: `${label(column)}, ${option}: ${verb} Q0 at ${MAIN.label} (${signed(main.gap - base.gap)}), ${alter} 2 SE at ${variant.label} (${signed(alt.gap - altBase.gap)})`,
          });
        }
      }
    }
  }
  const top = events.sort((a, b) => b.size - a.size).slice(0, 5);
  return top.length === 0
    ? ['- No sign flip and no change beyond 2 SE at the other level or at margins "nothing".']
    : top.map((event) => `- ${event.text}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Controls and checks

function controlLines(results: Results): string[] {
  const lines = [
    'Cells read `top-k kept · tie %` (no smaller rooms exist, so no gap); own level, margins "a little".',
    '',
  ];
  lines.push(...tableHeadControls());
  for (const option of TOP_OPTIONS)
    lines.push(
      row(
        option,
        CONTROL_COLUMNS.map((column) => {
          const result = find(results, column.count, MAIN, true);
          const cell = cellOf(result, column, option);
          if (!cell) return 'not run';
          const found = summarise(cell.real);
          return `${keptText(found, option === 'Q0', column.cut)} · ${percent(cell.tieDecided, cell.runs)}`;
        }),
      ),
    );
  return lines;
}

function tableHeadControls(): string[] {
  return tableHead(CONTROL_COLUMNS);
}

function scaledEqualsPlain(results: Results): string {
  let runs = 0;
  const same = { QS: 0, QH: 0, QSc: 0 };
  for (const { job, result } of results.values()) {
    if (!job.control) continue;
    runs += result.scenario.runs;
    for (const option of ['QS', 'QH', 'QSc'] as const) same[option] += result.sameAsPlain[option];
  }
  return `QS ${same.QS}, QH ${same.QH}, QSc ${same.QSc} of ${runs} runs`;
}

function checkLines(results: Results, reproduction: string[]): string[] {
  const all = [...results.values()];
  const mismatches = all.reduce((sum, entry) => sum + entry.result.orderMismatches, 0);
  const identical = reproduction.filter((line) => line.endsWith('identical to the study')).length;
  let cells = 0;
  let inside = 0;
  for (const { job, result } of all) {
    if (job.control) continue;
    for (const byOption of Object.values(result.cells)) {
      for (const option of TOP_OPTIONS) {
        const found = summarise(byOption[option].placebo);
        if (Number.isNaN(found.gap)) continue;
        cells += 1;
        if (Math.abs(found.gap) <= found.error) inside += 1;
      }
    }
  }
  return [
    `- **Reproduction at cut ${REPRODUCTION_CUT}:** Q0, Q0c, QS, QH, QSc (gap counts per rank, placebo counts, tie counts, runs) and the Q0 order check equal the study's saved cells in ${identical} of ${reproduction.length} jobs (the main scenarios and the controls, 4 level/margin settings each).`,
    `- **Engine equivalence:** the tool's Q0 standings against \`computeQualificationStandings\`: ${mismatches} mismatching runs in ${all.length} jobs.`,
    `- **Controls:** scaled order equals the plain option's (QS and QH to Q0, QSc to Q0c) in: ${scaledEqualsPlain(results)}.`,
    `- **Placebo:** ${inside} of ${cells} placebo gaps (${percent(inside, cells)}) lie within ±2 SE of 0 (aim: at least 95%).`,
  ];
}

export function writeTopCutReport(results: Results, reproduction: string[]): string {
  const lines: string[] = [
    '# FFA points tables with a cut near the top: results',
    '',
    "Report only: numbers and plain observations, no recommendation. Nothing in `src/` changed. Plan: `plans/2026-10-25-ffa-table-top-cut.md`, extending shape Q of the room-size fairness study (`plans/2026-10-25-room-size-fairness-results.md`: same score model, draw, seeds and measures); tool: `scripts/seeding-simulation/` (`run-top-cut.ts`). 3000 runs per cell; every cut is read from the same runs (the cut is applied after the draw), and the runs are the study's runs.",
    '',
    '## Options',
    '',
    '`Q0` Standard points (8, 7, …, 1; the last place of a smaller room earns nothing); `Q0c` the community table (10, 8, 6, 5, 4, 3, 2, 1, used the same way); `QS` Standard points scaled to the largest room (a room of 7 pays like a room of 8); `QH` scaled and rounded to halves; `QSc` the community table read at the share of opponents beaten.',
    '',
    '## Main table',
    '',
    'FFA-like level, margins "a little". Cells read `gap ± 2 SE · true top-k kept · cut decided by the tie-break`. Gap = chance to qualify of units that had more smaller-room seats than the minimum minus that of the others, same true rank, over the ranks within one largest room size (8) of the cut, in percentage points (positive = the smaller-room seats help). Top-k kept: Q0 absolute out of k, the others the paired per-run difference to Q0 (Δ, ± 2 SE). Tie %: share of runs in which units on equal points straddle the cut.',
    '',
    ...table(results, MAIN, COLUMNS),
    '',
    'The best unit finishing in the top 2 of the standings (the cut-8 columns; the standings do not depend on the cut), Q0 absolute and the others as the paired difference in points of runs ± 2 SE:',
    '',
    ...top2Lines(results, MAIN),
    '',
    top2Sentence(results),
    '',
    '**Equal-room controls** (FFA 32 and 40):',
    '',
    ...controlLines(results),
    '',
    'Where the other predictability level or margins "nothing" change a conclusion:',
    '',
    ...changeLines(results),
    '',
    '## Appendix',
    '',
    '### A. Checks',
    '',
    ...checkLines(results, reproduction),
    '',
    '### B. The other level and margins "nothing"',
    '',
    ...VARIANTS.slice(1).flatMap((variant) => [
      `**${variant.label}**`,
      '',
      ...table(results, variant, COLUMNS),
      '',
      ...top2Lines(results, variant),
      '',
    ]),
    "### C. The cut at 24 (the study's cut, reproduced)",
    '',
    ...VARIANTS.flatMap((variant) => [
      `**${variant.label}**`,
      '',
      ...table(results, variant, REPRODUCTION_COLUMNS),
      '',
    ]),
  ];
  return lines.join('\n');
}
