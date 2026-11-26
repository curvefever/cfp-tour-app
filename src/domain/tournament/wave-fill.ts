import { lexicographicMinAssignment } from './cheapest-assignment';
import { roomPairKey } from './room-history';

/** The wave fill every draw seats units with: what a room choice costs, the likely absentees placed first, and the repeat weight. */

/**
 * Small premium on avoiding a MORE RECENT repeat over an older one, never a
 * large one: 1.1x at roundsAgo=1 (played together last round), decaying
 * toward 1x as roundsAgo grows. Bound: for a candidate joining a room with up
 * to n existing occupants this reseed, the worst-case cost spread within a
 * FIXED repeat-count is n*K, so a same-repeat-count permutation can never
 * out-cost a +1-repeat-count permutation as long as K < 1/n. This app's
 * largest configured room is FFA individual's defaultRoomSize (ideal 8,
 * formats.ts), so n <= 7 and K must stay below ~0.143 -- 0.1 leaves a
 * comfortable margin. Tunable, but keep this derivation in mind: raising K
 * much further risks letting recency override the base repeat-count
 * priority, which is not the intent.
 */
export const RECENCY_REPEAT_WEIGHT_K = 0.1;

export function recencyWeight(roundsAgo: number): number {
  return 1 + RECENCY_REPEAT_WEIGHT_K / roundsAgo;
}

export interface WaveMember {
  name: string;
  tierRank: number;
}

export interface RoomChoiceWeights {
  roomHistory: Record<string, number>;
  targetRoundIndex: number;
  diversityWeight: number;
  balanceWeight: number;
}

/**
 * What seating `member` in `room` costs: the repeat pairs it makes with the room's units so far (recency weighted)
 * and how far its tierRank total pushes the room from `mean`, blended by the weights.
 */
export function roomChoiceCost(
  member: WaveMember,
  room: number,
  roomMembersSoFar: Map<number, string[]>,
  roomBalanceSoFar: Map<number, number>,
  mean: number,
  options: RoomChoiceWeights,
): number {
  let repeatScore = 0;
  for (const existing of roomMembersSoFar.get(room) ?? []) {
    const lastRound = options.roomHistory[roomPairKey(member.name, existing)];
    // A meeting at or after the round being drawn is a stale or planned entry (e.g. a
    // re-draw of an already drawn round), not a past repeat; roundsAgo would be 0 or negative.
    if (lastRound === undefined || lastRound >= options.targetRoundIndex) continue;
    repeatScore += recencyWeight(options.targetRoundIndex - lastRound);
  }
  const balanceCost = Math.abs((roomBalanceSoFar.get(room) ?? 0) + member.tierRank - mean);
  return options.diversityWeight * repeatScore + options.balanceWeight * balanceCost;
}

/**
 * Assigns `members` (one candidate per room this wave) to `roomNumbers`,
 * picking whichever assignment minimizes a weighted blend of (a) new
 * repeat-pairs against `roomHistory`, recency-weighted, and (b) how far this
 * choice pushes each target room's running tierRank total from the mean
 * across every room in the next round (not just this wave's subset -- rooms
 * untouched this wave keep their prior total). `diversityWeight`/
 * `balanceWeight` set the blend; see semisApproachProgress for how callers
 * derive them.
 *
 * Both terms split into independent (member, room) costs -- a room's repeat
 * score depends only on the member joining it, and its balance term only on
 * `|soFar + tierRank - mean|`, where `mean` is the same whatever the
 * assignment -- so this is a linear assignment problem, solved exactly and in
 * O(k^3) by lexicographicMinAssignment instead of trying every permutation
 * (which froze for waves of ~10+ rooms). Deterministic: exact ties go to the
 * lexicographically smallest room sequence (member 0's earliest room, then
 * member 1's, ...).
 */
export function assignWaveToRooms(
  members: WaveMember[],
  roomNumbers: number[],
  roomMembersSoFar: Map<number, string[]>,
  roomBalanceSoFar: Map<number, number>,
  options: {
    roomHistory: Record<string, number>;
    targetRoundIndex: number;
    allRoomNumbers: number[];
    diversityWeight: number;
    balanceWeight: number;
  },
): Array<{ name: string; room: number }> {
  if (members.length !== roomNumbers.length) {
    throw new Error(
      `assignWaveToRooms: members.length (${members.length}) must equal roomNumbers.length (${roomNumbers.length}).`,
    );
  }
  const totalRooms = new Set([...options.allRoomNumbers, ...roomNumbers]);
  let totalBalance = members.reduce((sum, member) => sum + member.tierRank, 0);
  for (const room of totalRooms) totalBalance += roomBalanceSoFar.get(room) ?? 0;
  const mean = totalBalance / (totalRooms.size || 1);

  const cost = members.map((member) =>
    roomNumbers.map((room) =>
      roomChoiceCost(member, room, roomMembersSoFar, roomBalanceSoFar, mean, options),
    ),
  );
  return lexicographicMinAssignment(cost).map((column, index) => ({
    name: members[index].name,
    room: roomNumbers[column],
  }));
}

export interface LikelyAbsenteePlacement {
  placed: Array<{ name: string; room: number }>;
  /** The seats each room has left for the other units (its planned size less the absentees placed), by room number - 1. */
  seatsLeft: number[];
  /** The members that are not placed, in their order. */
  rest: WaveMember[];
}

/**
 * Places the likely absentees among `members` (best tier first) before anyone else, so no room is drawn full of
 * players while another waits for the ones who do not come. A room is judged by its expected size, its planned seats
 * less the absentees already placed. Each absentee goes to a room with the fewest absentees so far (never two in one
 * room while another has fewer), of those to the one with the largest expected size (none in a room that is already
 * the smaller one while a larger has none), then to the room the repeat pairs and balance of `weights` prefer, then to
 * the lowest room number. The others are drawn as usual into `seatsLeft`. Rooms of two (head to head) place nobody,
 * unless `pairInRoomsOfTwo` (`absenceVersion` 4, a pooling round after the first): then the absentees are put in
 * pairs into rooms of their own (`placeAbsenteePairs`).
 */
export function placeLikelyAbsentees(
  members: WaveMember[],
  roomSizes: readonly number[],
  likelyAbsent: ReadonlySet<string>,
  weights: RoomChoiceWeights,
  pairInRoomsOfTwo = false,
): LikelyAbsenteePlacement {
  const seatsLeft = [...roomSizes];
  const headToHead = roomSizes.every((size) => size <= 2);
  if (headToHead && pairInRoomsOfTwo && likelyAbsent.size > 0) {
    return placeAbsenteePairs(members, roomSizes, likelyAbsent, weights);
  }
  const absentees =
    likelyAbsent.size === 0 || headToHead ? [] : members.filter((member) => likelyAbsent.has(member.name));
  const rooms = roomSizes.map((_, index) => index + 1);
  const absenteesIn = new Map<number, string[]>(rooms.map((room) => [room, []]));
  const balance = new Map<number, number>(rooms.map((room) => [room, 0]));
  const placed: Array<{ name: string; room: number }> = [];
  for (const member of absentees) {
    const open = rooms.filter((room) => seatsLeft[room - 1] > 0);
    if (open.length === 0) break;
    const fewest = Math.min(...open.map((room) => absenteesIn.get(room)?.length ?? 0));
    const lightest = open.filter((room) => (absenteesIn.get(room)?.length ?? 0) === fewest);
    const largest = Math.max(...lightest.map((room) => seatsLeft[room - 1]));
    const tied = lightest.filter((room) => seatsLeft[room - 1] === largest);
    const mean =
      ([...balance.values()].reduce((sum, value) => sum + value, 0) + member.tierRank) / rooms.length;
    const costs = tied.map((room) => roomChoiceCost(member, room, absenteesIn, balance, mean, weights));
    const room = tied[costs.indexOf(Math.min(...costs))];
    absenteesIn.set(room, [...(absenteesIn.get(room) ?? []), member.name]);
    balance.set(room, (balance.get(room) ?? 0) + member.tierRank);
    seatsLeft[room - 1] -= 1;
    placed.push({ name: member.name, room });
  }
  const placedNames = new Set(placed.map(({ name }) => name));
  return { placed, seatsLeft, rest: members.filter((member) => !placedNames.has(member.name)) };
}

/**
 * Head-to-head rooms: the likely absentees (best tier first) go two to a room, in rooms of their own after the others,
 * so no present unit meets one for a walkover. A partner is the best tier left that the unit has not met
 * (`weights.roomHistory`), else the best tier left; a leftover absentee is drawn with the others.
 */
function placeAbsenteePairs(
  members: WaveMember[],
  roomSizes: readonly number[],
  likelyAbsent: ReadonlySet<string>,
  weights: RoomChoiceWeights,
): LikelyAbsenteePlacement {
  const left = members.filter((member) => likelyAbsent.has(member.name));
  const placed: Array<{ name: string; room: number }> = [];
  const seatsLeft = [...roomSizes];
  let room = roomSizes.length;
  while (left.length >= 2 && room >= 1) {
    const [first, ...others] = left;
    const partner =
      others.find((other) => weights.roomHistory[roomPairKey(first.name, other.name)] === undefined) ??
      others[0];
    placed.push({ name: first.name, room }, { name: partner.name, room });
    seatsLeft[room - 1] = 0;
    left.splice(left.indexOf(partner), 1);
    left.shift();
    room -= 1;
  }
  const placedNames = new Set(placed.map(({ name }) => name));
  return { placed, seatsLeft, rest: members.filter((member) => !placedNames.has(member.name)) };
}

/** The assignments of `placed` and `drawn` together, in the order of `order` (the pool order every draw returns). */
export function inPoolOrder<T extends { name: string }>(
  placed: T[],
  drawn: T[],
  order: Array<{ name: string }>,
): T[] {
  if (placed.length === 0) return drawn;
  const position = new Map(order.map((member, index) => [member.name, index]));
  return [...placed, ...drawn].sort(
    (first, second) => (position.get(first.name) ?? 0) - (position.get(second.name) ?? 0),
  );
}

/**
 * Fills `roomNumbers` with `members` (best tier first), one wave at a time: a wave seats one candidate in
 * every room that is still open at that depth (a room of size s takes part in waves 0..s-1), assigned by
 * assignWaveToRooms. The balance mean is taken over `roomNumbers` only. `roomSizes` is indexed by
 * room number - 1.
 */
export function fillRoomsByWaves(options: {
  members: WaveMember[];
  roomNumbers: number[];
  roomSizes: number[];
  roomHistory: Record<string, number>;
  targetRoundIndex: number;
  diversityWeight: number;
  balanceWeight: number;
}): Array<{ name: string; room: number }> {
  const { members, roomNumbers, roomSizes, roomHistory, targetRoundIndex, diversityWeight, balanceWeight } =
    options;
  const maxWave = Math.max(0, ...roomNumbers.map((room) => roomSizes[room - 1]));
  const roomMembersSoFar = new Map<number, string[]>(roomNumbers.map((room) => [room, []]));
  const roomBalanceSoFar = new Map<number, number>(roomNumbers.map((room) => [room, 0]));
  const result: Array<{ name: string; room: number }> = [];
  let cursor = 0;
  for (let wave = 0; wave < maxWave; wave += 1) {
    const waveRooms = roomNumbers.filter((room) => roomSizes[room - 1] > wave);
    const waveMembers = members.slice(cursor, cursor + waveRooms.length);
    cursor += waveRooms.length;
    if (waveMembers.length === 0) continue;
    const assigned = assignWaveToRooms(waveMembers, waveRooms, roomMembersSoFar, roomBalanceSoFar, {
      roomHistory,
      targetRoundIndex,
      allRoomNumbers: roomNumbers,
      diversityWeight,
      balanceWeight,
    });
    for (const { name, room } of assigned) {
      roomMembersSoFar.set(room, [...(roomMembersSoFar.get(room) ?? []), name]);
      const tierRank = waveMembers.find((member) => member.name === name)?.tierRank ?? 0;
      roomBalanceSoFar.set(room, (roomBalanceSoFar.get(room) ?? 0) + tierRank);
      result.push({ name, room });
    }
  }
  return result;
}
