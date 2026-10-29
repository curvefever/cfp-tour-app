import { absentInRoom } from './absences';
import { isPoolingRound } from './pooling';
import type { WaveMember } from './seeding';
import type { RoundAssignment, TournamentRound, TournamentState } from './types';

/**
 * Under Standard points a place earns the same points in any room size, so a seat in a smaller room is
 * worth about half a point a round. These helpers spread those seats evenly over every room round with
 * mixed sizes: the counts are derived from the line-ups already drawn, never stored.
 */

/** What a smaller-room seat weighs in a round that earns no points (a warm-up, an uncounted round); every other round weighs 1. */
export const NO_POINTS_SEAT_WEIGHT = 0.5;

export interface SmallerRoomSplit {
  /** 1-based numbers of the rooms below the round's largest size. */
  smallRooms: number[];
  small: WaveMember[];
  large: WaveMember[];
}

/**
 * Whether the draw of `round` spreads its smaller-room seats: a pooling round (warm-up included) or an
 * ordinary room-based elimination round. Group stage, Semis, Final, waterfall, double elimination and
 * Kings Valley rounds have their own mechanisms and keep their draw.
 */
export function spreadsSmallerRoomSeats(round: TournamentRound): boolean {
  const ownMechanism =
    round.isGroupStage ||
    round.isSemis ||
    round.isFinal ||
    round.isWaterfall ||
    round.isKingsValley ||
    round.bracket;
  return !ownMechanism;
}

/** The flags that tell whether a round earns points. */
export type SeatWeightRound = Partial<
  Pick<TournamentRound, 'isQual' | 'isSwiss' | 'isNoElim' | 'excludeFromStandings'>
>;

/** How much a smaller-room seat of `round` weighs in the tally: less where the round earns no points (a warm-up, an uncounted round). */
export function smallerRoomSeatWeight(round: SeatWeightRound): number {
  const warmUp = round.isNoElim && !round.isQual && !round.isSwiss;
  return warmUp || round.excludeFromStandings ? NO_POINTS_SEAT_WEIGHT : 1;
}

function occupancyOf(lineUp: RoundAssignment[]): Map<number, number> {
  const occupancy = new Map<number, number>();
  for (const { room } of lineUp) {
    if (room !== null) occupancy.set(room, (occupancy.get(room) ?? 0) + 1);
  }
  return occupancy;
}

/**
 * For each unit, the seats it has held in a room smaller than the largest room of that line-up, each
 * weighing `weights[i]` for line-up i (1 where none is given). `absent[i]` holds the units that were
 * absent from line-up i: they hold no seat, and a room is as big as the units that were present in it,
 * against the largest room of the whole line-up.
 */
export function countSmallerRoomSeats(
  lineUps: RoundAssignment[][],
  weights: number[] = [],
  absent: ReadonlyArray<ReadonlySet<string>> = [],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [index, lineUp] of lineUps.entries()) {
    const weight = weights[index] ?? 1;
    const gone = absent[index];
    const largest = Math.max(0, ...occupancyOf(lineUp).values());
    const present = gone ? lineUp.filter(({ name }) => !gone.has(name)) : lineUp;
    const occupancy = occupancyOf(present);
    for (const { name, room } of present) {
      if (room !== null && (occupancy.get(room) ?? 0) < largest) counts[name] = (counts[name] ?? 0) + weight;
    }
  }
  return counts;
}

/** The units absent from each room of a round's line-up. */
function absentFromLineUp(state: TournamentState, roundIndex: number): Set<string> {
  const rooms = new Set(
    (state.assignments[roundIndex] ?? []).flatMap(({ room }) => (room === null ? [] : [room])),
  );
  return new Set([...rooms].flatMap((room) => absentInRoom(state, roundIndex, room)));
}

/** The weighted smaller-room seats each unit held in the spreading rounds drawn before `roundIndex`. */
export function smallerRoomSeatsBefore(state: TournamentState, roundIndex: number): Record<string, number> {
  const earlier = state.rounds
    .slice(0, roundIndex)
    .flatMap((round, index) => (spreadsSmallerRoomSeats(round) ? [{ round, index }] : []));
  return countSmallerRoomSeats(
    earlier.map(({ index }) => state.assignments[index] ?? []),
    earlier.map(({ round }) => smallerRoomSeatWeight(round)),
    earlier.map(({ index }) => absentFromLineUp(state, index)),
  );
}

/** The smaller rooms of a line-up and how many seats they hold; null when every room is the same size. */
function smallerRoomsOf(
  order: WaveMember[],
  roomSizes: number[],
): { smallRooms: number[]; seatCount: number } | null {
  const largest = Math.max(0, ...roomSizes);
  const smallRooms = roomSizes.flatMap((size, index) => (size < largest ? [index + 1] : []));
  if (smallRooms.length === 0) return null;
  const seatCount = smallRooms.reduce((sum, room) => sum + roomSizes[room - 1], 0);
  return { smallRooms, seatCount: Math.min(order.length, seatCount) };
}

/** How the members tied at the boundary count share the seats left: `stride` spreads the picks over the group, `best-first` takes the group's first. */
type TieRule = 'stride' | 'best-first';

/**
 * The names of the `count` members of `group` (best first) who take smaller-room seats: the fewest seats so
 * far first, the units in `lastForSmaller` after every other unit whatever their count. The members tied at
 * the boundary count share the seats left by `tieRule`: `stride` spreads the picks over `group`, so the
 * smaller rooms keep a mix of tiers; `best-first` gives them to the first of the tied members in `group`'s
 * order.
 */
function pickForSmallerRooms(
  group: WaveMember[],
  count: number,
  seats: Record<string, number>,
  lastForSmaller: ReadonlySet<string>,
  tieRule: TieRule,
): Set<string> {
  if (count === 0) return new Set();
  const keyOf = (member: WaveMember): [number, number] => [
    lastForSmaller.has(member.name) ? 1 : 0,
    seats[member.name] ?? 0,
  ];
  const isBefore = (first: [number, number], second: [number, number]) =>
    first[0] - second[0] || first[1] - second[1];
  const ranked = [...group].sort((first, second) => isBefore(keyOf(first), keyOf(second)));
  const boundary = keyOf(ranked[count - 1]);
  const picked = new Set(
    ranked.filter((member) => isBefore(keyOf(member), boundary) < 0).map((member) => member.name),
  );
  const tied = group.filter((member) => isBefore(keyOf(member), boundary) === 0);
  const remaining = count - picked.size;
  for (let index = 0; index < remaining; index += 1) {
    const position = tieRule === 'stride' ? Math.floor(((index + 0.5) * tied.length) / remaining) : index;
    picked.add(tied[position].name);
  }
  return picked;
}

function splitOf(order: WaveMember[], smallRooms: number[], picked: Set<string>): SmallerRoomSplit {
  return {
    smallRooms,
    small: order.filter((member) => picked.has(member.name)),
    large: order.filter((member) => !picked.has(member.name)),
  };
}

/**
 * Splits `order` (best tier first) into who takes the seats of the rooms below the largest size and who
 * takes the rest. The units with the fewest smaller-room seats so far take them; the units in
 * `lastForSmaller` come after every other unit whatever their count. Among the units tied at the boundary
 * count the picks are strided over `order`, so the smaller rooms keep a mix of tiers. Both groups keep
 * `order`'s order. Null when every room is the same size.
 */
export function splitForSmallerRooms(
  order: WaveMember[],
  roomSizes: number[],
  seats: Record<string, number>,
  lastForSmaller: ReadonlySet<string>,
): SmallerRoomSplit | null {
  const shape = smallerRoomsOf(order, roomSizes);
  if (!shape) return null;
  const picked = pickForSmallerRooms(order, shape.seatCount, seats, lastForSmaller, 'stride');
  return splitOf(order, shape.smallRooms, picked);
}

/**
 * How many of `seatCount` smaller-room seats each tier takes, in proportion to its size (largest remainder:
 * the floors first, the leftover seats to the largest fractional parts, the better tier first on equal
 * parts). `tierSizes` is in tier order, best first; no tier gets more seats than it has units.
 */
export function seatsPerTier(tierSizes: number[], seatCount: number): number[] {
  const total = tierSizes.reduce((sum, size) => sum + size, 0);
  const shares = tierSizes.map((size) => Math.floor((seatCount * size) / total));
  const leftover = seatCount - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = tierSizes
    .map((size, tier) => ({ tier, remainder: (seatCount * size) % total }))
    .sort((first, second) => second.remainder - first.remainder || first.tier - second.tier);
  for (const { tier } of byRemainder.slice(0, leftover)) shares[tier] += 1;
  return shares;
}

/**
 * The split for a round drawn after eliminations: results come first, so the smaller-room seats are shared
 * between the finishing places in proportion to their size (`seatsPerTier`), lucky losers in their own
 * place, instead of going to whoever has the fewest so far. Inside a tier the seats go to the units with
 * the fewest (late joiners last); units tied on that count take the seats best first in the tier's order
 * (relative score), because a seat that goes to one of them in any case is better given to the one that
 * earned it. Same result shape as `splitForSmallerRooms`.
 */
export function splitByFinishingPlace(
  order: WaveMember[],
  roomSizes: number[],
  seats: Record<string, number>,
  lastForSmaller: ReadonlySet<string>,
): SmallerRoomSplit | null {
  const shape = smallerRoomsOf(order, roomSizes);
  if (!shape) return null;
  const byTier = new Map<number, WaveMember[]>();
  for (const member of order) byTier.set(member.tierRank, [...(byTier.get(member.tierRank) ?? []), member]);
  const tiers = [...byTier].sort(([first], [second]) => first - second);
  const shares = seatsPerTier(
    tiers.map(([, members]) => members.length),
    shape.seatCount,
  );
  const picked = new Set(
    tiers.flatMap(([, members], index) => [
      ...pickForSmallerRooms(members, shares[index], seats, lastForSmaller, 'best-first'),
    ]),
  );
  return splitOf(order, shape.smallRooms, picked);
}

/**
 * Whether nobody has been eliminated before round `roundIndex`, read from the stored rounds: every pooling
 * round is drawn from the whole field; a later round is when every round before it advances all it seats
 * (`advTotal` reaches `players`; a warm-up does, and a withdrawal's refit keeps it) and no qualification
 * table, Swiss or group stage before it cuts the pool at its exit (the next round seats fewer than it did).
 */
export function isFullFieldRound(rounds: TournamentRound[], roundIndex: number): boolean {
  const round = rounds[roundIndex];
  if (!round) return false;
  if (isPoolingRound(round)) return true;
  return rounds.slice(0, roundIndex).every((earlier, index) => {
    const next = rounds[index + 1];
    const cutAtExit = isExitOfPoolingPhase(earlier, next) && next.players < earlier.players;
    return earlier.advTotal >= earlier.players && !cutAtExit;
  });
}

/** The last round of a qualification table, Swiss phase or group stage: the standings cut the pool after it. */
function isExitOfPoolingPhase(round: TournamentRound, next: TournamentRound | undefined): boolean {
  const standings = (candidate?: TournamentRound) => Boolean(candidate?.isQual || candidate?.isSwiss);
  if (round.isGroupStage) return !next?.isGroupStage;
  return standings(round) && !standings(next);
}
