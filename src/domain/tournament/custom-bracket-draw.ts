/**
 * The draw of a Custom bracket round from the units waiting for it (`pendingBracketSeeds`), in the order the rules apply:
 *  1. fed only by the pooling exit: drawn in standings order (`seedPoolByStanding`);
 *  2. seed lines: every room has two seats and every unit carries a seed: sorted by seed and snaked into the rooms, so
 *     the bracket's lines are fixed (1 v 8, 2 v 7, ... and, a round later, the winner of room 1 v the winner of room 4);
 *  3. one scale: every unit carries a seed and the units come from more than one round: each source's tiers are shifted
 *     after the tiers of the sources with better seeds, then the balanced draw (`tieredBracketSeed`);
 *  4. otherwise (a unit without a seed: no pooling phase, or a pool pushed before seeds existed, or a seeding
 *     override): the balanced draw on the tiers as they are.
 */
import { isFedOnlyByStandings } from './bracket-replay';
import { selectGroupExit } from './advancement';
import { seedPoolByStanding, snakeSeed, tieredBracketSeed } from './seeding';
import type { PendingBracketSeed, RoundAssignment, TournamentState } from './types';

type SeedingOverride = Parameters<typeof tieredBracketSeed>[0]['seedingOverride'];

const SEED_LINE_ROOM_SIZE = 2;

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

/** The line-up of a Custom bracket round drawn from `pool`, by the rules above. */
export function drawCustomBracketPool(options: {
  state: TournamentState;
  roundIndex: number;
  pool: PendingBracketSeed[];
  seedingOverride?: SeedingOverride;
  likelyAbsent: ReadonlySet<string>;
}): RoundAssignment[] {
  const { state, roundIndex, pool, seedingOverride, likelyAbsent } = options;
  const roomSizes = state.rounds[roundIndex].rooms;
  if (!seedingOverride && isFedOnlyByStandings(state.rounds, roundIndex)) {
    return seedPoolByStanding({
      pool,
      roomSizes,
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
  if (
    !seedingOverride &&
    everyUnitHasSeed(pool) &&
    roomSizes.length > 0 &&
    roomSizes.every((size) => size === SEED_LINE_ROOM_SIZE)
  ) {
    return snakeSeed(
      [...pool].sort(bySeedLine).map(({ name, isLucky }) => ({ name, isLucky })),
      roomSizes,
    );
  }
  return tieredBracketSeed({
    pool: everyUnitHasSeed(pool) ? onOneScale(pool) : pool,
    roomSizes,
    roomHistory: state.roomHistory,
    rounds: state.rounds,
    targetRoundIndex: roundIndex,
    seedingOverride,
    likelyAbsent,
  }).seeded;
}
