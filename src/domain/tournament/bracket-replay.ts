import {
  buildAdvancementTiers,
  doubleEliminationComputeAdvancement,
  orderedQualificationTable,
} from './advancement';
import { rosterKeys } from './roster';
import type { PendingBracketSeed, TournamentRound, TournamentStanding, TournamentState } from './types';
import { waterfallDestination } from './waterfall-bracket';

/**
 * Where the units of the bracket rounds already advanced from sit now, rebuilt from the recorded results:
 * the pools `state.pendingBracketSeeds` holds for rounds not drawn yet, and the double elimination lucky
 * losers waiting for them. A bracket round sends each of its units to one destination (or out), computed
 * from its stored scores, byes and routing, so the pools are a pure function of those rounds.
 */

/**
 * Maps a name from a recorded line-up to the unit that is in the tournament now: itself if still registered,
 * the unit that replaced it if it was swapped out (followed through further swaps), else null (a withdrawal).
 */
export function currentUnit(state: TournamentState, roster: Set<string>, name: string): string | null {
  let current = name;
  for (let hops = 0; hops <= state.withdrawnUnits.length; hops += 1) {
    if (roster.has(current)) return current;
    const next = state.withdrawnUnits.find((unit) => unit.name === current)?.replacedBy;
    if (next === undefined) return null;
    current = next;
  }
  return null;
}

interface DoubleEliminationContributions {
  /** What the round sends to each destination, keyed by `winnersTo` and `losersTo`. */
  additions: Map<number, PendingBracketSeed[]>;
  /** The lucky losers the round sends to its winners destination. */
  lucky: Map<number, string[]>;
}

/**
 * What a double elimination round sends where: the winners (the round's byes first, then the room winners
 * and lucky losers) to `winnersTo`, the rest to `losersTo`. Every unit is tagged with its room-rank tier and
 * in-tier pct at the moment it is pushed -- buildAdvancementTiers ranks EVERY occupant of a room (not just
 * advancers), so a "loser" lands at its own actual room-rank position and a carried-over bye folds to rank 0
 * with the round's largest relative score, exactly like the generic reseeding path. Captured here, not at
 * finalize time, because a target round's pool can accumulate from more than one source round.
 */
export function doubleEliminationContributions(
  state: TournamentState,
  roundIndex: number,
): DoubleEliminationContributions {
  const round = state.rounds[roundIndex];
  const result = doubleEliminationComputeAdvancement(state, roundIndex);
  if (state.byes[roundIndex]?.length) {
    result.winners = [...state.byes[roundIndex].map((name) => ({ name })), ...result.winners];
  }

  const tierByName = new Map(
    buildAdvancementTiers(state, roundIndex, [
      ...result.winners.map(({ name }) => name),
      ...result.losers.map(({ name }) => name),
    ]).flatMap((tier) =>
      tier.members.map((member) => [member.name, { tierRank: tier.rank, pct: member.pct }] as const),
    ),
  );
  const seedsFor = (entries: Array<{ name: string }>): PendingBracketSeed[] =>
    entries.map(({ name }) => ({
      name,
      isLucky: false,
      ...(tierByName.get(name) ?? { tierRank: 0, pct: 1 }),
    }));

  const additions = new Map<number, PendingBracketSeed[]>();
  const lucky = new Map<number, string[]>();
  if (round.winnersTo != null) {
    additions.set(round.winnersTo, seedsFor(result.winners));
    if (result.luckyNames.length) lucky.set(round.winnersTo, result.luckyNames);
  }
  if (round.losersTo != null) additions.set(round.losersTo, seedsFor(result.losers));
  return { additions, lucky };
}

/**
 * Ranks every occupant of a waterfall round within their own room
 * (buildAdvancementTiers, called once over the WHOLE room, not a pre-split
 * winners/losers list) and looks up each occupant's own band via
 * `round.waterfallRoutes[room-1][rank]` (tier.rank is already 0-indexed, the
 * same convention waterfallRoutes itself uses for "rank - 1"). Returns the
 * additions grouped by destination round index -- NOT yet folded into
 * `state.pendingBracketSeeds`, so a replay (waterfall-live-edit.ts) can
 * inspect a round's outcome against a hypothetical routing without mutating
 * any pool. `round` is passed separately from `state.rounds[roundIndex]` so
 * a caller can rank against the live scores while routing through an edited
 * (not-yet-committed) round object.
 */
export function routeWaterfallRound(
  state: TournamentState,
  roundIndex: number,
  round: TournamentRound,
): Map<number, PendingBracketSeed[]> {
  const names = (state.assignments[roundIndex] ?? []).map((entry) => entry.name);
  const tiers = buildAdvancementTiers(state, roundIndex, names);

  const additionsByDestination = new Map<number, PendingBracketSeed[]>();
  for (const tier of tiers) {
    for (const member of tier.members) {
      const destination = waterfallDestination(round, member.sourceRoom, tier.rank);
      if (destination === null) continue;
      const additions = additionsByDestination.get(destination) ?? [];
      additions.push({ name: member.name, isLucky: false, tierRank: tier.rank, pct: member.pct });
      additionsByDestination.set(destination, additions);
    }
  }
  return additionsByDestination;
}

/**
 * Sends the qualification table's final standings through the last
 * qualification round's `standingsRoutes` (the Qual source of a waterfall
 * graph): position i of the ordered table goes to `standingsRoutes[i]`, and a
 * position routed 'eliminated' or past the end of the routing goes nowhere.
 * `ordered` is the table with every cut-off tie resolution applied
 * (orderedQualificationTable). Each destination's arrivals are numbered in
 * standings order (`tierRank`), with the standing's room share as `pct`, so a
 * round fed only by Qual is seeded in standings order. Same shape as
 * routeWaterfallRound: additions only, no pool is touched.
 */
export function routeStandings(
  ordered: Array<Pick<TournamentStanding, 'name' | 'roomShare'>>,
  round: TournamentRound,
): Map<number, PendingBracketSeed[]> {
  const additionsByDestination = new Map<number, PendingBracketSeed[]>();
  for (const [position, standing] of ordered.entries()) {
    const destination = round.standingsRoutes?.[position];
    if (typeof destination !== 'number') continue;
    const additions = additionsByDestination.get(destination) ?? [];
    additions.push({
      name: standing.name,
      isLucky: false,
      tierRank: additions.length,
      pct: standing.roomShare ?? 0,
    });
    additionsByDestination.set(destination, additions);
  }
  return additionsByDestination;
}

export interface BracketReplay {
  pools: Map<number, PendingBracketSeed[]>;
  lucky: Map<number, string[]>;
}

/**
 * Replays every advance before round `beforeIndex`, in order: the Qual exit (the qualification round's
 * stored `standingsExitOrder` through its `standingsRoutes`) when that round is before it, then each double
 * elimination or waterfall round. Each pool keeps the order a real advance builds it in. Every name goes
 * through `currentUnit`, so a withdrawn unit is dropped (nobody moves up into its seat) and a swapped-out
 * one is its replacement. A table with no stored exit order is recomputed from the standings.
 */
export function replayBracketPools(state: TournamentState, beforeIndex: number): BracketReplay {
  const roster = new Set(rosterKeys(state.players));
  const pools = new Map<number, PendingBracketSeed[]>();
  const lucky = new Map<number, string[]>();
  const addToPools = (additions: Map<number, PendingBracketSeed[]>) => {
    for (const [destination, seeds] of additions) {
      const current = seeds.flatMap((seed) => {
        const name = currentUnit(state, roster, seed.name);
        return name === null ? [] : [{ ...seed, name }];
      });
      pools.set(destination, [...(pools.get(destination) ?? []), ...current]);
    }
  };
  const addToLucky = (additions: Map<number, string[]>) => {
    for (const [destination, names] of additions) {
      const current = names.flatMap((name) => currentUnit(state, roster, name) ?? []);
      lucky.set(destination, [...(lucky.get(destination) ?? []), ...current]);
    }
  };

  const qualIndex = state.rounds.findIndex((round) => round.standingsRoutes);
  if (qualIndex !== -1 && qualIndex < beforeIndex) {
    const qualRound = state.rounds[qualIndex];
    const exitOrder = qualRound.standingsExitOrder ?? orderedQualificationTable(state).ordered;
    addToPools(routeStandings(exitOrder, qualRound));
  }
  for (let index = 0; index < beforeIndex; index += 1) {
    const round = state.rounds[index];
    if (round.bracket) {
      const { additions, lucky: luckyNames } = doubleEliminationContributions(state, index);
      addToPools(additions);
      addToLucky(luckyNames);
    } else if (round.isWaterfall) {
      addToPools(routeWaterfallRound(state, index, round));
    }
  }
  return { pools, lucky };
}
