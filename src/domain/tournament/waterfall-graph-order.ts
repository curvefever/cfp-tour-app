import type { OrderedWaterfallGraph, WaterfallRoundSpec } from './types';
import { orderedBest, type ResolvedBest } from './waterfall-best';
import {
  ELIMINATED,
  GROUPS_LABEL,
  QUAL_LABEL,
  err,
  expandRankTokens,
  ok,
  type RawRoundLine,
  type RawRouteBand,
  type RawWaterfallGraph,
} from './waterfall-graph-text';
import type { WaterfallParseResult } from './waterfall-parse-result';
import {
  WINS_STANDINGS_SOURCE,
  type ResolvedWinTarget,
  type WinsBand,
  type WinsRound,
} from './waterfall-wins';

/**
 * The order of a Custom bracket graph: the column of every round (`assignWaterfallColumns`) and the ordered graph the
 * validator ends with, in play order with each destination as a round's position (`buildOrderedGraph`). Also what the
 * validator reads on its way there: each round's feeders, and the rounds and bands as `waterfall-wins.ts` reads them.
 */

/** The ROUNDS lines as `waterfall-wins.ts` reads them. */
export function winsRoundsOf(roundLines: RawRoundLine[]): WinsRound[] {
  return roundLines.map((round) => ({
    label: round.label,
    roomSizes: round.roomSizes,
    wins: round.wins === true,
  }));
}

/** Every band of the graph that enters a round, with what `waterfall-wins.ts` checks of it. A band whose ranks can't be read counts none (the rank checks name it). */
export function winsBandsOf(graph: RawWaterfallGraph): WinsBand[] {
  const ofBands = (
    bands: RawRouteBand[],
    source: Omit<WinsBand, 'destination' | 'ranks' | 'wins'>,
  ): WinsBand[] =>
    bands.map((band) => {
      const ranks = expandRankTokens(band.rankTokens);
      return {
        ...source,
        destination: band.destinationLabel.toLowerCase(),
        ranks: ranks.ok ? ranks.value.length : 0,
        wins: band.wins ?? null,
      };
    });
  const standings = graph.qualBands
    ? ofBands(graph.qualBands, {
        sourceName: `The ${graph.standingsKind === 'groups' ? GROUPS_LABEL : QUAL_LABEL} line`,
        source: WINS_STANDINGS_SOURCE,
        room: 1,
      })
    : [];
  const fromRounds = graph.routeLines.flatMap((line) =>
    ofBands(line.bands, {
      sourceName: `Round "${line.label}"`,
      source: line.label.toLowerCase(),
      room: line.room ?? 1,
    }),
  );
  return [...standings, ...fromRounds];
}

/** For each round of the topological order, the positions of the rounds that route into it. */
export function topoFeeders(topoOrder: string[], destinationsByLabel: Map<string, Set<string>>): number[][] {
  const position = new Map(topoOrder.map((label, index) => [label, index]));
  const feeders: number[][] = topoOrder.map(() => []);
  for (const [source, destinations] of destinationsByLabel) {
    for (const destination of destinations) {
      feeders[position.get(destination) as number].push(position.get(source) as number);
    }
  }
  return feeders;
}

export interface WaterfallColumnInput {
  label: string;
  /** The organiser's own column number, null for automatic. */
  column: number | null;
  /** The positions (in the rounds array) of the rounds that route into this one. */
  feeders: number[];
}

/**
 * The column of every round, `rounds` being in topological order (every feeder comes before the round
 * it feeds). A round with no number goes in the column after its feeders' latest (column 1 when no
 * round routes into it, the qualification table being column 0); a numbered round must be later than
 * every feeder. A round in `fixed` already has its column (a started round of a live edit) and a
 * different number on it is refused; the other rounds can't use a column before `firstOpenColumn`.
 * No column may be left empty between 1 and the last.
 */
export function assignWaterfallColumns(
  rounds: WaterfallColumnInput[],
  options: { fixed?: Array<number | undefined>; firstOpenColumn?: number } = {},
): WaterfallParseResult<number[]> {
  const { fixed, firstOpenColumn = 1 } = options;
  const columns: number[] = [];
  for (const [index, round] of rounds.entries()) {
    let latest: number | null = null;
    for (const feeder of round.feeders) {
      if (latest === null || columns[feeder] > columns[latest]) latest = feeder;
    }
    const after = latest === null ? 0 : columns[latest];
    const started = fixed?.[index];
    if (started !== undefined && round.column !== null && round.column !== started) {
      return err(`Round "${round.label}" has already started in column ${started}.`);
    }
    const chosen = started ?? round.column;
    if (chosen !== null && chosen <= after) {
      return err(
        `Round "${round.label}" can't be in column ${chosen}: round "${rounds[latest as number].label}" routes into it and is in column ${after}.`,
      );
    }
    if (started === undefined && chosen !== null && chosen < firstOpenColumn) {
      return err(`Column ${chosen} has already started -- choose column ${firstOpenColumn} or later.`);
    }
    columns.push(chosen ?? Math.max(after + 1, firstOpenColumn));
  }
  const used = new Set(columns);
  for (let column = 1; column <= Math.max(0, ...columns); column += 1) {
    if (!used.has(column)) {
      return err(
        `Column ${column} has no round -- renumber the later columns or set a round to column ${column}.`,
      );
    }
  }
  return ok(columns);
}

export function buildOrderedGraph(
  topoOrder: string[],
  columns: number[],
  roundByLabel: Map<string, RawRoundLine>,
  roomBandsByLabel: Map<string, string[][]>,
  qualLabels: string[] | null,
  best: Map<string, ResolvedBest>,
  winTargets: Map<string, ResolvedWinTarget[]>,
): OrderedWaterfallGraph {
  const indexByLabel = new Map(topoOrder.map((label, index) => [label, index]));
  const rounds: WaterfallRoundSpec[] = topoOrder.map((label) => {
    const round = roundByLabel.get(label) as RawRoundLine;
    const targets = winTargets.get(label);
    return {
      label: round.label,
      roomSizes: round.roomSizes,
      isFinal: round.isFinal,
      ...(round.isRanking ? { isRanking: true as const } : {}),
      ...(round.column === null ? {} : { columnSet: true as const }),
      ...(round.bestOf === undefined ? {} : { bestOf: round.bestOf }),
      ...(round.games === undefined ? {} : { games: round.games }),
      ...(targets
        ? {
            winTargets: targets.map((target) => ({
              from:
                target.source === WINS_STANDINGS_SOURCE
                  ? ('qual' as const)
                  : (indexByLabel.get(target.source) as number),
              wins: target.wins,
            })),
          }
        : {}),
    };
  });
  const routes: Array<Array<Array<number | 'eliminated'>>> = topoOrder.map((label) => {
    const roomDestinationArrays = roomBandsByLabel.get(label) ?? [];
    return roomDestinationArrays.map((destinations) =>
      destinations.map((destinationLabel) =>
        destinationLabel.toLowerCase() === ELIMINATED
          ? ('eliminated' as const)
          : (indexByLabel.get(destinationLabel.toLowerCase()) as number),
      ),
    );
  });

  const qualRoutes = qualLabels?.map((destinationLabel) =>
    destinationLabel.toLowerCase() === ELIMINATED
      ? ('eliminated' as const)
      : (indexByLabel.get(destinationLabel.toLowerCase()) as number),
  );

  return {
    rounds,
    columns,
    routes,
    ...(best.size > 0 ? { best: orderedBest(topoOrder, indexByLabel, best) } : {}),
    ...(qualRoutes ? { qualRoutes } : {}),
  };
}
