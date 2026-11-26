import { buildAdvancementTiers, exitOrderTiers } from './advancement';
import { isStandingsCutoffRound } from './cutoff-rounds';
import { lateJoinersOf } from './late-joiners';
import { likelyAbsentees } from './likely-absentees';
import { isPoolingRound } from './pooling';
import { pairsLikelyAbsentees } from './rule-versions';
import { candidateName, type SeedCandidate } from './seeding';
import {
  isFullFieldRound,
  smallerRoomSeatsBefore,
  splitByFinishingPlace,
  splitForSmallerRooms,
  spreadsSmallerRoomSeats,
} from './smaller-room-seats';
import { fillRoomsByWaves, inPoolOrder, placeLikelyAbsentees, type WaveMember } from './wave-fill';
import type { PendingBracketSeed, RoundAssignment, TournamentRound, TournamentState } from './types';

/** The room draw: the tiers and weights of a reseed, the overrides, and the draw of a round from who advances or from a bracket pool. */

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
