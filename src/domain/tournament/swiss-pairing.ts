import { computeQualificationStandings, rankingPoints, samePoints } from './advancement';
import { lateJoinersOf } from './late-joiners';
import { levelRuns } from './level-runs';
import { metPairs, roomPairKey } from './seeding';
import type { RoomSize, RoundAssignment, TournamentState } from './types';

/** The most steps the rematch-free search may take before the plain pairing is used instead. */
const MAX_SEARCH_STEPS = 100_000;

type Pair = [string, string];

/** The units to pair, best first, and what each is worth in the standings (null: nothing played yet). */
interface RankedField {
  ranked: string[];
  joiners: string[];
  points: Map<string, number | null>;
}

/** The units in standings order (those missing from the standings after them); the late joiners apart, they have no level yet. */
function rankedField(state: TournamentState, activeNames: string[], throughRoundIndex: number): RankedField {
  const joiners = lateJoinersOf(state, throughRoundIndex).filter((name) => activeNames.includes(name));
  const standings = computeQualificationStandings(state).filter(
    (entry) => activeNames.includes(entry.name) && !joiners.includes(entry.name),
  );
  const ranked = standings.map((entry) => entry.name);
  for (const name of activeNames) {
    if (!ranked.includes(name) && !joiners.includes(name)) ranked.push(name);
  }
  const points = new Map(standings.map((entry) => [entry.name, rankingPoints(entry)]));
  return { ranked, joiners, points };
}

/** The bye of an odd field: of the units with the fewest byes so far, the lowest ranked. A late joiner takes it only when nobody else is left. */
function pickBye(field: RankedField, byeCounts: Record<string, number>): string {
  const eligible = field.ranked.length ? field.ranked : field.joiners;
  const fewest = Math.min(...eligible.map((name) => byeCounts[name] ?? 0));
  return eligible.filter((name) => (byeCounts[name] ?? 0) === fewest).at(-1) as string;
}

/** The units of equal standing points, best group first; each group in standings order. */
function scoreGroups(field: RankedField): string[][] {
  const pointsOf = (name: string) => field.points.get(name) ?? null;
  return levelRuns(field.ranked, (name, first) => samePoints(pointsOf(name), pointsOf(first))).map((run) =>
    field.ranked.slice(run.first, run.last + 1),
  );
}

/** The late joiners go to the end of the score group that holds the middle rank, so each meets a middle-ranked unit. */
function withJoiners(groups: string[][], joiners: string[]): string[][] {
  if (!joiners.length) return groups;
  if (!groups.length) return [joiners];
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const middle = Math.floor(total / 2);
  let before = 0;
  return groups.map((group) => {
    const holdsMiddle = middle >= before && middle < before + group.length;
    before += group.length;
    return holdsMiddle ? [...group, ...joiners] : group;
  });
}

/** What the plain rule pairs: every unit's partner, and the score group it is paired in (a floater counts to the group it floats into). */
interface PlainPairing {
  order: string[];
  position: Map<string, number>;
  partner: Map<string, string>;
  groupOf: Map<string, number>;
}

/** Each group pairs its top half against its bottom half; an odd group sends its lowest unit down, to be paired first in the next group. */
function plainPairing(groups: string[][]): PlainPairing {
  const partner = new Map<string, string>();
  const groupOf = new Map<string, number>();
  let floater: string[] = [];
  for (const [index, group] of groups.entries()) {
    const members = [...floater, ...group];
    floater = members.length % 2 !== 0 && index < groups.length - 1 ? [members.pop() as string] : [];
    const half = members.length / 2;
    for (const [position, name] of members.entries()) {
      groupOf.set(name, index);
      partner.set(name, members[position < half ? position + half : position - half]);
    }
  }
  const order = groups.flat();
  return { order, position: new Map(order.map((name, index) => [name, index])), partner, groupOf };
}

/** The plain pairs, best pair first, the higher ranked unit of each pair first. */
function pairsOf({ order, partner }: PlainPairing): Pair[] {
  const pairs: Pair[] = [];
  const paired = new Set<string>();
  for (const name of order) {
    if (paired.has(name)) continue;
    const opponent = partner.get(name) as string;
    paired.add(name).add(opponent);
    pairs.push([name, opponent]);
  }
  return pairs;
}

/**
 * The opponents to try for the highest unpaired unit, in order: its partner of the plain pairing, then the rest of its
 * group by nearness to that partner (the lower ranked first when two are as near), then the groups below in order.
 */
function opponentPreference(unit: string, others: string[], plain: PlainPairing): string[] {
  const { position } = plain;
  const anchor = position.get(plain.partner.get(unit) as string) as number;
  const group = plain.groupOf.get(unit);
  const sameGroup = others.filter((name) => plain.groupOf.get(name) === group);
  const below = others.filter((name) => plain.groupOf.get(name) !== group);
  const distance = (name: string) => Math.abs((position.get(name) as number) - anchor);
  sameGroup.sort((first, second) => {
    if (first === plain.partner.get(unit)) return -1;
    if (second === plain.partner.get(unit)) return 1;
    return (
      distance(first) - distance(second) || (position.get(second) as number) - (position.get(first) as number)
    );
  });
  return [...sameGroup, ...below];
}

/** A pairing of the whole field with no pair that has met, by searching over the order; null when there is none or the search is too long. */
function pairsWithoutRematch(plain: PlainPairing, met: Set<string>): Pair[] | null {
  const pairs: Pair[] = [];
  let steps = 0;
  const search = (remaining: string[]): boolean => {
    if (!remaining.length) return true;
    steps += 1;
    if (steps > MAX_SEARCH_STEPS) return false;
    const [unit, ...others] = remaining;
    for (const opponent of opponentPreference(unit, others, plain)) {
      if (met.has(roomPairKey(unit, opponent))) continue;
      pairs.push([unit, opponent]);
      if (search(others.filter((name) => name !== opponent))) return true;
      pairs.pop();
      if (steps > MAX_SEARCH_STEPS) return false;
    }
    return false;
  };
  return search(plain.order) ? pairs : null;
}

/** The plain pairs when every pairing has a rematch: a pair that has met trades second units with the next pair when that clears both. */
function pairsSwappingRematches(plain: PlainPairing, met: Set<string>): Pair[] {
  const pairs = pairsOf(plain);
  for (let index = 0; index + 1 < pairs.length; index += 1) {
    if (!met.has(roomPairKey(...pairs[index]))) continue;
    const swappedFirst: Pair = [pairs[index][0], pairs[index + 1][1]];
    const swappedSecond: Pair = [pairs[index + 1][0], pairs[index][1]];
    if (!met.has(roomPairKey(...swappedFirst)) && !met.has(roomPairKey(...swappedSecond))) {
      pairs[index] = swappedFirst;
      pairs[index + 1] = swappedSecond;
    }
  }
  return pairs;
}

/** The units of the field that are likely absent, in standings order. */
function absenteesOf(field: RankedField, likelyAbsent: ReadonlySet<string>): string[] {
  return field.ranked.filter((name) => likelyAbsent.has(name));
}

/** The pairs of `absentees` in standings order (1st v 2nd, 3rd v 4th), no pair that has met while one can be avoided: the first unit tries the next ones in order. */
function absenteePairs(absentees: string[], met: Set<string>): Pair[] {
  const pairs: Pair[] = [];
  let steps = 0;
  const search = (remaining: string[]): boolean => {
    if (!remaining.length) return true;
    steps += 1;
    if (steps > MAX_SEARCH_STEPS) return false;
    const [unit, ...others] = remaining;
    for (const opponent of others) {
      if (met.has(roomPairKey(unit, opponent))) continue;
      pairs.push([unit, opponent]);
      if (search(others.filter((name) => name !== opponent))) return true;
      pairs.pop();
    }
    return false;
  };
  if (search(absentees)) return pairs;
  // Every pairing has a rematch: the plain order, 1st v 2nd, 3rd v 4th.
  return absentees.flatMap((name, index): Pair[] => (index % 2 === 0 ? [[name, absentees[index + 1]]] : []));
}

/** The field without `names`. */
function without(field: RankedField, names: ReadonlySet<string>): RankedField {
  return {
    ...field,
    ranked: field.ranked.filter((name) => !names.has(name)),
    joiners: field.joiners.filter((name) => !names.has(name)),
  };
}

/**
 * The draw of an adaptive Swiss round (head-to-head rooms of two). An odd field gives the bye first (the lowest ranked
 * unit with the fewest byes). The rest are grouped by standing points, best group first, and each group pairs its top
 * half against its bottom half; an odd group sends its lowest unit down to the next. No pair meets twice while a pairing
 * without a rematch exists. Rooms are numbered in pairing order, the bye comes last without a room.
 *
 * With `likelyAbsent` (`absenceVersion` 4, a round after the tournament's first) the likely absentees are kept apart
 * from the present units: with an odd field and an odd number of them the last takes the bye (flagged `absentBye`),
 * the others pair among themselves in standings order (a leftover one in an even field joins the normal pairing), the
 * present units are paired as above over the field without them, and the absentee rooms come after the present ones.
 */
export function swissPair(options: {
  activeNames: string[];
  throughRoundIndex: number;
  roomSize: RoomSize;
  state: TournamentState;
  /** The likely absentees to pair together; empty when the round or the version rules it out. */
  likelyAbsent?: ReadonlySet<string>;
}): {
  seeded: RoundAssignment[];
  byeName: string | null;
  poolingByeCounts: Record<string, number>;
} {
  const { activeNames, throughRoundIndex, roomSize, state } = options;
  if (roomSize.ideal !== 2) {
    throw new Error(
      `swissPair requires a head-to-head room shape (roomSize.ideal === 2) — got ${roomSize.ideal}.`,
    );
  }
  const field = rankedField(state, activeNames, throughRoundIndex);
  const poolingByeCounts = { ...state.poolingByeCounts };
  const met = metPairs(state, throughRoundIndex, (roundIndex) => Boolean(state.rounds[roundIndex]?.isSwiss));
  const absentees = absenteesOf(field, options.likelyAbsent ?? new Set<string>());
  const oddField = (field.ranked.length + field.joiners.length) % 2 !== 0;
  let byeName: string | null = null;
  let absentBye = false;
  if (oddField && absentees.length % 2 !== 0) {
    byeName = absentees[absentees.length - 1];
    absentBye = true;
  } else if (oddField) {
    byeName = pickBye(without(field, new Set(absentees)), poolingByeCounts);
  }
  if (byeName) poolingByeCounts[byeName] = (poolingByeCounts[byeName] ?? 0) + 1;
  // The absentees that pair together: all but the bye-taker, and in an even field with an odd number, all but the last.
  const waiting = absentees.filter((name) => name !== byeName);
  const together = waiting.slice(0, waiting.length - (waiting.length % 2));
  const taken = new Set([...together, ...(byeName ? [byeName] : [])]);
  const presentField = without(field, taken);

  const plain = plainPairing(withJoiners(scoreGroups(presentField), presentField.joiners));
  const pairs = pairsWithoutRematch(plain, met) ?? pairsSwappingRematches(plain, met);
  const allPairs = [...pairs, ...absenteePairs(together, met)];

  const seeded: RoundAssignment[] = allPairs.flatMap(([first, second], index) => [
    { name: first, room: index + 1, isLucky: false },
    { name: second, room: index + 1, isLucky: false },
  ]);
  if (byeName)
    seeded.push({
      name: byeName,
      room: null,
      isLucky: false,
      ...(absentBye ? { absentBye: true as const } : {}),
    });
  return { seeded, byeName, poolingByeCounts };
}
