import { relativeScores } from './calibrate';
import type { RunResult } from './simulate';

/**
 * Shape Q: the scoring rules of a qualification table, applied after the fact to a simulated qualification (the draw
 * does not depend on a pooling scoring rule, which is why one run serves several rules). A unit's counted rounds are
 * read from the run: room size, place, relative score, or a bye.
 */

export const Q_OPTIONS = ['Q0', 'QS', 'QH', 'QR', 'Q0c', 'QSc', 'QB', 'QK', 'QBr'] as const;
/** The options of the main tables: `QBr` (the neutral bye with the byes drawn at random) is a selection check kept to the appendix. */
export const Q_TABLE_OPTIONS = Q_OPTIONS.filter((option) => option !== 'QBr');
export type QOption = (typeof Q_OPTIONS)[number];

/** The community FFA table of the spreadsheets: 10, 8, 6, 5, 4, 3, 2, 1. */
export const COMMUNITY_TABLE = [10, 8, 6, 5, 4, 3, 2, 1];

export interface PlayedRound {
  size: number;
  /** 1 = best. */
  place: number;
  relative: number;
  /** The room was smaller than the round's largest. */
  smaller: boolean;
}

export interface QualUnit {
  name: string;
  /** 1 = the truly strongest unit of the field. */
  trueRank: number;
  /** The counted rounds in order; null = a bye. */
  rounds: Array<PlayedRound | null>;
  /** Counted rounds spent in a room smaller than that round's largest. */
  seats: number;
}

/** The counted rounds of every unit of a run. */
export function extractUnits(result: RunResult): QualUnit[] {
  const counted = Array.from(
    { length: result.qualRounds - result.firstCounted },
    (_, index) => result.firstCounted + index,
  );
  const played = counted.map((round) => {
    const rooms = result.rooms.filter((room) => room.round === round);
    const largest = Math.max(...rooms.map((room) => room.units.length));
    const byName = new Map<string, PlayedRound & { smaller: boolean }>();
    for (const room of rooms) {
      const relative = relativeScores(room.scores);
      room.units.forEach((name, place) => {
        byName.set(name, {
          size: room.units.length,
          place: place + 1,
          relative: relative[place],
          smaller: room.units.length < largest,
        });
      });
    }
    return byName;
  });
  const byStrength = [...result.strengths].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return byStrength.map((name, index) => ({
    name,
    trueRank: index + 1,
    rounds: played.map((round) => {
      const found = round.get(name);
      return found
        ? { size: found.size, place: found.place, relative: found.relative, smaller: found.smaller }
        : null;
    }),
    seats: played.filter((round) => round.get(name)?.smaller).length,
  }));
}

export function largestRoomOf(units: QualUnit[]): number {
  return Math.max(...units.flatMap((unit) => unit.rounds.flatMap((round) => (round ? [round.size] : []))));
}

/** Points of one counted round under a rule. `top` is the tournament's largest room size. */
function roundPoints(option: QOption, round: PlayedRound, top: number): number {
  const { place, size } = round;
  const share = (size - place) / (size - 1);
  switch (option) {
    case 'QS':
      return 1 + (top - 1) * share;
    case 'QH':
      return Math.floor(2 * (1 + (top - 1) * share) + 0.5) / 2;
    case 'Q0c':
      return COMMUNITY_TABLE[place - 1] ?? 0;
    case 'QSc':
      return readTable(((place - 1) * (COMMUNITY_TABLE.length - 1)) / (size - 1));
    default:
      return Math.max(0, top + 1 - place);
  }
}

/** The community table read between entries at a fractional position. */
function readTable(position: number): number {
  const lower = Math.floor(position);
  const upper = Math.min(lower + 1, COMMUNITY_TABLE.length - 1);
  return COMMUNITY_TABLE[lower] + (COMMUNITY_TABLE[upper] - COMMUNITY_TABLE[lower]) * (position - lower);
}

function standardRoundPoints(round: PlayedRound, top: number): number {
  return Math.max(0, top + 1 - round.place);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

interface Keys {
  primary: number;
  secondary: number;
}

/** A unit's standing keys under a rule; a bye earns the unit's own average points over the counted rounds it played. */
function keysOf(option: QOption, unit: QualUnit, top: number): Keys {
  const played = unit.rounds.filter((round): round is PlayedRound => round !== null);
  const meanRelative = average(played.map((round) => round.relative));
  const standard = played.reduce((sum, round) => sum + standardRoundPoints(round, top), 0);
  if (option === 'QR') return { primary: meanRelative, secondary: standard };
  const points = played.reduce((sum, round) => sum + roundPoints(option, round, top), 0);
  const byes = unit.rounds.length - played.length;
  const withByes = played.length === 0 ? 0 : points + (byes * points) / played.length;
  return { primary: withByes, secondary: meanRelative };
}

/** Keys closer than float noise are equal, as the engine reads them (`samePoints`, `sameRoomShare`). */
function byKey(first: number, second: number): number {
  return Math.abs(first - second) < 1e-9 ? 0 : first - second;
}

/** Equal standings keep the roster order, as the engine's stable sort does: the units are named P1, P2, … or t1, t2, …. */
function rosterNumber(unit: QualUnit): number {
  return Number(unit.name.replace(/\D/g, ''));
}

export interface Standing {
  /** Units best first. */
  order: QualUnit[];
  /** The primary key of each, in the same order. */
  primary: number[];
}

export function standingsUnder(option: QOption, units: QualUnit[]): Standing {
  const top = largestRoomOf(units);
  const keyed = units.map((unit) => ({ unit, ...keysOf(option, unit, top) }));
  keyed.sort(
    (a, b) =>
      byKey(b.primary, a.primary) ||
      byKey(b.secondary, a.secondary) ||
      rosterNumber(a.unit) - rosterNumber(b.unit),
  );
  return { order: keyed.map((entry) => entry.unit), primary: keyed.map((entry) => entry.primary) };
}

/** Whether units on equal primary values straddle the cut, so the tie-break decides who qualifies. */
export function cutDecidedByTieBreak(standing: Standing, cut: number): boolean {
  return Math.abs(standing.primary[cut - 1] - standing.primary[cut]) < 1e-9;
}
