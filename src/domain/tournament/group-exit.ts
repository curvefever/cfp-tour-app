import { compareStandings, rankingPoints, sameStanding } from './advancement';
import { fairCutShape, type FairCutChancePlace } from './fair-cut';
import { GROUP_SIZE_BOUNDS } from './pooling';
import { distributeRooms } from './room-distribution';
import { tieResolutionList } from './scoring';
import type { GroupExitMode, TournamentState, TournamentStanding } from './types';

/**
 * How a group stage sends units to the bracket. `per-group` sends the same number from every group (today's rule,
 * and what a tournament stored without `cfg.groupExit` does). With a total (`even-split` or `fair-cut`) `cfg.qualAdv`
 * is the number of units that go through in all, shared between groups of different sizes: an even split gives every
 * group `floor(total / groups)` and the leftover spots go to the best of the next in line; a fair cut gives each group
 * size its fair share of the eliminations (`fairCutShape`, with the groups as its rooms). Teams of different groups
 * are compared on points per match, then relative score. Rule and examples: `docs/rules.md`, "Group stage exit".
 */

/** The tie-resolution key of a tie at the last chance spot, between teams of different groups. */
export const GROUP_EXIT_TIE_KEY = 'group-exit-cutoff';

export function groupExitMode(cfg: { groupExit?: GroupExitMode }): GroupExitMode {
  return cfg.groupExit ?? 'per-group';
}

/** The group stage sends a total, not so many per group. */
export function groupExitIsTotal(cfg: { groupExit?: GroupExitMode }): boolean {
  return groupExitMode(cfg) !== 'per-group';
}

/** The groups that share one rule: all of them (per group, even split) or those of one size (fair cut). */
export interface GroupExitClass {
  /** The group sizes it covers, largest first. */
  sizes: number[];
  /** The groups' positions in `state.groups`. */
  groups: number[];
  /** Places 1…direct of each of its groups always go through. */
  direct: number;
  /** The places that only some of its groups go through from. */
  chancePlaces: FairCutChancePlace[];
  /** Spots over all its chance places: fewest and most units of the class that go through there. */
  minSpots: number;
  maxSpots: number;
}

export interface GroupExitShape {
  mode: GroupExitMode;
  /** The qualifiers per group (`per-group`) or the total advancing (the other modes). */
  amount: number;
  classes: GroupExitClass[];
}

function allGroups(groupSizes: readonly number[]): number[] {
  return groupSizes.map((_, index) => index);
}

function distinctSizes(groupSizes: readonly number[]): number[] {
  return [...new Set(groupSizes)].sort((first, second) => second - first);
}

/** What the exit asks of each group, before any score is in. `amount` is the qualifiers per group, or the total. */
export function groupExitShape(
  groupSizes: readonly number[],
  mode: GroupExitMode,
  amount: number,
): GroupExitShape {
  if (mode === 'fair-cut') {
    const classes = fairCutShape(groupSizes, amount).groups.map((group): GroupExitClass => ({
      sizes: [group.size],
      groups: group.rooms.map((room) => room - 1),
      direct: group.direct,
      chancePlaces: group.chancePlaces,
      minSpots: group.minSpots,
      maxSpots: group.maxSpots,
    }));
    return { mode, amount, classes };
  }
  if (mode === 'even-split') {
    const direct = groupSizes.length ? Math.floor(amount / groupSizes.length) : 0;
    const extra = groupSizes.length ? amount % groupSizes.length : 0;
    const chancePlaces = extra > 0 ? [{ place: direct + 1, minSpots: extra, maxSpots: extra }] : [];
    const cls: GroupExitClass = {
      sizes: distinctSizes(groupSizes),
      groups: allGroups(groupSizes),
      direct,
      chancePlaces,
      minSpots: extra,
      maxSpots: extra,
    };
    return { mode, amount, classes: [cls] };
  }
  const cls: GroupExitClass = {
    sizes: distinctSizes(groupSizes),
    groups: allGroups(groupSizes),
    direct: amount,
    chancePlaces: [],
    minSpots: 0,
    maxSpots: 0,
  };
  return { mode, amount, classes: [cls] };
}

/** The exit shape of a tournament's groups, from its settings. */
export function groupExitShapeOf(state: Pick<TournamentState, 'groups' | 'cfg'>): GroupExitShape {
  const mode = groupExitMode(state.cfg);
  const amount = mode === 'per-group' ? (state.cfg.qualifiersPerGroup ?? 0) : (state.cfg.qualAdv ?? 0);
  return groupExitShape(
    state.groups.map((group) => group.members.length),
    mode,
    amount,
  );
}

/** Places 1…n of each group (by its position in `state.groups`) that always go through. */
export function groupDirectCounts(shape: GroupExitShape, groupCount: number): number[] {
  const direct = Array.from({ length: groupCount }, () => 0);
  for (const cls of shape.classes) for (const group of cls.groups) direct[group] = cls.direct;
  return direct;
}

/** Units that go through in all: the total of a total mode, groups times qualifiers per group otherwise. */
export function groupExitEntryCount(shape: GroupExitShape, groupCount: number): number {
  return shape.mode === 'per-group' ? groupCount * shape.amount : shape.amount;
}

interface Candidate {
  group: number;
  /** Place in its group's table, 1-based. */
  place: number;
  entry: TournamentStanding;
}

/** The units level at the last chance spot, some of which the spot leaves out: the organiser decides. */
export interface GroupExitTie {
  /** Level units with the group each belongs to (position in `state.groups`). */
  players: Array<{ entry: TournamentStanding; group: number }>;
  /** How many of them go through. */
  spots: number;
}

export interface GroupExitSelection {
  /** The units that go through, for the bracket's seeding: places taken in tiers (each tier best first), then the chance spots. */
  advancing: string[];
  /** The units taken at chance places, in the order they were taken. */
  chance: string[];
  /** Per group (position in `state.groups`), the units that go through, in table order. */
  throughByGroup: string[][];
  /** Per group, how many rows of its table go through as things stand: its direct places and the chance spots taken so far. */
  cutByGroup: number[];
  tie: GroupExitTie | null;
}

/** Best first: points per match, then relative score, then the organiser's order among level units. */
function orderCandidates(resolved: readonly string[]) {
  const rank = (name: string) => {
    const index = resolved.indexOf(name);
    return index < 0 ? resolved.length : index;
  };
  return (first: TournamentStanding, second: TournamentStanding) =>
    compareStandings(first, second) || rank(first.name) - rank(second.name);
}

/**
 * Who goes through, from each group's table (best first, units that have a result only, the within-group cut-off
 * order applied). The direct places of every group first, in tiers. Then the chance spots, one at a time: every size
 * class offers its best next in line (its lowest place still open, then points per match, then relative score), the
 * spot goes to the best of those, and a class takes at most its most spots while the fewest of every class stay
 * reachable. A team's 3rd place is therefore never passed over for another group's 4th of the same size.
 */
export function groupExitSelection(
  state: Pick<TournamentState, 'groups' | 'cfg' | 'tieResolutions'>,
  tables: ReadonlyArray<readonly TournamentStanding[]>,
  shape: GroupExitShape = groupExitShapeOf(state),
): GroupExitSelection {
  const direct = groupDirectCounts(shape, state.groups.length);
  const advancing: string[] = [];
  for (let tier = 0; tier < Math.max(0, ...direct); tier += 1) {
    const finishers = tables
      .flatMap((table, group) => (tier < direct[group] && table[tier] ? [table[tier]] : []))
      .sort(compareStandings);
    advancing.push(...finishers.map((finisher) => finisher.name));
  }

  const better = orderCandidates(tieResolutionList(state, GROUP_EXIT_TIE_KEY));
  const nextPlace = direct.map((count) => count + 1);
  const taken = shape.classes.map(() => 0);
  const picks: Candidate[] = [];
  const steps: Array<{ picked: Candidate; rivals: Candidate[] }> = [];
  /** A class's next in line: its groups' units at the lowest place still open, best first. */
  const classOffer = (index: number): Candidate[] => {
    const cls = shape.classes[index];
    const last = cls.chancePlaces[cls.chancePlaces.length - 1]?.place ?? 0;
    const open = cls.groups.flatMap((group) => {
      const place = nextPlace[group];
      const entry = place <= last ? tables[group]?.[place - 1] : undefined;
      return entry ? [{ group, place, entry }] : [];
    });
    const lowest = Math.min(...open.map((candidate) => candidate.place));
    return open
      .filter((candidate) => candidate.place === lowest)
      .sort((first, second) => better(first.entry, second.entry));
  };
  const spots = shape.mode === 'per-group' ? 0 : shape.amount - direct.reduce((sum, count) => sum + count, 0);
  for (let left = spots; left > 0; left -= 1) {
    const owed = shape.classes.reduce((sum, cls, index) => sum + Math.max(0, cls.minSpots - taken[index]), 0);
    const offers = shape.classes.flatMap((cls, index) => {
      if (taken[index] >= cls.maxSpots) return [];
      if (owed >= left && taken[index] >= cls.minSpots) return [];
      const offer = classOffer(index);
      return offer.length > 0 ? [{ index, offer, best: offer[0] }] : [];
    });
    if (offers.length === 0) break;
    const winner = offers.reduce((leading, offer) =>
      better(offer.best.entry, leading.best.entry) < 0 ? offer : leading,
    );
    picks.push(winner.best);
    taken[winner.index] += 1;
    nextPlace[winner.best.group] += 1;
    steps.push({ picked: winner.best, rivals: offers.flatMap((offer) => offer.offer) });
  }
  advancing.push(...picks.map((pick) => pick.entry.name));

  return {
    advancing,
    chance: picks.map((pick) => pick.entry.name),
    throughByGroup: tables.map((table, group) => [
      ...table.slice(0, direct[group]).map((entry) => entry.name),
      ...picks.filter((pick) => pick.group === group).map((pick) => pick.entry.name),
    ]),
    cutByGroup: direct.map((count, group) => count + picks.filter((pick) => pick.group === group).length),
    tie: chanceTies(picks, steps),
  };
}

/**
 * A chance spot is a tie when, at any step, a unit offered for it was level with the unit it went to and ended up
 * unplaced (its size may be full by the next step, so it is never offered again). Every such tie of the selection is
 * one cluster: the level units of each step, with the picks level with them; `spots` is how many of them go through.
 */
function chanceTies(
  picks: readonly Candidate[],
  steps: ReadonlyArray<{ picked: Candidate; rivals: Candidate[] }>,
): GroupExitTie | null {
  const placed = new Set(picks.map((pick) => pick.entry.name));
  const cluster = new Map<string, Candidate>();
  for (const { picked, rivals } of steps) {
    const unplaced = rivals.filter(
      (rival) => !placed.has(rival.entry.name) && sameStanding(rival.entry, picked.entry),
    );
    if (unplaced.length === 0) continue;
    const level = [...picks, ...unplaced].filter((candidate) => sameStanding(candidate.entry, picked.entry));
    for (const candidate of level) cluster.set(candidate.entry.name, candidate);
  }
  const players = [...cluster.values()];
  if (players.length === 0) return null;
  return {
    players: players.map((candidate) => ({ entry: candidate.entry, group: candidate.group })),
    spots: players.filter((candidate) => placed.has(candidate.entry.name)).length,
  };
}

/** The points per match (or points) the tied units are level on, for the tie cluster. */
export function groupExitTiePoints(tie: GroupExitTie): number {
  return rankingPoints(tie.players[0].entry) ?? 0;
}

/** The sizes of the groups `unitCount` units are split into, for the Setup's group size. */
export function groupSizesOf(unitCount: number, groupSize: number): number[] {
  return distributeRooms(unitCount, {
    min: GROUP_SIZE_BOUNDS.min,
    max: GROUP_SIZE_BOUNDS.max,
    ideal: groupSize,
  });
}

/** "3 groups (5, 4, 4)": the groups a roster is split into. */
export function describeGroupSizes(groupSizes: readonly number[]): string {
  return `${groupSizes.length} group${groupSizes.length === 1 ? '' : 's'} (${groupSizes.join(', ')})`;
}

/**
 * Why the exit amount can't be shared between the groups of `unitCount` units split by `groupSize`, or null when it
 * can. Every group sends its winner. Per group, `total` is the qualifiers per group: at least 1, and below the smallest
 * real group (the split can make groups smaller than the Setup's size), so each group loses at least one. Otherwise
 * `total` is the number of units advancing: an even split takes the same number from every group, so each group loses
 * at least one; a fair cut keeps only the winners safe (a group may send everyone), so it needs one unit out in all.
 */
export function groupExitRefusal(
  unitCount: number,
  groupSize: number,
  mode: GroupExitMode,
  total: number,
  unitPlural: string,
): string | null {
  const groupSizes = groupSizesOf(unitCount, groupSize);
  const groups = describeGroupSizes(groupSizes);
  if (mode === 'per-group') return perGroupRefusal(groupSizes, groups, unitCount, total, unitPlural);
  if (total < groupSizes.length) {
    return `Advance to bracket (${total}) is below the number of groups: ${groups} each send their winner, so at least ${groupSizes.length} ${unitPlural} must go through.`;
  }
  if (mode === 'even-split') return evenSplitRefusal(groupSizes, groups, total, unitPlural);
  if (total >= unitCount) {
    return `Advance to bracket (${total}) would put every one of the ${unitCount} ${unitPlural} through: the fair cut needs at least one out, so at most ${unitCount - 1} can go through.`;
  }
  return null;
}

/** Qualifiers per group's refusal: below 1, or enough to take every unit of the smallest group. */
function perGroupRefusal(
  groupSizes: readonly number[],
  groups: string,
  unitCount: number,
  qualifiers: number,
  unitPlural: string,
): string | null {
  if (qualifiers < 1) return `Qualifiers per group must be a positive number — got ${qualifiers}.`;
  const smallest = Math.min(...groupSizes);
  if (qualifiers < smallest) return null;
  const unit = unitPlural.replace(/s$/, '');
  return `Qualifiers per group (${qualifiers}) would take every ${unit} of a group of ${smallest}: ${unitCount} ${unitPlural} make ${groups}. Use at most ${smallest - 1}, or change the group size.`;
}

/** An even split's refusal: one unit out of every group, so at most groups × (smallest group − 1) go through. */
function evenSplitRefusal(
  groupSizes: readonly number[],
  groups: string,
  total: number,
  unitPlural: string,
): string | null {
  const most = groupSizes.length * (Math.min(...groupSizes) - 1);
  if (total <= most) return null;
  const unit = unitPlural.replace(/s$/, '');
  return `Advance to bracket (${total}) is too many for an even split of ${groups}: it sends the same number from every group, so each group loses at least one ${unit} and at most ${most} can go through. Advance fewer, or use the fair cut, which keeps only each group's winner safe.`;
}
