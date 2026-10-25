import type { EliminationRound, EliminationUnit } from './elimination';

/**
 * The cut rules of shape E (`plans/2026-10-25-room-size-fairness-simulation.md`, `plans/2026-10-25-neutral-elimination-cut.md`),
 * applied after the fact to a scored elimination round. Every rule advances the same number of units as the engine's round.
 */
export const E_OPTIONS = ['E0', 'E1b', 'E1a', 'ER'] as const;
/** The size-proportional rules: each room-size group loses its fair share of the eliminations, the leftover is settled by results. */
export const NEUTRAL_RULES = ['E2r', 'E2c', 'E2p'] as const;
export const NEUTRAL_OPTIONS = ['E0', 'ER', ...NEUTRAL_RULES] as const;
export const ALL_E_OPTIONS = ['E0', 'E1b', 'E1a', 'ER', ...NEUTRAL_RULES] as const;
export type EOption = (typeof ALL_E_OPTIONS)[number];
export type NeutralRule = (typeof NEUTRAL_RULES)[number];

export function isNeutralRule(option: EOption): option is NeutralRule {
  return (NEUTRAL_RULES as readonly string[]).includes(option);
}

type Order = (first: EliminationUnit, second: EliminationUnit) => number;

const byRelative: Order = (a, b) => b.relative - a.relative;
const byShareThenRelative: Order = (a, b) => b.share - a.share || b.relative - a.relative;

function unitsByRoom(round: EliminationRound): EliminationUnit[][] {
  const rooms: EliminationUnit[][] = [];
  for (const unit of round.units) {
    (rooms[unit.room - 1] ??= []).push(unit);
  }
  return rooms;
}

/** The per-room advancement, then the lucky losers: each room offers its best non-advancing unit, ranked by `order`. */
function perRoomWithLuckyLosers(round: EliminationRound, order: Order): Set<string> {
  const rooms = unitsByRoom(round);
  const direct = rooms.flatMap((room) => room.filter((unit) => unit.place < round.advPerRoom));
  const candidates = rooms.flatMap((room) => room.filter((unit) => unit.place === round.advPerRoom));
  const lucky = [...candidates].sort(order).slice(0, round.luckyCount);
  return new Set([...direct, ...lucky].map((unit) => unit.name));
}

function oneCut(round: EliminationRound, order: Order): Set<string> {
  return new Set(
    [...round.units]
      .sort(order)
      .slice(0, round.engine.size)
      .map((unit) => unit.name),
  );
}

/** A room-size group: its units best first (places count first, then relative score) and its fair share of the eliminations. */
export interface SizeGroup {
  size: number;
  /** Best first. */
  ranked: EliminationUnit[];
  /** `floor(e_g)`, with `e_g = eliminations × units in the group ÷ units in the round`. */
  whole: number;
  /** The fractional part of `e_g`, times the round's unit count (an integer; compare these, not floats). */
  remainder: number;
}

export function sizeGroups(round: EliminationRound): SizeGroup[] {
  const total = round.units.length;
  const eliminations = total - round.engine.size;
  const sizes = [...new Set(round.units.map((unit) => unit.roomSize))].sort((a, b) => b - a);
  return sizes.map((size) => {
    const ranked = round.units.filter((unit) => unit.roomSize === size).sort(byShareThenRelative);
    const exact = eliminations * ranked.length;
    return { size, ranked, whole: Math.floor(exact / total), remainder: exact % total };
  });
}

/** Share of the pool strictly below `value`, equal values counting half. */
function percentile(pool: number[], value: number): number {
  const below = pool.filter((other) => other < value).length;
  const equal = pool.filter((other) => other === value).length;
  return (below + equal / 2) / pool.length;
}

/** Negative when `first` is the one to eliminate. */
type Contest = (first: EliminationUnit, second: EliminationUnit, round: EliminationRound) => number;

const byRoomOrder = (a: EliminationUnit, b: EliminationUnit) => a.room - b.room;

const contests: Record<'E2c' | 'E2p', Contest> = {
  E2c: (a, b) => a.relative - b.relative || byRoomOrder(a, b),
  E2p: (a, b, round) =>
    percentile(round.sizePools.get(a.roomSize) ?? [], a.relative) -
      percentile(round.sizePools.get(b.roomSize) ?? [], b.relative) ||
    a.relative - b.relative ||
    byRoomOrder(a, b),
};

/** Which group takes the leftover elimination: the larger fractional part (ties: the larger group), or the loser of the contest. */
function leftoverGroup(rule: NeutralRule, groups: SizeGroup[], round: EliminationRound): SizeGroup {
  const [larger, smaller] = groups;
  if (rule === 'E2r') return smaller.remainder > larger.remainder ? smaller : larger;
  const candidate = (group: SizeGroup) => group.ranked[group.ranked.length - group.whole - 1];
  return contests[rule](candidate(larger), candidate(smaller), round) <= 0 ? larger : smaller;
}

/** The units that advance when each room-size group loses its fair share and the leftover is settled by `rule`. */
function sizeProportional(rule: NeutralRule, round: EliminationRound): Decision {
  const groups = sizeGroups(round);
  const eliminations = round.units.length - round.engine.size;
  const leftover = eliminations - groups.reduce((sum, group) => sum + group.whole, 0);
  if (leftover > 1 || groups.length > 2) throw new Error('rooms differ by more than one seat');
  const taker = leftover === 1 ? leftoverGroup(rule, groups, round) : null;
  const advancingUnits = groups.flatMap((group) =>
    group.ranked.slice(0, group.ranked.length - group.whole - (group === taker ? 1 : 0)),
  );
  return { advancing: new Set(advancingUnits.map((unit) => unit.name)), leftover: taker?.size ?? null };
}

/** The advancing set, and the size of the room group that took the leftover elimination (size-proportional rules; null when none). */
export interface Decision {
  advancing: Set<string>;
  leftover: number | null;
}

export function decide(option: EOption, round: EliminationRound): Decision {
  switch (option) {
    case 'E0':
      return { advancing: perRoomWithLuckyLosers(round, byRelative), leftover: null };
    case 'E1b':
      return { advancing: perRoomWithLuckyLosers(round, byShareThenRelative), leftover: null };
    case 'E1a':
      return { advancing: oneCut(round, byShareThenRelative), leftover: null };
    case 'ER':
      return { advancing: oneCut(round, byRelative), leftover: null };
    case 'E2r':
    case 'E2c':
    case 'E2p':
      return sizeProportional(option, round);
  }
}

/** The units that advance under a rule. `E0` is the tool's own version of the engine's rule: it is checked against the engine's. */
export function advancing(option: EOption, round: EliminationRound): Set<string> {
  return decide(option, round).advancing;
}
