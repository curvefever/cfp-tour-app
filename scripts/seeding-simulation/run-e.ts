import { advancing, ALL_E_OPTIONS, decide, isNeutralRule, sizeGroups, type EOption } from './cut-rules';
import {
  addRound,
  emptyAccumulator,
  largestRoom,
  recordDifference,
  type Accumulator,
  type RankCounts,
} from './elim-measures';
import { simulateElimination, type EliminationRound } from './elimination';
import { scoreModelFor } from './matched-model';
import { scenarioSeed, seededRandom, shuffled } from './random';
import { NOISE, type Level, type Margins } from './score-model';
import type { Kind } from './simulate';

/** Shape E scenarios: warm-ups, then single elimination, every mixed elimination round measured under each cut rule. */

export interface Cell {
  real: Accumulator;
  placebo: Accumulator;
  /** Rounds in which the option advances exactly the units `E0` does. */
  sameAsE0: number;
  rounds: number;
  /** Every unit of the round as one group (smaller rooms against the others), not only the bubble: the average unit's gap. */
  all: RankCounts;
  /** Rounds with a leftover elimination (size-proportional rules) and how often it fell on the smaller rooms. */
  leftover: { rounds: number; toSmaller: number };
  /** Rounds where the rule advanced a number other than k, or took more than one from a group's fair share; units that won their room but were eliminated. */
  breaches: { count: number; share: number; winnersOut: number };
}

/** The round as the schedule draws it: all options advance `k`, `perRoom` from each room and `lucky` more. */
export interface RoundShape {
  k: number;
  rooms: number[];
  perRoom: number;
  lucky: number;
}

export interface EScenario {
  kind: Kind;
  count: number;
  level: Level;
  margins: Margins;
  runs: number;
  /** Mixed elimination rounds to measure per run. */
  rounds: number;
  /** Equal-room control: measure the first elimination round. */
  control: boolean;
}

export interface EResult {
  scenario: EScenario;
  /** By measured round, then option. */
  cells: Array<Record<EOption, Cell>>;
  /** The shape of each measured round. */
  shapes: RoundShape[];
  /** Rounds in which the tool's `E0` differs from the engine's advancing set. */
  mismatches: number;
}

function emptyCells(): Record<EOption, Cell> {
  return Object.fromEntries(
    ALL_E_OPTIONS.map((option) => [
      option,
      {
        real: emptyAccumulator(),
        placebo: emptyAccumulator(),
        sameAsE0: 0,
        rounds: 0,
        all: { advantaged: 0, advantagedWon: 0, others: 0, othersWon: 0 },
        leftover: { rounds: 0, toSmaller: 0 },
        breaches: { count: 0, share: 0, winnersOut: 0 },
      },
    ]),
  ) as Record<EOption, Cell>;
}

function sameSet(first: Set<string>, second: Set<string>): boolean {
  return first.size === second.size && [...first].every((name) => second.has(name));
}

function addAll(
  counts: RankCounts,
  round: EliminationRound,
  advantaged: Set<string>,
  result: Set<string>,
): void {
  for (const unit of round.units) {
    const group = advantaged.has(unit.name) ? 'advantaged' : 'others';
    counts[group] += 1;
    if (result.has(unit.name)) counts[`${group}Won`] += 1;
  }
}

/** Every rule advances k; a size-proportional rule takes `floor(e_g)` or one more from each group; nobody who won their room goes out. */
function checkRound(cell: Cell, option: EOption, round: EliminationRound, result: Set<string>): void {
  if (result.size !== round.engine.size) cell.breaches.count += 1;
  if (isNeutralRule(option)) {
    const wrong = sizeGroups(round).some((group) => {
      const out = group.ranked.filter((unit) => !result.has(unit.name)).length;
      return out < group.whole || out > group.whole + 1;
    });
    if (wrong) cell.breaches.share += 1;
  }
  cell.breaches.winnersOut += round.units.filter((unit) => unit.place === 0 && !result.has(unit.name)).length;
}

function addToCells(cells: Record<EOption, Cell>, round: EliminationRound, random: () => number): void {
  const window = largestRoom(round);
  const advantaged = new Set(round.units.filter((unit) => unit.roomSize < window).map((unit) => unit.name));
  const names = round.units.map((unit) => unit.name);
  const labels = new Set(shuffled(names, random).slice(0, advantaged.size));
  const reference = advancing('E0', round);
  let referenceKept = 0;
  for (const option of ALL_E_OPTIONS) {
    const { advancing: result, leftover } = decide(option, round);
    cells[option].rounds += 1;
    if (sameSet(result, reference)) cells[option].sameAsE0 += 1;
    addAll(cells[option].all, round, advantaged, result);
    checkRound(cells[option], option, round, result);
    if (leftover !== null) {
      cells[option].leftover.rounds += 1;
      if (leftover < window) cells[option].leftover.toSmaller += 1;
    }
    const kept = addRound(cells[option].real, round, advantaged, result);
    addRound(cells[option].placebo, round, labels, result);
    if (option === 'E0') referenceKept = kept;
    else recordDifference(cells[option].real, kept, referenceKept);
  }
}

function shapeOf(round: EliminationRound): RoundShape {
  const sizes = new Map<number, number>();
  for (const unit of round.units) sizes.set(unit.room, unit.roomSize);
  return {
    k: round.engine.size,
    rooms: [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([, size]) => size),
    perRoom: round.advPerRoom,
    lucky: round.luckyCount,
  };
}

export function runEScenario(scenario: EScenario): EResult {
  const { kind, count, level, margins, runs } = scenario;
  const model = scoreModelFor(kind, level, margins);
  const cells: Array<Record<EOption, Cell>> = [];
  const shapes: RoundShape[] = [];
  let mismatches = 0;
  for (let run = 0; run < runs; run += 1) {
    const seed = scenarioSeed(`E-${kind}-${count}`, level, margins, run);
    const random = seededRandom(seed ^ 0x27d4eb2f);
    for (const round of simulateElimination(scenario, NOISE[level], seed, model)) {
      cells[round.order] ??= emptyCells();
      shapes[round.order] ??= shapeOf(round);
      if (!sameSet(advancing('E0', round), round.engine)) mismatches += 1;
      addToCells(cells[round.order], round, random);
    }
  }
  return { scenario, cells, shapes, mismatches };
}
