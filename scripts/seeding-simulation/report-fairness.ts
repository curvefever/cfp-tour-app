import { E_OPTIONS, type EOption } from './cut-rules';
import { CUT } from './cuts';
import { summarise, type Accumulator, type Summary } from './elim-measures';
import { Q_OPTIONS, Q_TABLE_OPTIONS, type QOption } from './qualification';
import type { EResult } from './run-e';
import type { QCell, QResult } from './run-q';
import { NOISE, OWN_LEVEL, type Level, type Margins } from './score-model';
import type { Kind } from './simulate';
import { jobKey, type Job, type JobResult, type Shape } from './study-jobs';

/**
 * Writes `plans/2026-10-25-room-size-fairness-results.md` from the saved jobs of `run-study.ts`. Numbers and plain
 * observations only: no recommendation.
 */

type Results = Map<string, JobResult>;

export interface Variant {
  label: string;
  level: (kind: Kind) => Level;
  margins: Margins;
}

const other = (level: Level): Level => (level === 'ffa-like' ? 'team-like' : 'ffa-like');
export const VARIANTS: Variant[] = [
  { label: 'own level, margins "a little"', level: (kind) => OWN_LEVEL[kind], margins: 'little' },
  {
    label: 'the other level, margins "a little"',
    level: (kind) => other(OWN_LEVEL[kind]),
    margins: 'little',
  },
  { label: 'own level, margins "nothing"', level: (kind) => OWN_LEVEL[kind], margins: 'nothing' },
  {
    label: 'the other level, margins "nothing"',
    level: (kind) => other(OWN_LEVEL[kind]),
    margins: 'nothing',
  },
];
export const MAIN = VARIANTS[0];

export interface Column {
  kind: Kind;
  count: number;
}

const E_COLUMNS: Column[] = [
  ...[17, 31, 37, 53].map((count) => ({ kind: '2v2v2v2' as Kind, count })),
  ...[37, 43].map((count) => ({ kind: 'ffa' as Kind, count })),
];
const Q_COLUMNS: Column[] = [
  ...[25, 31, 37, 53].map((count) => ({ kind: '2v2v2v2' as Kind, count })),
  ...[37, 43].map((count) => ({ kind: 'ffa' as Kind, count })),
];
const E_CONTROLS: Column[] = [
  { kind: '2v2v2v2', count: 16 },
  { kind: '2v2v2v2', count: 24 },
  { kind: 'ffa', count: 32 },
  { kind: 'ffa', count: 40 },
];
const Q_CONTROLS: Column[] = [
  { kind: '2v2v2v2', count: 24 },
  { kind: '2v2v2v2', count: 32 },
  { kind: 'ffa', count: 32 },
  { kind: 'ffa', count: 40 },
];

const NAMES: Record<Kind, string> = { '2v2v2v2': '2v2v2v2', ffa: 'FFA' };
export const label = (column: Column) => `${NAMES[column.kind]} ${column.count}`;

function find(results: Results, shape: Shape, column: Column, variant: Variant, control = false) {
  const job: Job = {
    shape,
    kind: column.kind,
    count: column.count,
    control,
    level: variant.level(column.kind),
    margins: variant.margins,
  };
  return results.get(jobKey(job))?.result;
}

const findE = (results: Results, column: Column, variant: Variant, control = false) =>
  find(results, 'E', column, variant, control) as EResult | undefined;
const findQ = (results: Results, column: Column, variant: Variant, control = false) =>
  find(results, 'Q', column, variant, control) as QResult | undefined;

export function signed(value: number, digits = 1): string {
  if (Number.isNaN(value)) return 'n/a';
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`;
}

export function gapText(summary: Summary): string {
  return Number.isNaN(summary.gap) ? 'n/a' : `${signed(summary.gap)} ± ${summary.error.toFixed(1)}`;
}

/** The true top-k kept: the reference option as an absolute value, every other as the paired per-run difference to it. */
export function keptText(summary: Summary, reference: boolean, outOf: number): string {
  if (reference) return `${summary.kept.toFixed(2)}/${outOf}`;
  return `Δ${signed(summary.keptDifference, 2)} ± ${summary.keptDifferenceError.toFixed(2)}`;
}

export function row(name: string, cells: string[]): string {
  return `| ${name} | ${cells.join(' | ')} |`;
}

export function tableHead(columns: Column[]): string[] {
  return [
    row('', columns.map(label)),
    row(
      '---',
      columns.map(() => '---'),
    ),
  ];
}

export function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${Math.round((100 * part) / whole)}%`;
}

// ---------------------------------------------------------------------------------------------------------------
// Shape E

function eSummary(result: EResult | undefined, option: EOption, round: number, placebo = false) {
  const cell = result?.cells[round]?.[option];
  return cell ? summarise(placebo ? cell.placebo : cell.real) : undefined;
}

function eCell(result: EResult | undefined, option: EOption, round: number): string {
  const summary = eSummary(result, option, round);
  if (!summary || !result) return 'not run';
  const k = result.shapes[round].k;
  return `${gapText(summary)} · ${keptText(summary, option === 'E0', k)}`;
}

function eTable(results: Results, variant: Variant, round = 0): string[] {
  const results_ = E_COLUMNS.map((column) => findE(results, column, variant));
  const lines = tableHead(E_COLUMNS);
  for (const option of E_OPTIONS)
    lines.push(
      row(
        option,
        results_.map((result) => eCell(result, option, round)),
      ),
    );
  const placebo = results_.map((result) => {
    const summary = eSummary(result, 'E0', round, true);
    return summary ? gapText(summary) : 'not run';
  });
  lines.push(row('placebo (E0)', placebo));
  return lines;
}

function shapeText(result: EResult, round: number): string {
  const shape = result.shapes[round];
  const rooms = [...shape.rooms].sort((a, b) => b - a).join(',');
  const lucky = shape.lucky > 0 ? ` + ${shape.lucky} lucky losers` : ', no lucky losers';
  const same = (['E1b', 'E1a', 'ER'] as EOption[])
    .map(
      (option) =>
        `${option} ${percent(result.cells[round][option].sameAsE0, result.cells[round][option].rounds)}`,
    )
    .join(', ');
  return `k ${shape.k}, rooms [${rooms}], ${shape.perRoom} per room${lucky}; same set as E0 in: ${same}`;
}

function eShapeLines(results: Results, variant: Variant, round = 0): string[] {
  return E_COLUMNS.flatMap((column) => {
    const result = findE(results, column, variant);
    return result?.shapes[round] ? [`- ${label(column)}: ${shapeText(result, round)}`] : [];
  });
}

function eControlLine(results: Results, variant: Variant): string {
  const parts = E_CONTROLS.flatMap((column) => {
    const result = findE(results, column, variant, true);
    const summary = eSummary(result, 'E0', 0);
    return result && summary ? [`${label(column)}: ${summary.kept.toFixed(2)}/${result.shapes[0].k}`] : [];
  });
  return `Equal-room controls (top-k kept, first elimination round): ${parts.join('; ') || 'not run'}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Shape Q

function qCell(result: QResult | undefined, option: QOption): string {
  if (!result) return 'not run';
  const cell = result.cells[option];
  if (!cell) return 'n/a';
  const summary = summarise(cell.real);
  const cut = CUT[result.scenario.kind];
  const tie = option === 'QR' ? '' : ` · tie ${percent(cell.tieDecided, cell.runs)}`;
  const mark = option === 'QK' ? '†' : '';
  return `${gapText(summary)}${mark} · ${keptText(summary, option === 'Q0', cut)}${tie}`;
}

function bubbleShare(result: QResult | undefined, option: 'Q0' | 'QK'): string {
  if (!result) return 'not run';
  const seats = result.bubbleSeats[option];
  return percent(seats.bubble, seats.total);
}

function qTable(results: Results, variant: Variant): string[] {
  const found = Q_COLUMNS.map((column) => findQ(results, column, variant));
  const lines = tableHead(Q_COLUMNS);
  for (const option of Q_TABLE_OPTIONS) {
    lines.push(
      row(
        option === 'QK' ? 'QK†' : option,
        found.map((result) => qCell(result, option)),
      ),
    );
  }
  lines.push(
    row(
      'placebo (Q0)',
      found.map((result) => {
        const cell = result?.cells.Q0;
        return cell ? gapText(summarise(cell.placebo)) : 'not run';
      }),
    ),
  );
  lines.push(
    row(
      'smaller-room seats reaching the bubble, QK (Q0)',
      found.map((result) => `${bubbleShare(result, 'QK')} (${bubbleShare(result, 'Q0')})`),
    ),
  );
  return lines;
}

function histogramText(histogram: Record<string, number>, runs: number, noun: string): string {
  const parts = Object.entries(histogram)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(
      ([count, units]) =>
        `${(units / runs).toFixed(1)} units with ${count} ${noun}${count === '1' ? '' : 's'}`,
    );
  return parts.join(', ');
}

function qSeatLines(results: Results, variant: Variant): string[] {
  return Q_COLUMNS.flatMap((column) => {
    const result = findQ(results, column, variant);
    if (!result) return [];
    const runs = result.scenario.runs;
    const base = histogramText(result.seatSplit.base, runs, 'seat');
    const bye = result.cells.QB
      ? `; QB byes: ${histogramText(result.seatSplit.QB, runs, 'bye')}`
      : '; QB n/a';
    return [`- ${label(column)}: smaller-room seats over the counted rounds (Q0): ${base}${bye}`];
  });
}

function qControlLine(results: Results, variant: Variant): string {
  const parts = Q_CONTROLS.flatMap((column) => {
    const result = findQ(results, column, variant, true);
    const cell = result?.cells.Q0;
    return result && cell
      ? [`${label(column)}: ${summarise(cell.real).kept.toFixed(2)}/${CUT[column.kind]}`]
      : [];
  });
  return `Equal-room controls (top-k kept, Q0): ${parts.join('; ') || 'not run'}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Where the other level or margins change a conclusion

export interface Probe {
  gap: number;
  error: number;
}

export type ProbeOf = (variant: Variant, column: Column, option: string) => Probe | undefined;

function eProbe(results: Results): ProbeOf {
  return (variant, column, option) => {
    const summary = eSummary(findE(results, column, variant), option as EOption, 0);
    return summary && !Number.isNaN(summary.gap) ? { gap: summary.gap, error: summary.error } : undefined;
  };
}

function qProbe(results: Results): ProbeOf {
  return (variant, column, option) => {
    const cell = findQ(results, column, variant)?.cells[option as QOption];
    if (!cell) return undefined;
    const summary = summarise(cell.real);
    return Number.isNaN(summary.gap) ? undefined : { gap: summary.gap, error: summary.error };
  };
}

/** Whether the option's gap differs from the reference's by more than the two errors combined. */
export function beyond(option: Probe, reference: Probe): boolean {
  return Math.abs(option.gap - reference.gap) > Math.hypot(option.error, reference.error);
}

/** A sign flip of a gap that is beyond its own error on both sides, or a difference to the reference that appears or disappears beyond 2 SE. */
export function changes(
  columns: Column[],
  options: readonly string[],
  reference: string,
  probe: ProbeOf,
): string[] {
  const events: Array<{ size: number; text: string }> = [];
  for (const column of columns) {
    for (const option of options) {
      const main = probe(MAIN, column, option);
      const base = probe(MAIN, column, reference);
      if (!main || !base) continue;
      for (const variant of VARIANTS.slice(1)) {
        const alt = probe(variant, column, option);
        const altBase = probe(variant, column, reference);
        if (!alt || !altBase) continue;
        const flips =
          Math.abs(main.gap) > main.error && Math.abs(alt.gap) > alt.error && main.gap * alt.gap < 0;
        if (flips) {
          events.push({
            size: Math.abs(main.gap - alt.gap),
            text: `${label(column)}, ${option}: gap ${signed(main.gap)} at ${MAIN.label}, ${signed(alt.gap)} at ${variant.label} (sign flip)`,
          });
        }
        if (option !== reference && beyond(main, base) !== beyond(alt, altBase)) {
          const verb = beyond(main, base) ? 'differs from' : 'does not differ from';
          const alter = beyond(main, base) ? 'no longer beyond' : 'beyond';
          events.push({
            size: Math.abs(main.gap - base.gap - (alt.gap - altBase.gap)),
            text: `${label(column)}, ${option}: ${verb} ${reference} at ${MAIN.label} (${signed(main.gap - base.gap)}), ${alter} 2 SE at ${variant.label} (${signed(alt.gap - altBase.gap)})`,
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
// The main body and the appendix

function modelLines(): string[] {
  return [
    '1. **Places.** Every unit has a strength drawn from N(0,1); in each room it performs at strength + noise × N(0,1) and the room is ranked by that. The real engine plays the schedule, the draws and the advancement.',
    `2. **Two predictability levels**, fitted so that the round-to-round correlation of the share beaten in a simulated qualification matches the real pools (FFA 0.57, teams 0.32): "FFA-like" noise ${NOISE['ffa-like']}, "team-like" noise ${NOISE['team-like']}. Each format is shown at its own level (FFA FFA-like, 2v2v2v2 team-like); the other level is in the notes and Appendix D.`,
    '3. **Scores.** The score order always equals the place order. "Margins add nothing": a random real room of the same effective size lends its relative scores. "Margins add a little" (the main tables): real rooms stay whole and are matched on the simulated room\'s performance spread (ρ = 1), so a close room tends to get a flat real profile and a runaway room a steep one.',
    "4. **Fit** (Appendix B): at the kind's own level the lucky-loser pair comparison (a 3rd of 4 above a last of 3: real 91%; a 7th of 8 above a last of 7: real 85%) is within 2 points, place medians within 0.03, spread within 0.01; the relative score is slightly *less* consistent from round to round than in real events (gap -0.04 and -0.06), so both margin levels sit at or below the real consistency of relative scores and the results for options that read relative scores (E0's lucky losers, E1a's tie-break, ER, QR) understate, if anything, what margins add.",
    '5. **Pairing.** Options are compared within one margin level, where they stay paired (same seeds, same strengths). The draw of later rounds reads scores (tie-break, in-tier order), so it depends slightly on the margin model; 3000 runs per cell. Gap = chance of advancing (qualifying) of units that had the advantage minus that of units that did not, same true rank, averaged over the ranks within one largest room size of the cut, in percentage points ± 2 standard errors; positive = the advantaged group does better.',
  ];
}

function otherLevelNote(): string {
  return 'Cells read `gap ± 2 SE · true top-k kept`. The reference option (E0 / Q0) shows the absolute top-k kept out of k; every other option shows the per-run difference to it (Δ, ± 2 SE), because options differ by tenths of a unit.';
}

function checkLines(results: Results, drawCheck: string[]): string[] {
  const all = [...results.values()];
  const mismatches = all
    .filter((entry) => entry.job.shape === 'E')
    .reduce((sum, entry) => sum + (entry.result as EResult).mismatches, 0);
  const order = all
    .filter((entry) => entry.job.shape === 'Q')
    .reduce((sum, entry) => sum + (entry.result as QResult).orderMismatches, 0);
  const breaches = all
    .filter((entry) => entry.job.shape === 'Q')
    .reduce((sum, entry) => sum + (entry.result as QResult).seatSpreadBreaches, 0);
  const placebo = placeboSummary(all);
  return [
    `- **Engine equivalence, E:** the tool's E0 against the engine's advancing set in every measured round: ${mismatches} mismatches in ${all.filter((entry) => entry.job.shape === 'E').length} jobs.`,
    `- **Engine equivalence, Q:** the tool's Q0 standings against \`computeQualificationStandings\`: ${order} mismatching runs.`,
    `- **Rebuilt draw:** the engine's qualification draw rebuilt from its pieces against the engine's own (the base of QB and QK): ${drawCheck.join('; ')}.`,
    `- **Seat spread under Q0:** smaller-room seat counts (engine weighting) differ by more than 1 in ${breaches} runs.`,
    `- **Placebo:** ${placebo}`,
  ];
}

function placeboSummary(all: JobResult[]): string {
  let cells = 0;
  let inside = 0;
  const check = (accumulator: Accumulator) => {
    const summary = summarise(accumulator);
    if (Number.isNaN(summary.gap)) return;
    cells += 1;
    if (Math.abs(summary.gap) <= summary.error) inside += 1;
  };
  for (const { job, result } of all) {
    if (job.control) continue;
    if (job.shape === 'E') {
      for (const round of (result as EResult).cells)
        for (const option of E_OPTIONS) check(round[option].placebo);
    } else {
      for (const cell of Object.values((result as QResult).cells)) if (cell) check(cell.placebo);
    }
  }
  return `${inside} of ${cells} placebo gaps (${percent(inside, cells)}) lie within ±2 SE of 0 (aim: at least 95%).`;
}

function theoryLines(results: Results): string[] {
  const lines: string[] = [];
  for (const column of [Q_COLUMNS[0], Q_COLUMNS[4]]) {
    const result = findQ(results, column, MAIN);
    if (!result) continue;
    const sizes = [...new Set(Object.keys(result.theory).map((key) => Number(key.split('|')[2])))].sort(
      (a, b) => a - b,
    );
    if (sizes.length < 2) continue;
    const [small, large] = sizes.slice(-2);
    const mean = (measure: string, quarter: number, size: number) => {
      const found = result.theory[`${measure}|${quarter}|${size}`];
      return found ? found.sum / found.count : Number.NaN;
    };
    for (const measure of ['Q0', 'QS', 'relative']) {
      const values = [0, 1, 2, 3].map((quarter) =>
        signed(mean(measure, quarter, small) - mean(measure, quarter, large), 2),
      );
      lines.push(
        `| ${label(column)} | ${measure === 'relative' ? 'relative score' : `${measure} points`} | ${values.join(' | ')} |`,
      );
    }
  }
  return lines;
}

function laterRounds(results: Results): string[] {
  const lines: string[] = [];
  for (const column of E_COLUMNS) {
    const result = findE(results, column, MAIN);
    if (!result || result.cells.length < 2) continue;
    lines.push(
      `**${label(column)}** (own level, margins "a little")`,
      '',
      '| round | shape | ' + E_OPTIONS.join(' | ') + ' |',
      '| --- | --- | ' + E_OPTIONS.map(() => '---').join(' | ') + ' |',
    );
    for (let round = 1; round < result.cells.length; round += 1) {
      const shape = result.shapes[round];
      const rooms = [...shape.rooms].sort((a, b) => b - a).join(',');
      const cells = E_OPTIONS.map((option) => eCell(result, option, round));
      lines.push(
        `| ${round + 1} | k ${shape.k}, [${rooms}], ${shape.perRoom}+${shape.lucky} | ${cells.join(' | ')} |`,
      );
    }
    lines.push('');
  }
  return lines;
}

/** QB against QB with the byes drawn at random: the stride over the previous round's order picks middling performers, so a bye can be confounded with how the unit just played. */
function randomByeLines(results: Results): string[] {
  const lines = [
    "| scenario | QB (stride over the engine's order) | QBr (byes drawn at random) |",
    '| --- | --- | --- |',
  ];
  for (const column of Q_COLUMNS) {
    const result = findQ(results, column, MAIN);
    if (!result?.cells.QB || !result.cells.QBr) continue;
    lines.push(`| ${label(column)} | ${qCell(result, 'QB')} | ${qCell(result, 'QBr')} |`);
  }
  return lines;
}

function skippedLines(results: Results): string[] {
  let skipped = 0;
  let cells = 0;
  for (const { job, result } of results.values()) {
    if (job.control) continue;
    const accumulators: Accumulator[] =
      job.shape === 'E'
        ? (result as EResult).cells.flatMap((round) => E_OPTIONS.map((option) => round[option].real))
        : Object.values((result as QResult).cells).flatMap((cell: QCell | null) => (cell ? [cell.real] : []));
    for (const accumulator of accumulators) {
      cells += 1;
      skipped += summarise(accumulator).skipped;
    }
  }
  return [
    `Ranks skipped because one group was empty in every run: ${skipped} over ${cells} cells (a skipped rank is left out of that cell's average).`,
  ];
}

function qkLines(results: Results): string[] {
  const lines = [
    '| scenario | repeat pairings per qualification, Q0 → QK | QK seat split (units per run) |',
    '| --- | --- | --- |',
  ];
  for (const column of Q_COLUMNS) {
    const result = findQ(results, column, MAIN);
    if (!result) continue;
    const runs = result.scenario.runs;
    lines.push(
      `| ${label(column)} | ${(result.repeats.Q0 / runs).toFixed(2)} → ${(result.repeats.QK / runs).toFixed(2)} | ${histogramText(result.seatSplit.QK, runs, 'seat')} |`,
    );
  }
  return lines;
}

export function writeFairnessReport(results: Results, drawCheck: string[], calibration: string[]): string {
  const probeE = eProbe(results);
  const probeQ = qProbe(results);
  const lines: string[] = [
    '# Room-size fairness simulation: results',
    '',
    'Report only: numbers and plain observations, no recommendation. Nothing in `src/` changed. Plan: `plans/2026-10-25-room-size-fairness-simulation.md`; tool: `scripts/seeding-simulation/` (`run-study.ts`). 3000 runs per cell.',
    '',
    '## The model in five lines',
    '',
    ...modelLines(),
    '',
    otherLevelNote(),
    '',
    '## Shape E: warm-ups, then single elimination (first mixed elimination round)',
    '',
    'Columns: 2v2v2v2 at "team-like", FFA at "FFA-like"; margins "a little". Rows: today (E0); lucky losers ranked by share of opponents beaten (E1b); one cut across all rooms by share beaten then relative score (E1a); one cut by relative score alone (ER).',
    '',
    ...eTable(results, MAIN),
    '',
    ...eShapeLines(results, MAIN),
    '',
    eControlLine(results, MAIN),
    '',
    'Where the other predictability level or margins "nothing" change a conclusion:',
    '',
    ...changes(E_COLUMNS, E_OPTIONS, 'E0', probeE),
    '',
    '## Shape Q: qualification table, 4 rounds, round 1 not counted',
    '',
    'Columns as above; cut 16 (2v2v2v2) / 24 (FFA); margins "a little". Rows: Standard points (Q0); scaled points (QS); scaled and rounded to 0.5 (QH); average relative score (QR); the community table 10-8-6-5-4-3-2-1 (Q0c) and read at the share beaten (QSc), FFA only; neutral bye (QB); seats by stake (QK). `tie` = share of runs in which units on equal values straddle the cut, so the tie-break decides it.',
    '',
    ...qTable(results, MAIN),
    '',
    ...qSeatLines(results, MAIN),
    '',
    qControlLine(results, MAIN),
    '',
    'For 2v2v2v2, QH equals QS: the scaled points of rooms of 3 and 4 (4, 2.5, 1 and 4, 3, 2, 1) are already multiples of 0.5.',
    '',
    '† QK\'s gap is confounded by selection: its seats follow the standings, so "had an extra seat" also says where the unit stood. Read QK by the row "smaller-room seats reaching the bubble" (the share of smaller-room seats in the stake rounds, the second counted round on, that went to units within one largest room size of the cut by true rank).',
    '',
    'Where the other predictability level or margins "nothing" change a conclusion:',
    '',
    ...changes(
      Q_COLUMNS,
      Q_TABLE_OPTIONS.filter((option) => option !== 'QK'),
      'Q0',
      probeQ,
    ),
    '',
    '## Appendix',
    '',
    '### A. Checks',
    '',
    ...checkLines(results, drawCheck),
    '',
    '**Theory check** (mean round points, smaller room minus largest room, by true-strength quarter, strongest first; own level, margins "a little"). Q0 should favour the smaller rooms more for weaker units, QS should be about 0, and the relative score is shown as the model gives it:',
    '',
    '| scenario | measure | strongest | 2nd | 3rd | weakest |',
    '| --- | --- | --- | --- | --- | --- |',
    ...theoryLines(results),
    '',
    '### B. Calibration',
    '',
    ...calibration.flatMap((text) => ['```', text.trimEnd(), '```', '']),
    '### C. Later mixed elimination rounds of E',
    '',
    'Own level, margins "a little". In later rounds the field is the strong units only, so the matched-room model (its performance-spread moments come from qualifications) picks flatter real rooms than the real spread of such rounds; read these as indications.',
    '',
    ...laterRounds(results),
    '### D. The other level and margins "nothing"',
    '',
    ...VARIANTS.slice(1).flatMap((variant) => [
      `**Shape E, ${variant.label}**`,
      '',
      ...eTable(results, variant),
      '',
      `**Shape Q, ${variant.label}**`,
      '',
      ...qTable(results, variant),
      '',
    ]),
    '### E. QK: repeat pairings and seat split',
    '',
    ...qkLines(results),
    '',
    '### F. QB with random byes',
    '',
    "QB takes its byes by the engine's own tie rule (a stride over the previous round's finishing order), which picks units that finished in the middle; with one bye a round that links 'had a bye' to how the unit just played. QBr draws the byes at random among the units with the fewest so far. Own level, margins 'a little'; same cell format as the main table (Δ against Q0).",
    '',
    ...randomByeLines(results),
    '',
    '### G. Skipped ranks',
    '',
    ...skippedLines(results),
    '',
  ];
  return lines.join('\n');
}
