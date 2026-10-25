import type { EliminationRound, EliminationUnit } from './elimination';

/**
 * The cut rules of shape E (`plans/2026-10-25-room-size-fairness-simulation.md`), applied after the fact to a scored
 * elimination round. Every rule advances the same number of units as the engine's round.
 */
export const E_OPTIONS = ['E0', 'E1b', 'E1a', 'ER'] as const;
export type EOption = (typeof E_OPTIONS)[number];

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

/** The units that advance under a rule. `E0` is the tool's own version of the engine's rule: it is checked against the engine's. */
export function advancing(option: EOption, round: EliminationRound): Set<string> {
  switch (option) {
    case 'E0':
      return perRoomWithLuckyLosers(round, byRelative);
    case 'E1b':
      return perRoomWithLuckyLosers(round, byShareThenRelative);
    case 'E1a':
      return oneCut(round, byShareThenRelative);
    case 'ER':
      return oneCut(round, byRelative);
  }
}
