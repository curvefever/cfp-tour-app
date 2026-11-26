import { buildAdvancementTiers, exitOrderTiers } from './advancement';
import { isStandingsCutoffRound } from './cutoff-rounds';
import { lateJoinersOf } from './late-joiners';
import { likelyAbsentees } from './likely-absentees';
import type { GroupExitSelection } from './group-exit';
import { hasSwissPooling, isPoolingRound } from './pooling';
import { pairsLikelyAbsentees } from './rule-versions';
import {
  isFullFieldRound,
  smallerRoomSeatsBefore,
  splitByFinishingPlace,
  splitForSmallerRooms,
  spreadsSmallerRoomSeats,
} from './smaller-room-seats';
import { avoidMetPairsNearRank, metPairs } from './room-history';
import type { RandomSource } from './runtime';
import { fillRoomsByWaves, inPoolOrder, placeLikelyAbsentees, type WaveMember } from './wave-fill';
import type {
  PendingBracketSeed,
  RoundAssignment,
  TournamentGroup,
  TournamentRound,
  TournamentState,
} from './types';

export interface SeedCandidate {
  name: string;
  isLucky?: boolean;
}

function candidateName(candidate: string | SeedCandidate): string {
  return typeof candidate === 'string' ? candidate : candidate.name;
}

/**
 * Best first into the rooms in passes: rooms 1..R, then R..1, then 1..R again, a full room skipped (`rooms` is the
 * room sizes, or a count for rooms of any size). The best meets the weakest in a pair of rooms, whatever the sizes.
 */
export function snakeSeed(
  candidates: Array<string | SeedCandidate>,
  rooms: number | readonly number[],
): RoundAssignment[] {
  const free = typeof rooms === 'number' ? Array.from({ length: rooms }, () => Infinity) : [...rooms];
  const assignments: RoundAssignment[] = [];
  if (free.length === 0) return assignments;
  for (let pass = 0; assignments.length < candidates.length; pass += 1) {
    const order = free.map((_, room) => room);
    if (pass % 2 === 1) order.reverse();
    const open = order.filter((room) => free[room] > 0);
    // More units than seats: the passes go on over every room.
    if (open.length === 0) free.fill(Infinity);
    for (const room of open.length > 0 ? open : order) {
      const candidate = candidates[assignments.length];
      if (candidate === undefined) break;
      free[room] -= 1;
      assignments.push({
        name: candidateName(candidate),
        room: room + 1,
        isLucky: typeof candidate === 'string' ? false : Boolean(candidate.isLucky),
      });
    }
  }
  return assignments;
}

/**
 * Slices an already-ordered (best-to-worst) list of names into consecutive
 * chunks matching `roomSizes` -- unlike snakeSeed, this does not reorder or
 * interleave anything, since the input is already globally meaningful (Kings
 * Valley's per-room promote/stay/demote merge). The target round's room
 * sizes are decided independently at generation time and are trusted as-is.
 */
export function sequentialSeed(orderedNames: string[], roomSizes: number[]): RoundAssignment[] {
  const assignments: RoundAssignment[] = [];
  let index = 0;
  for (const [roomIndex, size] of roomSizes.entries()) {
    for (let position = 0; position < size; position += 1) {
      const name = orderedNames[index];
      index += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: false });
    }
  }
  return assignments;
}

export function randomSeed(names: string[], rooms: number[], random: RandomSource): RoundAssignment[] {
  const shuffled = [...names];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const assignments: RoundAssignment[] = [];
  let playerIndex = 0;
  for (const [roomIndex, roomSize] of rooms.entries()) {
    for (let position = 0; position < roomSize; position += 1) {
      playerIndex += 1;
      assignments.push({
        name: shuffled[playerIndex - 1] ?? `Player ${playerIndex}`,
        room: roomIndex + 1,
        isLucky: false,
      });
    }
  }
  return assignments;
}

/** Who the group exit sent through: the exit order, and each group's units in table order (index + 1 is the group place). */
export type GroupExitOrder = Pick<GroupExitSelection, 'advancing' | 'throughByGroup'>;

interface SwapCandidate {
  name: string;
  room: number;
  index: number;
}

/**
 * The unit to swap with a colliding one. Without the group exit, the first that fits. With it, the closest to the
 * moving unit in exit order (the first room on a tie), among the units of the same group place if any fits (a winner
 * stays against a runner-up, not another winner), otherwise among all that fit: best against weakest holds as far as
 * the group-mates allow.
 */
function swapPartner(
  fitting: readonly SwapCandidate[],
  moving: string,
  exit: GroupExitOrder | undefined,
): SwapCandidate | undefined {
  if (!exit || fitting.length === 0) return fitting[0];
  const placeOf = new Map(
    exit.throughByGroup.flatMap((names) => names.map((name, position) => [name, position + 1] as const)),
  );
  const rank = (name: string) => exit.advancing.indexOf(name);
  const place = placeOf.get(moving);
  const samePlace = fitting.filter(
    (candidate) => place !== undefined && placeOf.get(candidate.name) === place,
  );
  const candidates = samePlace.length > 0 ? samePlace : fitting;
  const distance = (candidate: SwapCandidate) =>
    rank(moving) < 0 || rank(candidate.name) < 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(rank(candidate.name) - rank(moving));
  return candidates.reduce((closest, candidate) =>
    distance(candidate) < distance(closest) ? candidate : closest,
  );
}

/**
 * Best effort: a unit that shares a room with a group-mate swaps rooms with a unit that fits (its group not in this
 * room, the moving unit's group not in that room). With the group exit given, the partner is preferably a unit of the
 * same group place, closest in exit order, so the seeding holds (else the closest that fits); a collision with no fitting swap stays.
 */
export function avoidSameGroupInFirstBracketRound(
  input: RoundAssignment[],
  groups: TournamentGroup[],
  exit?: GroupExitOrder,
): RoundAssignment[] {
  const seeded = input.map((entry) => ({ ...entry }));
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const member of group.members) groupOf.set(member, group.label);
  }
  const byRoom = new Map<number, number[]>();
  for (const [index, entry] of seeded.entries()) {
    if (entry.room === null) continue;
    byRoom.set(entry.room, [...(byRoom.get(entry.room) ?? []), index]);
  }

  for (const [room, originalIndices] of byRoom) {
    let indices = originalIndices;
    let progress = true;
    while (progress) {
      progress = false;
      const seen = new Set<string>();
      let collisionIndex = -1;
      for (const index of indices) {
        const group = groupOf.get(seeded[index].name);
        if (group === undefined) continue;
        if (seen.has(group)) {
          collisionIndex = index;
          break;
        }
        seen.add(group);
      }
      if (collisionIndex === -1) break;

      const roomGroups = indices.map((index) => groupOf.get(seeded[index].name));
      const movedGroup = groupOf.get(seeded[collisionIndex].name);
      const fitting: SwapCandidate[] = [];
      for (const [otherRoom, otherIndices] of byRoom) {
        if (otherRoom === room) continue;
        const otherGroups = otherIndices.map((index) => groupOf.get(seeded[index].name));
        if (movedGroup !== undefined && otherGroups.includes(movedGroup)) continue;
        for (const index of otherIndices) {
          const candidateGroup = groupOf.get(seeded[index].name);
          if (candidateGroup === undefined || roomGroups.includes(candidateGroup)) continue;
          fitting.push({ name: seeded[index].name, room: otherRoom, index });
        }
      }
      const partner = swapPartner(fitting, seeded[collisionIndex].name, exit);
      if (!partner) break;

      const temporaryRoom = seeded[collisionIndex].room;
      seeded[collisionIndex].room = seeded[partner.index].room;
      seeded[partner.index].room = temporaryRoom;
      indices = indices.map((index) => (index === collisionIndex ? partner.index : index));
      byRoom.set(room, indices);
      byRoom.set(
        partner.room,
        (byRoom.get(partner.room) ?? []).map((index) => (index === partner.index ? collisionIndex : index)),
      );
      progress = true;
    }
  }
  return seeded;
}

/**
 * A pool that arrives in standings order (a waterfall round fed only by the Qual or Groups source: `tierRank` is the
 * standing within the pool), drawn like the first bracket round after a pooling exit: the snake over the rooms, then
 * the separation for the kind of pooling phase. After a group stage (`groups` given) the group-mates apart, with the
 * group places from `throughByGroup`; otherwise the separation of `separateAfterExit`.
 */
export function seedPoolByStanding(options: {
  pool: PendingBracketSeed[];
  roomSizes: number[];
  state: Pick<TournamentState, 'assignments' | 'rounds'>;
  targetRoundIndex: number;
  groups?: { groups: TournamentGroup[]; throughByGroup: string[][] };
  /** The units of the pool likely to be absent (`likelyAbsentees`): placed first, one to a room. */
  likelyAbsent?: ReadonlySet<string>;
}): RoundAssignment[] {
  const { pool, roomSizes, state, targetRoundIndex, groups } = options;
  const ordered = [...pool].sort((first, second) => first.tierRank - second.tierRank);
  return snakeAroundLikelyAbsentees(
    ordered,
    roomSizes,
    options.likelyAbsent ?? new Set<string>(),
    targetRoundIndex,
    (snake, exitOrder) =>
      groups
        ? avoidSameGroupInFirstBracketRound(snake, groups.groups, {
            advancing: exitOrder,
            throughByGroup: groups.throughByGroup,
          })
        : separateAfterExit(state, targetRoundIndex - 1)(snake, exitOrder),
  );
}

/**
 * The separation after the snake, for an exit that is not a group stage: a qualification table trades the units that
 * have met (`avoidMetPairsNearRank`); a Swiss is drawn strictly by the standings, rematches allowed (its rounds
 * already refuse a rematch where they can, and the standings reflect who each unit faced).
 */
function separateAfterExit(
  state: Pick<TournamentState, 'assignments' | 'rounds'>,
  throughRoundIndex: number,
): (snake: RoundAssignment[], exitOrder: string[]) => RoundAssignment[] {
  if (hasSwissPooling(state)) return (snake) => snake;
  return (snake, exitOrder) => avoidMetPairsNearRank(snake, exitOrder, metPairs(state, throughRoundIndex));
}

/**
 * The snake over the rooms for candidates in exit order (best first), with the likely absentees placed first, one to
 * a room (`placeLikelyAbsentees`): the others snake into the seats left, and `separate` (the near-neighbour or
 * group-mate pass) works over them alone. Without a likely absentee it is the plain snake and separation.
 */
function snakeAroundLikelyAbsentees(
  ordered: SeedCandidate[],
  roomSizes: readonly number[],
  likelyAbsent: ReadonlySet<string>,
  targetRoundIndex: number,
  separate: (snake: RoundAssignment[], exitOrder: string[]) => RoundAssignment[],
): RoundAssignment[] {
  const members = ordered.map((candidate, index) => ({ name: candidate.name, tierRank: index }));
  const weights = { roomHistory: {}, targetRoundIndex, diversityWeight: 0, balanceWeight: 1 };
  const { placed, seatsLeft, rest } = placeLikelyAbsentees(members, roomSizes, likelyAbsent, weights);
  const others = ordered.filter((candidate) => rest.some((member) => member.name === candidate.name));
  const seeded = separate(
    snakeSeed(others, seatsLeft),
    others.map((candidate) => candidate.name),
  );
  const luckyNames = new Set(
    ordered.filter((candidate) => candidate.isLucky).map((candidate) => candidate.name),
  );
  const absentees: RoundAssignment[] = placed.map(({ name, room }) => ({
    name,
    room,
    isLucky: luckyNames.has(name),
  }));
  return inPoolOrder(absentees, seeded, members);
}

/**
 * The first bracket round after a qualification table, Swiss or group stage, drawn by the exit order (`advancing`,
 * best first): the snake over the round's rooms, so the best meets the weakest, then the separation pass for the kind
 * of pooling phase. Groups: the group-mates apart (`avoidSameGroupInFirstBracketRound`); a qualification table: the units
 * that have met before, by a trade with a near neighbour in the order; a Swiss: none, strictly by the standings. A seeding
 * override keeps its own fill, over the same order.
 */
export function seedFromPoolingExit(options: {
  state: TournamentState;
  roundIndex: number;
  advancing: SeedCandidate[];
  seedingOverride?: SeedingOverride;
  groupExit?: GroupExitOrder;
}): RoundAssignment[] {
  const { state, roundIndex, advancing, seedingOverride, groupExit } = options;
  const isGroupExit = state.rounds[roundIndex]?.isGroupStage;
  let seeded: RoundAssignment[];
  if (seedingOverride) {
    seeded = tieredSeed({ state, roundIndex, advancing, seedingOverride }).seeded;
  } else {
    const rooms = state.rounds[roundIndex + 1]?.rooms ?? [];
    seeded = isGroupExit
      ? snakeSeed(advancing, rooms)
      : snakeAroundLikelyAbsentees(
          advancing,
          rooms,
          likelyAbsentees(state, roundIndex + 1),
          roundIndex + 1,
          separateAfterExit(state, roundIndex),
        );
  }
  return isGroupExit ? avoidSameGroupInFirstBracketRound(seeded, state.groups, groupExit) : seeded;
}

/** Whether a draw of this round puts the likely absentees together: `absenceVersion` 4, a pooling round of rooms of two (a Swiss included) after the tournament's first. */
export function pairsAbsenteesInRound(
  state: Pick<TournamentState, 'gamemodeConfig'>,
  round: TournamentRound,
  roundIndex: number,
): boolean {
  return (
    roundIndex > 0 &&
    pairsLikelyAbsentees(state) &&
    isPoolingRound(round) &&
    round.rooms.every((size) => size <= 2)
  );
}

/** The same, for the room draw (`tieredSeed`): a Swiss round pairs them in `swissPair` and never reaches it. */
function seedingPairsAbsentees(
  state: Pick<TournamentState, 'gamemodeConfig'>,
  round: TournamentRound,
  roundIndex: number,
): boolean {
  return !round.isSwiss && pairsAbsenteesInRound(state, round, roundIndex);
}

export function selectPoolingBye(
  advancing: SeedCandidate[],
  counts: Record<string, number>,
): SeedCandidate | undefined {
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of advancing) {
    minimum = Math.min(minimum, counts[candidate.name] ?? 0);
  }
  return advancing.find((candidate) => (counts[candidate.name] ?? 0) === minimum);
}

/** Repeat-avoidance vs room-average-balance priority at the very start of the
 * no-elim/pooling phase (progress=0) and at the reseed deciding Semis'
 * own room composition (progress=1) -- see semisApproachProgress. Both pairs
 * are naturally comparable small-integer magnitudes (repeat-pair counts and
 * tier-rank deviations are both typically single digits per candidate), so
 * no extra normalization is needed between them. The most "taste"-driven
 * constants in this feature -- tunable, unlike RECENCY_REPEAT_WEIGHT_K these
 * have no independent empirical validation beyond reproducing the originally
 * validated (progress=0) prototype's behavior. */
export const DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP = 10;
const DIVERSITY_PRIORITY_WEIGHT_AT_SEMIS = 1;
export const BALANCE_PRIORITY_WEIGHT_AT_WARMUP = 1;
const BALANCE_PRIORITY_WEIGHT_AT_SEMIS = 6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

export type SeedingOverride = 'diversity' | 'balance' | 'random';

/** Fixed diversity/balance weight pairs for a 'diversity'/'balance' seedingOverride -- bypasses the automatic taper entirely rather than pinning it to either end of the taper's own scale (which still blends in some of the other priority). */
const SEEDING_OVERRIDE_WEIGHTS: Record<
  'diversity' | 'balance',
  { diversityWeight: number; balanceWeight: number }
> = {
  diversity: { diversityWeight: 1, balanceWeight: 0 },
  balance: { diversityWeight: 0, balanceWeight: 1 },
};

/** Deterministic (seeded) 32-bit hash, so a 'random' seedingOverride still produces a pure function of tournament state -- no RandomSource threads through advanceTournamentRound anywhere else, and this keeps that invariant intact. */
function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 'random' seedingOverride's room assignment -- a deterministically-seeded Fisher-Yates shuffle (same algorithm as randomSeed()'s real-RandomSource version), keyed on target round + the exact candidate set so it's still a pure function of state. */
function seededRandomRoomAssignment(
  names: string[],
  rooms: number[],
  seedKey: string,
  isLuckyByName: Map<string, boolean>,
): RoundAssignment[] {
  const shuffled = [...names];
  const random = seededRandom(hashSeed(`${seedKey}:${[...names].sort().join(',')}`));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const assignments: RoundAssignment[] = [];
  let cursor = 0;
  for (const [roomIndex, size] of rooms.entries()) {
    for (let position = 0; position < size; position += 1) {
      const name = shuffled[cursor];
      cursor += 1;
      if (name === undefined) continue;
      assignments.push({ name, room: roomIndex + 1, isLucky: isLuckyByName.get(name) ?? false });
    }
  }
  return assignments;
}

/**
 * 0 throughout the no-elim/pooling phase (nothing is ever cut there, so
 * diversity should stay fully prioritized) and at the very first real
 * elimination round; rises to 1 exactly at the round transitioning INTO
 * Semis (the last round with a genuine multi-room split to reseed -- the
 * Final is always a single literal room). Reasoning: room composition FOR
 * round K (decided by the reseed transitioning into K) determines how fair
 * round K's own cut is, since advPerRoom/lucky-loser selection both depend
 * on who's actually in your room -- so the transition feeding into Semis is
 * the highest-stakes one for "did skill legitimately decide who reached the
 * Final," and should lean toward balance, not freshness.
 */
export function semisApproachProgress(rounds: TournamentRound[], roundIndex: number): number {
  if (rounds[roundIndex]?.isNoElim) return 0;
  const firstElimIndex = rounds.findIndex((round) => !round.isNoElim);
  if (firstElimIndex === -1) return 0;
  const semisIndex = rounds.findIndex((round) => round.isSemis);
  const finalIndex = rounds.findIndex((round) => round.isFinal);
  const beforeLastSplit = (semisIndex !== -1 ? semisIndex : finalIndex) - 1;
  if (beforeLastSplit <= firstElimIndex) {
    return roundIndex >= beforeLastSplit ? 1 : 0;
  }
  return clamp01((roundIndex - firstElimIndex) / (beforeLastSplit - firstElimIndex));
}

/** A 'random' override: the likely absentees are placed first as in every draw, the others are shuffled into the seats left. */
function randomRoomAssignmentAround(
  names: string[],
  rooms: number[],
  seedKey: string,
  isLuckyByName: Map<string, boolean>,
  likelyAbsent: ReadonlySet<string>,
): RoundAssignment[] {
  const members = names.map((name, index) => ({ name, tierRank: index }));
  const weights = { roomHistory: {}, targetRoundIndex: 0, diversityWeight: 0, balanceWeight: 0 };
  const { placed, seatsLeft, rest } = placeLikelyAbsentees(members, rooms, likelyAbsent, weights);
  const drawn = seededRandomRoomAssignment(
    rest.map((member) => member.name),
    seatsLeft,
    seedKey,
    isLuckyByName,
  );
  const absentees = placed.map(({ name, room }) => ({
    name,
    room,
    isLucky: isLuckyByName.get(name) ?? false,
  }));
  return [...drawn, ...absentees].sort((first, second) => (first.room ?? 0) - (second.room ?? 0));
}

/** The weights a draw's room choices are costed with: the tournament's room history, and how much repeats and tiers count. */
interface DrawWeights {
  roomHistory: Record<string, number>;
  targetRoundIndex: number;
  diversityWeight: number;
  balanceWeight: number;
}

/** What the two main draws (`tieredSeed`, `tieredBracketSeed`) differ in; `drawRooms` does the rest. */
interface RoomDraw {
  /** The candidates by name, in the order they came. */
  names: string[];
  /** The planned size of each room. */
  roomSizes: number[];
  targetRoundIndex: number;
  roomHistory: Record<string, number>;
  seedingOverride?: SeedingOverride;
  /** The units likely to be absent: placed first, one to a room. */
  likelyAbsent: ReadonlySet<string>;
  /** Head-to-head rooms: put the likely absentees in pairs into rooms of their own (`absenceVersion` 4, a pooling round after the first). */
  pairAbsentees?: boolean;
  isLuckyByName: Map<string, boolean>;
  /** How far toward the terminal round the draw is, for the weights of an automatic draw. */
  progress: () => number;
  /** The candidates in pool order, each with its tier; asked for only when the draw is not a shuffle. */
  members: () => WaveMember[];
  /** Seats the members the likely absentees left, into the seats left; `pool` is every member in pool order. */
  fillRest: (
    rest: WaveMember[],
    seatsLeft: number[],
    weights: DrawWeights,
    pool: WaveMember[],
  ) => Array<{ name: string; room: number }>;
}

/**
 * The middle of both main draws: a 'random' override shuffles; otherwise the weights come from the override or the
 * progress toward the end, the likely absentees go first (one to a room), the rest is filled in by the draw's own
 * `fillRest`, and the result comes back in pool order with the lucky losers marked.
 */
function drawRooms(draw: RoomDraw): RoundAssignment[] {
  const { names, roomSizes, targetRoundIndex, roomHistory, seedingOverride, likelyAbsent, isLuckyByName } =
    draw;
  if (seedingOverride === 'random') {
    return randomRoomAssignmentAround(names, roomSizes, `${targetRoundIndex}`, isLuckyByName, likelyAbsent);
  }

  let diversityWeight: number;
  let balanceWeight: number;
  if (seedingOverride === 'diversity' || seedingOverride === 'balance') {
    ({ diversityWeight, balanceWeight } = SEEDING_OVERRIDE_WEIGHTS[seedingOverride]);
  } else {
    const progress = draw.progress();
    diversityWeight = lerp(DIVERSITY_PRIORITY_WEIGHT_AT_WARMUP, DIVERSITY_PRIORITY_WEIGHT_AT_SEMIS, progress);
    balanceWeight = lerp(BALANCE_PRIORITY_WEIGHT_AT_WARMUP, BALANCE_PRIORITY_WEIGHT_AT_SEMIS, progress);
  }

  const members = draw.members();
  const weights = { roomHistory, targetRoundIndex, diversityWeight, balanceWeight };
  // The likely absentees go first, one to a room; everyone else is drawn into the seats that are left.
  const { placed, seatsLeft, rest } = placeLikelyAbsentees(
    members,
    roomSizes,
    likelyAbsent,
    weights,
    draw.pairAbsentees,
  );
  const drawn = draw.fillRest(rest, seatsLeft, weights, members);
  return inPoolOrder(placed, drawn, members).map(({ name, room }) => ({
    name,
    room,
    isLucky: isLuckyByName.get(name) ?? false,
  }));
}

/**
 * Seeds every ordinary room-based reseed (no-elim/pooling
 * warmup, Qualification Table, and real single-elimination/team-format
 * cuts) -- NOT Kings Valley, double-elimination's WB/LB pooled pipeline,
 * Swiss, or group-stage, all of which use their own mechanisms already.
 * Builds a diversity-ordered pool from per-room rank tiers (see
 * buildAdvancementTiers), then walks it in capacity-derived "waves" sized by
 * nextRound.rooms so it works whether the room count/shape stays the same
 * (the no-elim case) or shrinks (a real cut), picking each wave's room
 * assignment via assignWaveToRooms with weights tapered by
 * semisApproachProgress. No isNoElim branching of its own -- the taper
 * already encodes that distinction.
 */
export function tieredSeed(options: {
  state: TournamentState;
  roundIndex: number;
  advancing: SeedCandidate[];
  seedingOverride?: SeedingOverride;
}): { seeded: RoundAssignment[] } {
  const { state, roundIndex, advancing, seedingOverride } = options;
  const nextRound = state.rounds[roundIndex + 1];
  const targetRoundIndex = roundIndex + 1;
  if (!nextRound || nextRound.rooms.length === 0) return { seeded: [] };

  const names = advancing.map((entry) => candidateName(entry));
  const allRoomNumbers = nextRound.rooms.map((_, index) => index + 1);
  return {
    seeded: drawRooms({
      names,
      roomSizes: nextRound.rooms,
      targetRoundIndex,
      roomHistory: state.roomHistory,
      seedingOverride,
      likelyAbsent: likelyAbsentees(state, targetRoundIndex),
      pairAbsentees: seedingPairsAbsentees(state, nextRound, targetRoundIndex),
      isLuckyByName: new Map(advancing.map((entry) => [candidateName(entry), Boolean(entry.isLucky)])),
      progress: () => semisApproachProgress(state.rounds, roundIndex),
      members: () => {
        // At a pooling exit the standings decide the draw: every unit its own tier, in the exit order.
        const tiers = isStandingsCutoffRound(state, roundIndex)
          ? exitOrderTiers(names)
          : buildAdvancementTiers(state, roundIndex, names);
        return tiers.flatMap((tier) =>
          tier.members.map((member) => ({ name: member.name, tierRank: tier.rank })),
        );
      },
      fillRest: (rest, seatsLeft, weights, pool) => {
        const fill = (members: WaveMember[], roomNumbers: number[]) =>
          fillRoomsByWaves({ ...weights, members, roomNumbers, roomSizes: seatsLeft });
        // Rounds with mixed room sizes: the smaller rooms are filled apart so their seats are spread evenly
        // (smaller-room-seats.ts): by the units that have held the fewest while the whole field is still in,
        // shared between the finishing places once units have been eliminated.
        const splitRound = isFullFieldRound(state.rounds, targetRoundIndex)
          ? splitForSmallerRooms
          : splitByFinishingPlace;
        const split = spreadsSmallerRoomSeats(nextRound)
          ? splitRound(
              rest,
              seatsLeft,
              smallerRoomSeatsBefore(state, targetRoundIndex),
              new Set(lateJoinersOf(state, roundIndex)),
            )
          : null;
        if (!split) return fill(rest, allRoomNumbers);
        const largeRooms = allRoomNumbers.filter((room) => !split.smallRooms.includes(room));
        const drawn = [...fill(split.small, split.smallRooms), ...fill(split.large, largeRooms)];
        const position = new Map(pool.map((member, index) => [member.name, index]));
        return drawn.sort(
          (first, second) => (position.get(first.name) ?? 0) - (position.get(second.name) ?? 0),
        );
      },
    }),
  };
}

/**
 * Progress toward the terminal round (Grand Final, or the shared-final
 * variant's untagged terminal Final round) for a double-elimination target
 * round, computed PER BRACKET SIDE -- winners and losers are two parallel
 * tracks each independently approaching one shared terminal round, unlike
 * the generic path's single linear ladder (see semisApproachProgress), so
 * "how close is THIS side to running out of its own rounds" is the right
 * question, not "how close is the whole tournament to Semis." A
 * 'grand-final'-tagged round, or a Final round with no .bracket tag at all
 * (the shared-final variant's terminal round), always gets progress 1 --
 * reaching the actual Final is the single highest-stakes reseed, same
 * reasoning semisApproachProgress uses for the round feeding Semis. The
 * progress blends the same warm-up and Semis weights as the generic path
 * (`docs/open-items.md`, "Double elimination draw weights").
 */
export function doubleEliminationApproachProgress(
  rounds: TournamentRound[],
  targetRoundIndex: number,
): number {
  const targetRound = rounds[targetRoundIndex];
  const side = targetRound?.bracket;
  if (side !== 'winners' && side !== 'losers') return 1;
  const sameSideIndices = rounds
    .map((round, index) => ({ round, index }))
    .filter(({ round }) => round.bracket === side)
    .map(({ index }) => index);
  if (sameSideIndices.length <= 1) return 1;
  const position = sameSideIndices.indexOf(targetRoundIndex);
  return position / (sameSideIndices.length - 1);
}

/**
 * Seeds double-elimination's WB/LB routing
 * (finalizeDoubleEliminationRound, double-elimination-advance.ts) -- structurally a thin
 * sibling of tieredSeed, not a variant that re-derives tiers: `pool` already
 * carries each entry's tierRank/pct, tagged at push time by
 * advanceDoubleElimination (see the tagging note there and on
 * PendingBracketSeed), since a double-elimination target round's pool can
 * accumulate from more than one source round by the time it's finalized.
 * Sorts once by (tierRank asc, pct desc, name asc) -- the same deterministic
 * order buildAdvancementTiers itself produces -- then walks the same
 * capacity-derived wave logic tieredSeed uses, so uneven room sizes (e.g.
 * `[8,8,7,7,7]`) are still respected exactly rather than approximated by a
 * plain room-count bounce.
 */
export function tieredBracketSeed(options: {
  pool: PendingBracketSeed[];
  roomSizes: number[];
  roomHistory: Record<string, number>;
  rounds: TournamentRound[];
  targetRoundIndex: number;
  seedingOverride?: SeedingOverride;
  /** The units of the pool likely to be absent (`likelyAbsentees`): placed first, one to a room. */
  likelyAbsent?: ReadonlySet<string>;
}): { seeded: RoundAssignment[] } {
  const { pool, roomSizes, roomHistory, rounds, targetRoundIndex, seedingOverride } = options;
  if (roomSizes.length === 0) return { seeded: [] };

  return {
    seeded: drawRooms({
      names: pool.map((entry) => entry.name),
      roomSizes,
      targetRoundIndex,
      roomHistory,
      seedingOverride,
      likelyAbsent: options.likelyAbsent ?? new Set<string>(),
      isLuckyByName: new Map(pool.map((entry) => [entry.name, Boolean(entry.isLucky)])),
      progress: () => doubleEliminationApproachProgress(rounds, targetRoundIndex),
      members: () => {
        const sorted = [...pool].sort(
          (first, second) =>
            first.tierRank - second.tierRank ||
            second.pct - first.pct ||
            first.name.localeCompare(second.name),
        );
        return sorted.map((entry) => ({ name: entry.name, tierRank: entry.tierRank }));
      },
      fillRest: (rest, seatsLeft, weights) =>
        fillRoomsByWaves({
          ...weights,
          members: rest,
          roomNumbers: roomSizes.map((_, index) => index + 1),
          roomSizes: seatsLeft,
        }),
    }),
  };
}
