import { isStandingsCutoffRound, relativeRoomShare, roomUnitCount, scoreRoom } from './advancement';
import { orderRoomByScore } from './scoring';
import type { TournamentRound, TournamentState } from './types';

/**
 * The fair elimination cut (`gamemodeConfig.cutVersion` 2): a round that mixes room sizes makes each size of
 * room lose its fair share of the eliminations, instead of every room advancing the same number. The units
 * of one size are ranked together, and an elimination that does not divide evenly (a spare cut) falls on the
 * size whose next in line ranks lowest against every room of that size so far. A room's winner always advances
 * while the round keeps at least one unit per room. Rule and reasoning: `docs/rules.md`, "Lucky losers".
 */

/** A place that only some of a group's units get through from: the lucky chances ("★"). */
export interface FairCutChancePlace {
  place: number;
  /** Fewest units of the group's rooms that advance from this place. */
  minSpots: number;
  maxSpots: number;
}

/** The rooms of one line-up size in a round, and what the cut asks of them. Needs no scores. */
export interface FairCutGroup {
  size: number;
  /** Room numbers, ascending. */
  rooms: number[];
  /** The group's fair share of the eliminations (after the winners' cap). */
  whole: number;
  /** The share has a fractional part, so the group is first in line for a spare cut. */
  mayTakeSpare: boolean;
  /** Places 1…direct of every room always advance. */
  direct: number;
  /** Fewest and most units the group keeps over the spare cuts it may take. */
  minKeep: number;
  maxKeep: number;
  chancePlaces: FairCutChancePlace[];
  /** Spots over all chance places: how many of the group's units are lucky losers. */
  minSpots: number;
  maxSpots: number;
}

export interface FairCutShape {
  groups: FairCutGroup[];
  /** Eliminations left after every group took its whole share. */
  spare: number;
  /** A room's winner is guaranteed to advance (the round keeps at least one unit per room). */
  winnersSafe: boolean;
}

interface GroupPlan {
  size: number;
  rooms: number[];
  units: number;
  whole: number;
  remainder: number;
}

interface CutPlan {
  groups: GroupPlan[];
  spare: number;
  winnersSafe: boolean;
}

/** Negative when the first group's next in line ranks lower, so it takes the spare cut. */
type SpareOrder = (first: number, second: number, taken: readonly number[]) => number;

interface SpareCutTaken {
  eligible: number[];
  loser: number;
  /** The cuts each group has taken before this one. */
  taken: readonly number[];
}

function roomsBySize(lineUps: readonly number[]): Map<number, number[]> {
  const bySize = new Map<number, number[]>();
  lineUps.forEach((size, index) => {
    if (size < 2) return;
    bySize.set(size, [...(bySize.get(size) ?? []), index + 1]);
  });
  return bySize;
}

/** Each size's whole share, capped so a room keeps its winner while `survivors` allows it, and the cuts left over. */
function planCut(lineUps: readonly number[], survivors: number): CutPlan {
  const bySize = roomsBySize(lineUps);
  const total = [...bySize].reduce((sum, [size, rooms]) => sum + size * rooms.length, 0);
  const contested = [...bySize.values()].reduce((sum, rooms) => sum + rooms.length, 0);
  const eliminations = Math.max(0, total - survivors);
  const winnersSafe = survivors >= contested;
  const groups = [...bySize]
    .sort(([first], [second]) => second - first)
    .map(([size, rooms]): GroupPlan => {
      const units = size * rooms.length;
      const whole = Math.floor((eliminations * units) / total);
      const capped = winnersSafe ? Math.min(whole, units - rooms.length) : whole;
      return { size, rooms, units, whole: capped, remainder: (eliminations * units) % total };
    });
  const spare = eliminations - groups.reduce((sum, group) => sum + group.whole, 0);
  return { groups, spare, winnersSafe };
}

/**
 * Hands the spare cuts out one at a time, to the group `order` ranks lowest among the eligible: first the groups
 * with a fractional share that have not taken one and keep more than their rooms need, then, only when there are
 * none, any group that can still lose a unit. Returns the cuts each group took.
 */
function allocateSpares(plan: CutPlan, order: SpareOrder, onCut?: (cut: SpareCutTaken) => void): number[] {
  const taken = plan.groups.map(() => 0);
  const canLose = (index: number): boolean => {
    const group = plan.groups[index];
    return group.units - group.whole - taken[index] > (plan.winnersSafe ? group.rooms.length : 0);
  };
  const indices = plan.groups.map((_, index) => index);
  for (let cut = 0; cut < plan.spare; cut += 1) {
    const first = indices.filter(
      (index) => plan.groups[index].remainder > 0 && taken[index] === 0 && canLose(index),
    );
    const eligible = first.length > 0 ? first : indices.filter(canLose);
    if (eligible.length === 0) break;
    const loser = eligible.reduce((lowest, index) => (order(index, lowest, taken) < 0 ? index : lowest));
    onCut?.({ eligible, loser, taken });
    taken[loser] += 1;
  }
  return taken;
}

/** The spare cuts a group takes when its next in line always ranks lowest (`lowest`) or highest. */
function spareCutsTaken(plan: CutPlan, target: number, lowest: boolean): number {
  const order: SpareOrder = (first, second) => {
    if (first === target) return lowest ? -1 : 1;
    if (second === target) return lowest ? 1 : -1;
    return second - first;
  };
  return allocateSpares(plan, order)[target];
}

function chancePlaces(rooms: number, minKeep: number, maxKeep: number, direct: number): FairCutChancePlace[] {
  const places: FairCutChancePlace[] = [];
  const spotsAt = (keep: number, place: number) => Math.min(rooms, Math.max(0, keep - (place - 1) * rooms));
  for (let place = direct + 1; (place - 1) * rooms < maxKeep; place += 1) {
    places.push({ place, minSpots: spotsAt(minKeep, place), maxSpots: spotsAt(maxKeep, place) });
  }
  return places;
}

function describeGroup(plan: CutPlan, index: number): FairCutGroup {
  const group = plan.groups[index];
  const roomCount = group.rooms.length;
  const keepBase = group.units - group.whole;
  const minKeep = keepBase - spareCutsTaken(plan, index, true);
  const maxKeep = keepBase - spareCutsTaken(plan, index, false);
  const direct = Math.floor(minKeep / roomCount);
  const places = chancePlaces(roomCount, minKeep, maxKeep, direct);
  return {
    size: group.size,
    rooms: group.rooms,
    whole: group.whole,
    mayTakeSpare: group.remainder > 0,
    direct,
    minKeep,
    maxKeep,
    chancePlaces: places,
    minSpots: places.reduce((sum, place) => sum + place.minSpots, 0),
    maxSpots: places.reduce((sum, place) => sum + place.maxSpots, 0),
  };
}

/**
 * What the cut asks of each room size, before any score is in. `lineUps` is the units placed in each room (room
 * number = index + 1; a room of fewer than 2 units is not part of the cut); `survivors` is how many of the
 * contested rooms' units advance.
 */
export function fairCutShape(lineUps: readonly number[], survivors: number): FairCutShape {
  const plan = planCut(lineUps, survivors);
  return {
    groups: plan.groups.map((_, index) => describeGroup(plan, index)),
    spare: plan.spare,
    winnersSafe: plan.winnersSafe,
  };
}

/** The units of a round's contested rooms that advance, once its byes and lone units are taken off its target. */
export function fairCutSurvivors(round: TournamentRound, lineUps: readonly number[]): number {
  const lone = lineUps.filter((size) => size === 1).length;
  return Math.max(0, round.advTotal - round.byeCount - lone);
}

/** A covered round's line-ups: the real ones once the round is drawn, the planned room sizes before. */
export function roundLineUps(state: TournamentState, roundIndex: number): number[] {
  const round = state.rounds[roundIndex];
  if (!(state.assignments[roundIndex] ?? []).length) return [...round.rooms];
  return round.rooms.map((_, index) => roomUnitCount(state, roundIndex, index + 1));
}

/** The cut's shape for a round: from the real line-ups once drawn, from the planned sizes before. */
export function roundFairCutShape(state: TournamentState, roundIndex: number): FairCutShape {
  const lineUps = roundLineUps(state, roundIndex);
  return fairCutShape(lineUps, fairCutSurvivors(state.rounds[roundIndex], lineUps));
}

/**
 * The one switch for the fair cut: the tournament has `cutVersion` 2 and the round is one that cuts by "so many per
 * room plus lucky losers" today (single elimination, Semis, a double elimination winners or losers round), not a
 * standings cut-off, the Final, the grand final, Kings Valley or a waterfall.
 */
export function usesFairCut(state: TournamentState, roundIndex: number): boolean {
  const round = state.rounds[roundIndex];
  if (!round || state.gamemodeConfig.cutVersion !== 2) return false;
  return roundCoversFairCut(round) && !isStandingsCutoffRound(state, roundIndex);
}

/** The kind of round the fair cut covers, whatever the tournament's version (a standings cut-off is a Qual, Swiss or group-stage round, which this leaves out). */
export function roundCoversFairCut(round: TournamentRound): boolean {
  if (round.isFinal || round.isNoElim) return false;
  if (round.bracket) return round.bracket === 'winners' || round.bracket === 'losers';
  return !(
    round.isQual ||
    round.isSwiss ||
    round.isGroupStage ||
    round.isKingsValley ||
    round.isWaterfall ||
    round.standingsRoutes
  );
}

/** Share of the pool strictly below `value`, equal values counting half. */
function percentileOf(pool: readonly number[], value: number): number {
  const below = pool.filter((other) => other < value).length;
  const equal = pool.filter((other) => other === value).length;
  return (below + equal / 2) / pool.length;
}

/** The relative scores of every room of each line-up size, in the rounds from the first up to and including `roundIndex`. */
export function sizePools(state: TournamentState, roundIndex: number): Map<number, number[]> {
  const pools = new Map<number, number[]>();
  for (let index = 0; index <= roundIndex; index += 1) {
    const rooms = new Set(
      (state.assignments[index] ?? []).flatMap((entry) => (entry.room === null ? [] : [entry.room])),
    );
    for (const room of rooms) {
      const size = roomUnitCount(state, index, room);
      const scored = scoreRoom(state, index, room, 0);
      if (size < 2 || scored.reduce((sum, entry) => sum + entry.score, 0) <= 0) continue;
      const pool = pools.get(size) ?? [];
      pool.push(...scored.map((entry) => relativeRoomShare(entry.score, scored, entry.players)));
      pools.set(size, pool);
    }
  }
  return pools;
}

/** One unit of a contested room, with where it finished. */
export interface FairCutUnit {
  name: string;
  room: number;
  /** Place in its room, manual tie-breaks included. */
  place: number;
  /** Score relative to the room average (1 = average). */
  relative: number;
  /** The room has a score above 0: an all-zero room offers no lucky loser. */
  roomScored: boolean;
}

export interface FairCutGroupResult extends FairCutGroup {
  /** The group's units best first: place, then relative score, then room number; an all-zero room's units last of their place. */
  ranked: FairCutUnit[];
  /** How many units the rank keeps once the spare cuts the group took are counted. */
  keep: number;
  /** The units at the group's chance places, place first and best first within a place: the group's lucky-loser race. Empty when the group has no chance place. */
  candidates: FairCutUnit[];
}

export interface SpareCutContender {
  size: number;
  unit: FairCutUnit;
  /** Share of the same-size rooms' relative scores below this unit's, so far (0 to 1; -1 for an all-zero room). */
  percentile: number;
}

/** One spare cut: the groups it was contested between, and the unit that goes out. */
export interface SpareCutResult {
  contenders: SpareCutContender[];
  out: SpareCutContender;
}

export interface FairCutResult {
  /** Lone units and the units the cut keeps: places up to `direct` in room order, then the lucky losers (`isLucky`). */
  advancing: Array<{ name: string; isLucky: boolean }>;
  luckyNames: string[];
  /** Every other unit placed in the round's rooms, in room order. */
  eliminated: string[];
  groups: FairCutGroupResult[];
  spareCuts: SpareCutResult[];
}

function rankKey(unit: FairCutUnit): number {
  return unit.roomScored ? unit.relative : -1;
}

/** Best first: place, then relative score, then the lower room number. */
function compareRanked(first: FairCutUnit, second: FairCutUnit): number {
  return first.place - second.place || rankKey(second) - rankKey(first) || first.room - second.room;
}

function contestedRoomUnits(state: TournamentState, roundIndex: number, room: number): FairCutUnit[] {
  const ordered = orderRoomByScore(scoreRoom(state, roundIndex, room, 0), roundIndex, room, state);
  const roomScored = ordered.reduce((sum, entry) => sum + entry.score, 0) > 0;
  return ordered.map((entry, index) => ({
    name: entry.name,
    room,
    place: index + 1,
    relative: relativeRoomShare(entry.score, ordered, entry.players),
    roomScored,
  }));
}

function contender(unit: FairCutUnit, size: number, pools: Map<number, number[]>): SpareCutContender {
  const percentile = unit.roomScored ? percentileOf(pools.get(size) ?? [], unit.relative) : -1;
  return { size, unit, percentile };
}

/** Negative when the first contender goes out: lower percentile, then lower relative score, then the later room. */
function compareContenders(first: SpareCutContender, second: SpareCutContender): number {
  return (
    first.percentile - second.percentile ||
    rankKey(first.unit) - rankKey(second.unit) ||
    second.unit.room - first.unit.room
  );
}

/**
 * Who advances from a covered round (`usesFairCut`), from the scores so far. A unit with no score counts as a last
 * place, as today, so the result is live while a round is being played. Percentiles read the rounds up to this one only.
 */
export function fairCutAdvancement(state: TournamentState, roundIndex: number): FairCutResult {
  const round = state.rounds[roundIndex];
  const lineUps = roundLineUps(state, roundIndex);
  const plan = planCut(lineUps, fairCutSurvivors(round, lineUps));
  const shapes = plan.groups.map((_, index) => describeGroup(plan, index));
  const pools = sizePools(state, roundIndex);

  const unitsByRoom = new Map<number, FairCutUnit[]>();
  lineUps.forEach((size, index) => {
    if (size >= 1) unitsByRoom.set(index + 1, contestedRoomUnits(state, roundIndex, index + 1));
  });
  const ranked = plan.groups.map((group) =>
    group.rooms.flatMap((room) => unitsByRoom.get(room) ?? []).sort(compareRanked),
  );
  const nextInLine = (index: number, taken: readonly number[]): SpareCutContender => {
    const group = plan.groups[index];
    return contender(ranked[index][group.units - group.whole - taken[index] - 1], group.size, pools);
  };

  const spareCuts: SpareCutResult[] = [];
  const order: SpareOrder = (first, second, cuts) =>
    compareContenders(nextInLine(first, cuts), nextInLine(second, cuts));
  const taken = allocateSpares(plan, order, (cut) => {
    spareCuts.push({
      contenders: cut.eligible.map((index) => nextInLine(index, cut.taken)),
      out: nextInLine(cut.loser, cut.taken),
    });
  });

  const advancingNames = new Set<string>();
  const luckyUnits: FairCutUnit[] = [];
  const groups = plan.groups.map((group, index): FairCutGroupResult => {
    const shape = shapes[index];
    const keep = group.units - group.whole - taken[index];
    for (const unit of ranked[index].slice(0, keep)) {
      if (unit.place <= shape.direct) advancingNames.add(unit.name);
      else if (unit.roomScored) {
        advancingNames.add(unit.name);
        luckyUnits.push(unit);
      }
    }
    const chancePlaces = new Set(shape.chancePlaces.map((place) => place.place));
    const candidates = ranked[index].filter((unit) => chancePlaces.has(unit.place));
    return { ...shape, ranked: ranked[index], keep, candidates };
  });
  const luckyNames = luckyUnits
    .sort((first, second) => second.relative - first.relative || first.room - second.room)
    .map((unit) => unit.name);
  const luckySet = new Set(luckyNames);

  const advancing: FairCutResult['advancing'] = [];
  const eliminated: string[] = [];
  for (const units of unitsByRoom.values()) {
    for (const unit of units) {
      if (luckySet.has(unit.name)) continue;
      if (units.length === 1 || advancingNames.has(unit.name))
        advancing.push({ name: unit.name, isLucky: false });
      else eliminated.push(unit.name);
    }
  }
  advancing.push(...luckyNames.map((name) => ({ name, isLucky: true })));
  return { advancing, luckyNames, eliminated, groups, spareCuts };
}

/** One unit in a group's lucky-loser race. */
export interface FairCutRaceUnit {
  name: string;
  room: number;
  relative: number;
  /** Among the lucky losers if the round ended now. */
  leading: boolean;
  /** Its group can still take a spare cut, and this unit is the one in line for it. */
  spareCut: boolean;
}

/** The lucky-loser race of one room size. */
export interface FairCutRaceGroup {
  size: number;
  rooms: number;
  minSpots: number;
  maxSpots: number;
  units: FairCutRaceUnit[];
}

export interface FairCutRace {
  groups: FairCutRaceGroup[];
  spareCuts: SpareCutResult[];
}

/**
 * The live lucky-loser race of a covered round with two or more room sizes: per size that has lucky spots, its
 * chance-place units best first, and the spare-cut contests as they stand. Null for any other round. Read from
 * `fairCutAdvancement`, so it can never disagree with the advance.
 */
export function fairCutRace(state: TournamentState, roundIndex: number): FairCutRace | null {
  if (!usesFairCut(state, roundIndex)) return null;
  const result = fairCutAdvancement(state, roundIndex);
  if (result.groups.length < 2) return null;
  const leading = new Set(result.luckyNames);
  const inLine = new Set(result.spareCuts.flatMap((cut) => cut.contenders.map((entry) => entry.unit.name)));
  const groups = result.groups
    .filter((group) => group.maxSpots > 0)
    .map((group): FairCutRaceGroup => ({
      size: group.size,
      rooms: group.rooms.length,
      minSpots: group.minSpots,
      maxSpots: group.maxSpots,
      units: group.candidates
        .filter((unit) => unit.roomScored)
        .map((unit) => ({
          name: unit.name,
          room: unit.room,
          relative: unit.relative,
          leading: leading.has(unit.name),
          spareCut: group.mayTakeSpare && inLine.has(unit.name),
        })),
    }));
  return { groups, spareCuts: result.spareCuts };
}
