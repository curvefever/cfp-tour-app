import { advancing, E_OPTIONS, type EOption } from './cut-rules';
import { addRound, emptyAccumulator, largestRoom, recordDifference, type Accumulator } from './elim-measures';
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
    E_OPTIONS.map((option) => [
      option,
      { real: emptyAccumulator(), placebo: emptyAccumulator(), sameAsE0: 0, rounds: 0 },
    ]),
  ) as Record<EOption, Cell>;
}

function sameSet(first: Set<string>, second: Set<string>): boolean {
  return first.size === second.size && [...first].every((name) => second.has(name));
}

function addToCells(cells: Record<EOption, Cell>, round: EliminationRound, random: () => number): void {
  const window = largestRoom(round);
  const advantaged = new Set(round.units.filter((unit) => unit.roomSize < window).map((unit) => unit.name));
  const names = round.units.map((unit) => unit.name);
  const labels = new Set(shuffled(names, random).slice(0, advantaged.size));
  const reference = advancing('E0', round);
  let referenceKept = 0;
  for (const option of E_OPTIONS) {
    const result = advancing(option, round);
    cells[option].rounds += 1;
    if (sameSet(result, reference)) cells[option].sameAsE0 += 1;
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
