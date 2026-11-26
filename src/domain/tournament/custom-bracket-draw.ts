/**
 * The draw of a Custom bracket round from the units waiting for it (`pendingBracketSeeds`), in the order the rules apply:
 *  1. fed only by the pooling exit: drawn in standings order (`seedPoolByStanding`);
 *  2. seed lines: every room has two seats (a short round keeps its fitted shape, the short room last) and every unit
 *     carries a seed: sorted by seed and snaked into the rooms, so
 *     the bracket's lines are fixed (1 v 8, 2 v 7, ... and, a round later, the winner of room 1 v the winner of room 4);
 *  3. one scale: every unit carries a seed and the units come from more than one round: each source's tiers are shifted
 *     after the tiers of the sources with better seeds, then the balanced draw (`tieredBracketSeed`);
 *  4. otherwise (a unit without a seed: no pooling phase, or a pool pushed before seeds existed, or a seeding
 *     override): the balanced draw on the tiers as they are.
 */
import { selectGroupExit } from './advancement';
import { snakeSeed } from './seeding';
import { seedPoolByStanding } from './pooling-exit-draw';
import { tieredBracketSeed } from './wave-draw';
import type { PendingBracketSeed, RoundAssignment, TournamentRound, TournamentState } from './types';

type SeedingOverride = Parameters<typeof tieredBracketSeed>[0]['seedingOverride'];

const SEED_LINE_ROOM_SIZE = 2;

/** Rooms of two, or of two with the short room of a round fitted to a pool one unit short (a room of one). */
function isSeedLineShape(roomSizes: number[]): boolean {
  return roomSizes.includes(SEED_LINE_ROOM_SIZE) && roomSizes.every((size) => size <= SEED_LINE_ROOM_SIZE);
}

/** Every unit of the pool carries a seed (and the pool is not empty). */
function everyUnitHasSeed(pool: PendingBracketSeed[]): boolean {
  return pool.length > 0 && pool.every((entry) => entry.seed !== undefined);
}

function bySeedLine(first: PendingBracketSeed, second: PendingBracketSeed): number {
  return (
    (first.seed as number) - (second.seed as number) ||
    first.tierRank - second.tierRank ||
    second.pct - first.pct ||
    first.name.localeCompare(second.name)
  );
}

/**
 * The pool with each unit's `tierRank` moved onto one scale when it comes from more than one round: the sources in the
 * order of their best seed, each one's tiers after the highest tier of those before it. A single source is returned as it
 * is, so its draw does not change.
 */
export function onOneScale(pool: PendingBracketSeed[]): PendingBracketSeed[] {
  const sources = new Map<number, { best: number; top: number }>();
  for (const entry of pool) {
    const from = entry.from ?? -1;
    const known = sources.get(from);
    sources.set(from, {
      best: Math.min(known?.best ?? Infinity, entry.seed as number),
      top: Math.max(known?.top ?? 0, entry.tierRank),
    });
  }
  if (sources.size < 2) return pool;
  const offsets = new Map<number, number>();
  let offset = 0;
  // Sources with the same best seed go by the round they come from, so the order never depends on who arrived first.
  const ordered = [...sources].sort(
    ([firstFrom, first], [secondFrom, second]) => first.best - second.best || firstFrom - secondFrom,
  );
  for (const [from, { top }] of ordered) {
    offsets.set(from, offset);
    offset += top + 1;
  }
  return pool.map((entry) => ({ ...entry, tierRank: entry.tierRank + (offsets.get(entry.from ?? -1) ?? 0) }));
}

/** Whether rule 2 (seed lines) draws a pool: no override, a seed on every unit and the shape of rooms of two. */
export function usesSeedLines(
  pool: PendingBracketSeed[],
  roomSizes: number[],
  seedingOverride?: SeedingOverride,
): boolean {
  return !seedingOverride && everyUnitHasSeed(pool) && isSeedLineShape(roomSizes);
}

/** Rule 1: a round fed only by the pooling exit is drawn in standings order (the group-mates apart after a group stage). */
export function drawFromPoolingExit(options: {
  state: TournamentState;
  roundIndex: number;
  pool: PendingBracketSeed[];
  likelyAbsent: ReadonlySet<string>;
}): RoundAssignment[] {
  const { state, roundIndex, pool, likelyAbsent } = options;
  return seedPoolByStanding({
    pool,
    roomSizes: state.rounds[roundIndex].rooms,
    state,
    targetRoundIndex: roundIndex,
    likelyAbsent,
    ...(state.rounds.some((round) => round.isGroupStage && round.standingsRoutes)
      ? {
          groups: {
            groups: state.groups,
            throughByGroup: selectGroupExit(state, state.groupStandings).throughByGroup,
          },
        }
      : {}),
  });
}

/**
 * The line-up of a Custom bracket round drawn from `pool`, by the rules above. `exitDraw` is rule 1 when the round is
 * fed only by the pooling exit (and nothing overrides the seeding). A pure function of what it is given, so the Bracket's
 * preview draws its stand-in units through it too.
 */
export function drawCustomBracketPool(options: {
  pool: PendingBracketSeed[];
  roomSizes: number[];
  roomHistory: Record<string, number>;
  rounds: TournamentRound[];
  targetRoundIndex: number;
  seedingOverride?: SeedingOverride;
  likelyAbsent: ReadonlySet<string>;
  exitDraw?: () => RoundAssignment[];
}): RoundAssignment[] {
  const { pool, roomSizes, seedingOverride } = options;
  if (!seedingOverride && options.exitDraw) return options.exitDraw();
  if (usesSeedLines(pool, roomSizes, seedingOverride)) {
    return snakeSeed(
      [...pool].sort(bySeedLine).map(({ name, isLucky }) => ({ name, isLucky })),
      roomSizes,
    );
  }
  return tieredBracketSeed({
    pool: everyUnitHasSeed(pool) ? onOneScale(pool) : pool,
    roomSizes,
    roomHistory: options.roomHistory,
    rounds: options.rounds,
    targetRoundIndex: options.targetRoundIndex,
    seedingOverride,
    likelyAbsent: options.likelyAbsent,
  }).seeded;
}
