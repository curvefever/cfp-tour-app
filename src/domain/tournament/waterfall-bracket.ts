import { newRound } from './new-round';
import { matchFormatFields } from './match-format';
import { plainRoundName } from './round-name';
import type {
  OrderedWaterfallGraph,
  TournamentRound,
  WaterfallBestRoute,
  WaterfallRoundSpec,
  WinTarget,
} from './types';
import { absoluteBest, bestDestinations, bestMoves, bestUnitsFromOut } from './waterfall-best';

/**
 * The Custom bracket (the waterfall / rank-band bracket phase) as it is played. The file holds what a running
 * tournament reads (where a rank goes, a round's declared seats, the fit of a short round) and the builder that turns a
 * checked graph into rounds (`waterfallBracketPhase`). The graph itself is read by `waterfall-graph-text.ts`, checked by
 * `waterfall-graph-check.ts` and ordered by `waterfall-graph-order.ts`.
 */

/**
 * The absolute round index a waterfall room's rank routes to, or null when
 * that rank is eliminated or has no route at all (which
 * advanceWaterfallBracket already treats as eliminated). `room` is 1-indexed,
 * `rankIndex` 0-indexed -- the waterfallRoutes convention.
 */
export function waterfallDestination(round: TournamentRound, room: number, rankIndex: number): number | null {
  const destination = round.waterfallRoutes?.[room - 1]?.[rankIndex];
  return typeof destination === 'number' ? destination : null;
}

/**
 * Where an absentee at `rankIndex` of a room of `roomSize` drawn units (present and absent together) goes: its
 * rank's destination only when that equals the destination of the room's last place, else null (it is out).
 * An absentee never takes a seat above the room's last place. `room` 1-indexed, `rankIndex` 0-indexed.
 */
export function absenteeDestination(
  round: TournamentRound,
  room: number,
  roomSize: number,
  rankIndex: number,
): number | null {
  const destination = waterfallDestination(round, room, rankIndex);
  return destination === waterfallDestination(round, room, roomSize - 1) ? destination : null;
}

/** The seats the graph declares for a waterfall round, whether or not it was drawn short. */
export function declaredWaterfallRooms(round: TournamentRound): number[] {
  return round.declaredRooms ?? round.rooms;
}

export function declaredWaterfallSeats(round: TournamentRound): number {
  return declaredWaterfallRooms(round).reduce((total, size) => total + size, 0);
}

/**
 * Takes `missing` seats out of the declared rooms, one at a time out of the last of the largest rooms, so rooms
 * that start level end at most 1 apart (2x8 missing 1 is [8, 7], missing 2 is [7, 7]; 8+8+7 missing 1 is [8, 7, 7]).
 */
export function removeSeatsFromLastRooms(declared: number[], missing: number): number[] {
  const rooms = [...declared];
  for (let taken = 0; taken < missing; taken += 1) rooms[rooms.lastIndexOf(Math.max(...rooms))] -= 1;
  return rooms.filter((size) => size > 0);
}

/** The units a drawn room set sends on: every rank whose band isn't 'eliminated', and the best of a place when the rest of it is out (a Final keeps its single winner). */
export function advancingSeats(round: TournamentRound, rooms: number[]): number {
  if (round.isFinal || !round.waterfallRoutes) return round.advTotal;
  const onByRoutes = rooms.reduce(
    (total, size, index) =>
      total +
      (round.waterfallRoutes?.[index] ?? []).slice(0, size).filter((route) => route !== 'eliminated').length,
    0,
  );
  return onByRoutes + bestUnitsFromOut(round.waterfallBest, round.waterfallRoutes, rooms);
}

/**
 * Draws a waterfall round for the units that actually arrived. A round accepts fewer than it declares
 * (a withdrawal: the empty seat is simply not there, and each room routes the ranks it has), keeping
 * its room count; the missing seats come out of the last rooms first. Arrivals beyond the declared
 * seats are the caller's malformed case. The declared rooms stay on the round (`declaredRooms`) while
 * it is short. An error when nobody arrives, or a Final would have under 2.
 */
export function fitWaterfallRound(
  round: TournamentRound,
  poolSize: number,
): TournamentRound | { error: string } {
  const declared = declaredWaterfallRooms(round);
  const seats = declared.reduce((total, size) => total + size, 0);
  const minimum = round.isFinal ? 2 : 1;
  if (poolSize < minimum) {
    const label = plainRoundName(round);
    const reaching = poolSize <= 0 ? 'Nobody' : `Only ${poolSize} unit`;
    return {
      error: `${reaching} would reach "${label}", which needs at least ${minimum} to play. A mid-tournament withdrawal has emptied it; check Manage Teams before advancing further.`,
    };
  }
  const { declaredRooms: _declared, ...rest } = round;
  const rooms = removeSeatsFromLastRooms(declared, seats - poolSize);
  const fitted = { ...rest, rooms, players: poolSize, advTotal: advancingSeats(round, rooms) };
  return poolSize === seats ? fitted : { ...fitted, declaredRooms: declared };
}

export interface WaterfallBracketConfig {
  graph: OrderedWaterfallGraph;
  finalsGames: number;
  finalsBestOf?: number;
}

/**
 * The graph's Qual routing as absolute round indices, ready to sit on the last
 * qualification round as `standingsRoutes` (the same convention as
 * `waterfallRoutes`); undefined for a graph without a Qual source.
 */
export function waterfallStandingsRoutes(
  graph: OrderedWaterfallGraph,
  startRoundNum: number,
): Array<number | 'eliminated'> | undefined {
  return graph.qualRoutes?.map((destination) =>
    destination === 'eliminated' ? 'eliminated' : startRoundNum - 1 + destination,
  );
}

/**
 * Materializes a fully-validated, topologically-sorted waterfall graph into
 * TournamentRound[] -- unlike every other bracket-phase builder in this
 * codebase, it doesn't derive room shape from a formula, it copies the
 * organiser's own pre-validated graph directly. `seedTotal` is redundant
 * with the graph's own validated entry-round total (rule 9 above already
 * checked that against the real entrant count) -- kept as a parameter
 * anyway to match every other builder's (seedTotal, startRoundNum, config)
 * signature, for uniform dispatch in schedule-generation.ts, and asserted
 * against here as a cheap internal consistency check.
 */
export function waterfallBracketPhase(
  seedTotal: number,
  startRoundNum: number,
  config: WaterfallBracketConfig,
): TournamentRound[] {
  const { graph } = config;
  // With a Qual source the qualification table feeds the graph, so the
  // pooling phase's seedTotal (qualAdv, the highest routed rank) is checked
  // against the Qual routing instead of the first round's total.
  const expectedSeedTotal =
    graph.qualRoutes?.length ?? graph.rounds[0]?.roomSizes.reduce((sum, size) => sum + size, 0) ?? 0;
  if (expectedSeedTotal !== seedTotal) {
    throw new Error(
      `waterfallBracketPhase: seedTotal (${seedTotal}) doesn't match the graph's own validated ${graph.qualRoutes ? 'highest routed qualification rank' : 'entry-round total'} (${expectedSeedTotal}) -- the graph should already have been validated against the real entrant count before this is called.`,
    );
  }

  const declared = graph.rounds.map((roundSpec, index): TournamentRound => {
    const players = roundSpec.roomSizes.reduce((sum, size) => sum + size, 0);
    const routesForRound = graph.routes[index] ?? [];
    const best = absoluteBest(graph.best?.[index], startRoundNum);
    const eliminatedCount = routesForRound.reduce(
      (sum, roomDestinations) =>
        sum + roomDestinations.filter((destination) => destination === 'eliminated').length,
      0,
    );
    return newRound({
      roundNum: startRoundNum + index,
      players,
      rooms: roundSpec.roomSizes,
      isFinal: roundSpec.isFinal,
      advTotal: roundSpec.isFinal
        ? 1
        : players -
          eliminatedCount +
          bestUnitsFromOut(graph.best?.[index] ?? undefined, routesForRound, roundSpec.roomSizes),
      ...matchFormatFields(roundSpec, config.finalsGames, config.finalsBestOf),
      isWaterfall: true,
      customLabel: roundSpec.label,
      waterfallColumn: graph.columns[index],
      ...(roundSpec.columnSet ? { waterfallColumnSet: true as const } : {}),
      ...(roundSpec.isRanking ? { waterfallRanking: true as const } : {}),
      ...(best ? { waterfallBest: best } : {}),
      ...(roundSpec.winTargets
        ? { winTargets: absoluteWinTargets(roundSpec.winTargets, startRoundNum) }
        : {}),
      waterfallRoutes: routesForRound.map((roomDestinations) =>
        roomDestinations.map((destination) =>
          destination === 'eliminated' ? 'eliminated' : startRoundNum - 1 + destination,
        ),
      ),
    });
  });
  return withShortEntryFitted(graph, declared);
}

/**
 * A WINS round's targets with `from` as an absolute round index: a round of the graph is `startRoundNum - 1 + index`,
 * the Qual or Groups line is the pooling round just before the bracket (the one holding `standingsRoutes`).
 */
function absoluteWinTargets(
  targets: NonNullable<WaterfallRoundSpec['winTargets']>,
  startRoundNum: number,
): WinTarget[] {
  return targets.map((target) => ({
    from: target.from === 'qual' ? startRoundNum - 2 : startRoundNum - 1 + target.from,
    wins: target.wins,
  }));
}

/** True when a round fed only by the standings line is routed fewer units than it declares seats. */
function hasShortEntryRound(graph: OrderedWaterfallGraph, lineArrivals: number[]): boolean {
  const fedByRound = new Set([
    ...graph.routes.flatMap((rooms) => rooms.flat()),
    ...bestDestinations(graph.best),
  ]);
  return graph.rounds.some((roundSpec, index) => {
    const seats = roundSpec.roomSizes.reduce((total, size) => total + size, 0);
    return lineArrivals[index] > 0 && !fedByRound.has(index) && lineArrivals[index] < seats;
  });
}

/** The BEST route's units move from the round the rest go to into the chosen round, in the tally of arrivals. */
function countBestArrivals(
  arrivals: number[],
  best: WaterfallBestRoute | null | undefined,
  routes: OrderedWaterfallGraph['routes'][number],
  rooms: number[],
): void {
  if (!best) return;
  const { chosen, rest } = bestMoves(best, routes, rooms);
  arrivals[best.destination] += chosen;
  if (rest !== 'eliminated') arrivals[rest] -= chosen;
}

/**
 * Draws a graph whose entry round arrives short (see `arrivesShort`) at the sizes that really arrive. The rounds are
 * walked in play order: what a round receives is the line's ranks routed to it, then every earlier room's ranks by
 * destination, only up to the size the room really has (a rank past a short room's last place doesn't exist).
 * Every round goes through `fitWaterfallRound`, so `rooms`, `players`, `advTotal` and `declaredRooms` are right from
 * the start. A graph with no short round returns `rounds` as they are. A round nothing reaches keeps its declared
 * shape and sends nobody on.
 */
function withShortEntryFitted(graph: OrderedWaterfallGraph, rounds: TournamentRound[]): TournamentRound[] {
  const arrivals = graph.rounds.map(() => 0);
  for (const destination of graph.qualRoutes ?? []) {
    if (destination !== 'eliminated') arrivals[destination] += 1;
  }
  if (!hasShortEntryRound(graph, arrivals)) return rounds;
  return rounds.map((round, index) => {
    const fitted = fitWaterfallRound(round, arrivals[index]);
    if ('error' in fitted) return round;
    fitted.rooms.forEach((size, room) => {
      for (const destination of (graph.routes[index]?.[room] ?? []).slice(0, size)) {
        if (destination !== 'eliminated') arrivals[destination] += 1;
      }
    });
    countBestArrivals(arrivals, graph.best?.[index], graph.routes[index] ?? [], fitted.rooms);
    return fitted;
  });
}
