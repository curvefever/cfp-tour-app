import {
  buildAdvancementTiers,
  doubleEliminationComputeAdvancement,
  orderedQualificationTable,
} from './advancement';
import { rosterKeys } from './roster';
import { routeStandings, routeWaterfallRound } from './transitions';
import type { PendingBracketSeed, TournamentState } from './types';

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
