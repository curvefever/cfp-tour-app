import { likelyAbsentees } from './likely-absentees';
import { hasSwissPooling } from './pooling';
import { avoidMetPairsNearRank, metPairs } from './room-history';
import {
  avoidSameGroupInFirstBracketRound,
  snakeSeed,
  type GroupExitOrder,
  type SeedCandidate,
} from './seeding';
import { tieredSeed, type SeedingOverride } from './wave-draw';
import { inPoolOrder, placeLikelyAbsentees } from './wave-fill';
import type { PendingBracketSeed, RoundAssignment, TournamentGroup, TournamentState } from './types';

/** The draws out of a pooling phase: the exit draw and a pool in standings order, snaked and parted, and the bye of a pooling round. */

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
