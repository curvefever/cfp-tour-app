import { computeQualificationStandings } from '../../src/domain/tournament/advancement';
import { smallerRoomSeatsBefore } from '../../src/domain/tournament/smaller-room-seats';
import { CUT } from './cuts';
import {
  addObservations,
  emptyAccumulator,
  recordDifference,
  type Accumulator,
  type Observation,
} from './elim-measures';
import { scoreModelFor } from './matched-model';
import type { Policy } from './policies';
import { byesApply } from './q-draws';
import {
  cutDecidedByTieBreak,
  extractUnits,
  largestRoomOf,
  Q_OPTIONS,
  standingsUnder,
  type QOption,
  type QualUnit,
} from './qualification';
import { scenarioSeed, seededRandom, shuffled } from './random';
import { NOISE, type Level, type Margins } from './score-model';
import { simulate, type Kind, type RunResult } from './simulate';

/**
 * Shape Q scenarios: a qualification table of four rounds, the first not counted, cut at 16 (2v2v2v2) or 24 (FFA).
 * One base run serves the re-scoring rules; the neutral bye and the seats by stake have runs of their own.
 */

export interface QScenario {
  kind: Kind;
  count: number;
  level: Level;
  margins: Margins;
  runs: number;
}

export interface QCell {
  real: Accumulator;
  placebo: Accumulator;
  /** Runs in which equal primary values straddled the cut. */
  tieDecided: number;
  runs: number;
}

/** Smaller-room seats in the stake rounds (the second counted round on): how many there were and how many went to units in the bubble. */
interface BubbleSeats {
  bubble: number;
  total: number;
}

export interface QResult {
  scenario: QScenario;
  /** Null where the option does not exist for the scenario (an FFA table, byes that do not apply). */
  cells: Record<QOption, QCell | null>;
  /** Sums of a measure by strength quarter and room size, keyed `<measure>|<quarter>|<size>` (quarter 0 = strongest). */
  theory: Record<string, { sum: number; count: number }>;
  /** Runs in which the tool's `Q0` order differs from `computeQualificationStandings`. */
  orderMismatches: number;
  /** Runs in which the smaller-room seat counts differ by more than 1. */
  seatSpreadBreaches: number;
  /** Over all runs: how many units held each number of smaller-room seats (`base`, `QK`) or byes (`QB`), keyed by the number. */
  seatSplit: Record<'base' | 'QK' | 'QB', Record<string, number>>;
  bubbleSeats: Record<'Q0' | 'QK', BubbleSeats>;
  /** Repeat pairings over the four qualification rounds, summed over runs. */
  repeats: Record<'Q0' | 'QK', number>;
}

export function emptyCell(): QCell {
  return { real: emptyAccumulator(), placebo: emptyAccumulator(), tieDecided: 0, runs: 0 };
}

function minimumSeats(units: QualUnit[]): number {
  return Math.min(...units.map((unit) => unit.seats));
}

/** Adds one qualification, ranked under `option`, to a cell; returns the true top-k kept. */
export function addQualification(
  cell: QCell,
  option: QOption,
  units: QualUnit[],
  advantage: (unit: QualUnit) => boolean,
  random: () => number,
  cut: number,
): number {
  const standing = standingsUnder(option, units);
  const qualified = new Set(standing.order.slice(0, cut).map((unit) => unit.name));
  const window = largestRoomOf(units);
  const labelled = units.filter(advantage);
  const placebo = new Set(
    shuffled(
      units.map((unit) => unit.name),
      random,
    ).slice(0, labelled.length),
  );
  const observe = (labels: (unit: QualUnit) => boolean): Observation[] =>
    units.map((unit) => ({
      trueRank: unit.trueRank,
      advantaged: labels(unit),
      won: qualified.has(unit.name),
    }));
  const kept = addObservations(cell.real, observe(advantage), cut, window);
  addObservations(
    cell.placebo,
    observe((unit) => placebo.has(unit.name)),
    cut,
    window,
  );
  if (cutDecidedByTieBreak(standing, cut)) cell.tieDecided += 1;
  cell.runs += 1;
  return kept;
}

function addTheory(theory: QResult['theory'], units: QualUnit[]): void {
  const top = largestRoomOf(units);
  const bump = (key: string, value: number) => {
    const found = theory[key] ?? { sum: 0, count: 0 };
    theory[key] = { sum: found.sum + value, count: found.count + 1 };
  };
  for (const unit of units) {
    const quarter = Math.floor(((unit.trueRank - 1) * 4) / units.length);
    for (const round of unit.rounds) {
      if (!round) continue;
      bump(`Q0|${quarter}|${round.size}`, Math.max(0, top + 1 - round.place));
      bump(`QS|${quarter}|${round.size}`, 1 + ((top - 1) * (round.size - round.place)) / (round.size - 1));
      bump(`relative|${quarter}|${round.size}`, round.relative);
    }
  }
}

function addHistogram(histogram: Record<string, number>, values: number[]): void {
  for (const value of values) histogram[value] = (histogram[value] ?? 0) + 1;
}

function addBubbleSeats(seats: BubbleSeats, units: QualUnit[], cut: number): void {
  const window = largestRoomOf(units);
  for (const unit of units) {
    for (const round of unit.rounds.slice(1)) {
      if (!round?.smaller) continue;
      seats.total += 1;
      if (unit.trueRank >= cut - window + 1 && unit.trueRank <= cut + window) seats.bubble += 1;
    }
  }
}

function repeatPairings(result: RunResult): number {
  const seen = new Map<string, number>();
  for (let round = 0; round < result.qualRounds; round += 1) {
    const rooms = new Map<number, string[]>();
    for (const { name, room } of result.finalState.assignments[round]) {
      if (room !== null) rooms.set(room, [...(rooms.get(room) ?? []), name]);
    }
    for (const names of rooms.values()) {
      for (let a = 0; a < names.length; a += 1) {
        for (let b = a + 1; b < names.length; b += 1) {
          const key = names[a] < names[b] ? `${names[a]}|${names[b]}` : `${names[b]}|${names[a]}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return [...seen.values()].reduce((sum, times) => sum + Math.max(0, times - 1), 0);
}

export function sameOrder(result: RunResult, units: QualUnit[]): boolean {
  const engine = computeQualificationStandings(result.finalState).map((entry) => entry.name);
  const mine = standingsUnder('Q0', units).order.map((unit) => unit.name);
  return engine.length === mine.length && engine.every((name, index) => name === mine[index]);
}

function seatSpreadBreach(result: RunResult): boolean {
  const counts = smallerRoomSeatsBefore(result.finalState, result.qualRounds);
  const values = result.finalState.assignments[0].map((entry) => counts[entry.name] ?? 0);
  return Math.max(...values) - Math.min(...values) > 1;
}

const BASE_OPTIONS: QOption[] = ['Q0', 'QS', 'QH', 'QR', 'Q0c', 'QSc'];

export function runQScenario(scenario: QScenario): QResult {
  const { kind, count, level, margins, runs } = scenario;
  const cut = CUT[kind];
  const model = scoreModelFor(kind, level, margins);
  const config = { kind, count, mode: 'A' as const };
  const cells = Object.fromEntries(Q_OPTIONS.map((option) => [option, emptyCell()])) as Record<
    QOption,
    QCell | null
  >;
  const result: QResult = {
    scenario,
    cells,
    theory: {},
    orderMismatches: 0,
    seatSpreadBreaches: 0,
    seatSplit: { base: {}, QK: {}, QB: {} },
    bubbleSeats: { Q0: { bubble: 0, total: 0 }, QK: { bubble: 0, total: 0 } },
    repeats: { Q0: 0, QK: 0 },
  };
  let byesUsed = true;
  const run = (policy: Policy, seed: number) => simulate(config, policy, NOISE[level], seed, model);
  for (let index = 0; index < runs; index += 1) {
    const seed = scenarioSeed(`Q-${kind}-${count}`, level, margins, index);
    const random = seededRandom(seed ^ 0x27d4eb2f);
    const base = run('current', seed);
    const units = extractUnits(base);
    const fewest = minimumSeats(units);
    if (!sameOrder(base, units)) result.orderMismatches += 1;
    if (seatSpreadBreach(base)) result.seatSpreadBreaches += 1;
    addTheory(result.theory, units);
    addHistogram(
      result.seatSplit.base,
      units.map((unit) => unit.seats),
    );
    addBubbleSeats(result.bubbleSeats.Q0, units, cut);
    result.repeats.Q0 += repeatPairings(base);
    let referenceKept = 0;
    for (const option of BASE_OPTIONS) {
      const kept = addQualification(
        cells[option] as QCell,
        option,
        units,
        (u) => u.seats > fewest,
        random,
        cut,
      );
      if (option === 'Q0') referenceKept = kept;
      else recordDifference((cells[option] as QCell).real, kept, referenceKept);
    }
    const stakeRun = run('QK', seed);
    const stake = extractUnits(stakeRun);
    const stakeFewest = minimumSeats(stake);
    const keptStake = addQualification(
      cells.QK as QCell,
      'QK',
      stake,
      (u) => u.seats > stakeFewest,
      random,
      cut,
    );
    recordDifference((cells.QK as QCell).real, keptStake, referenceKept);
    addHistogram(
      result.seatSplit.QK,
      stake.map((unit) => unit.seats),
    );
    addBubbleSeats(result.bubbleSeats.QK, stake, cut);
    result.repeats.QK += repeatPairings(stakeRun);
    if (byesApply(base.finalState.rounds[base.firstCounted].rooms, count)) {
      const byes = extractUnits(run('QB', seed));
      const hadBye = (unit: QualUnit) => unit.rounds.some((round) => round === null);
      const keptBye = addQualification(cells.QB as QCell, 'QB', byes, hadBye, random, cut);
      recordDifference((cells.QB as QCell).real, keptBye, referenceKept);
      addHistogram(
        result.seatSplit.QB,
        byes.map((unit) => unit.rounds.filter((round) => round === null).length),
      );
      const drawn = extractUnits(run('QBr', seed));
      const keptDrawn = addQualification(cells.QBr as QCell, 'QBr', drawn, hadBye, random, cut);
      recordDifference((cells.QBr as QCell).real, keptDrawn, referenceKept);
    } else {
      byesUsed = false;
    }
  }
  if (kind !== 'ffa') {
    cells.Q0c = null;
    cells.QSc = null;
  }
  if (!byesUsed) {
    cells.QB = null;
    cells.QBr = null;
  }
  return result;
}
