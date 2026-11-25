import { newRound } from './new-round';
import { matchFormatFields } from './match-format';
import { plainRoundName } from './round-name';
import type {
  OrderedWaterfallGraph,
  RoomSize,
  TournamentRound,
  WaterfallBestRoute,
  WaterfallRoundSpec,
  WinTarget,
} from './types';
import {
  absoluteBest,
  addBestEdges,
  applyBestSeats,
  bestDestinations,
  bestMoves,
  bestUnitsFromOut,
  orderedBest,
  resolveBestLines,
  type ResolvedBest,
} from './waterfall-best';
import {
  ELIMINATED,
  GROUPS_LABEL,
  QUAL_LABEL,
  SOURCE_LINE,
  err,
  expandRankTokens,
  ok,
  roomIndexToLetter,
  undeclaredDestinationMessage,
  undeclaredRoundMessage,
  type RawRoundLine,
  type RawRouteBand,
  type RawRouteLine,
  type RawWaterfallGraph,
  type StandingsSourceKind,
} from './waterfall-graph-text';
import type { WaterfallParseResult } from './waterfall-parse-result';
import {
  WINS_STANDINGS_SOURCE,
  checkWinsRounds,
  resolveWinTargets,
  type ResolvedWinTarget,
  type WinsBand,
  type WinsRound,
} from './waterfall-wins';

/**
 * The Custom bracket (the waterfall / rank-band bracket phase), whose text is read by `waterfall-graph-text.ts`. The
 * file holds the validator that orders the graph (`validateAndOrderWaterfallGraph`), the column rules
 * (`assignWaterfallColumns`), the helpers a running tournament reads (where a rank goes, the fit of a short round) and
 * the builder that turns a graph into rounds (`waterfallBracketPhase`).
 */

/** What a rank of the line is called in messages. */
const SOURCE_RANK: Record<StandingsSourceKind, string> = {
  qual: 'qualification rank',
  groups: 'group exit rank',
};

/** Builds one room's per-rank destination-label array from its route line's bands; a rank no band covers is eliminated. Bands must not overlap. */
function buildRoomDestinations(
  roomDisplayName: string,
  roomSize: number,
  bands: RawRouteBand[],
): WaterfallParseResult<string[]> {
  const destinations: Array<string | undefined> = Array.from({ length: roomSize }, () => undefined);
  for (const band of bands) {
    const expanded = expandRankTokens(band.rankTokens);
    if (!expanded.ok) return err(`${roomDisplayName}: ${expanded.error}`);
    for (const rank of expanded.value) {
      if (rank < 1 || rank > roomSize) {
        return err(
          `${roomDisplayName}: rank ${rank} is out of range -- this room only has ${roomSize} player(s).`,
        );
      }
      if (destinations[rank - 1] !== undefined) {
        return err(`${roomDisplayName}: rank ${rank} is routed more than once -- bands must not overlap.`);
      }
      destinations[rank - 1] = band.destinationLabel;
    }
  }
  return ok(destinations.map((destination) => destination ?? ELIMINATED));
}

/**
 * The per-rank destination labels of the Qual or Groups line: ranks the line
 * doesn't route are eliminated (gaps allowed), and trailing eliminated ranks
 * are trimmed so the array's length is the highest routed rank.
 */
function buildQualDestinations(
  bands: RawRouteBand[],
  roundByLabel: Map<string, RawRoundLine>,
  kind: StandingsSourceKind,
): WaterfallParseResult<string[]> {
  const name = SOURCE_LINE[kind];
  const destinations: Array<string | undefined> = [];
  for (const band of bands) {
    const expanded = expandRankTokens(band.rankTokens);
    if (!expanded.ok) return err(`${name}: ${expanded.error}`);
    const destKey = band.destinationLabel.toLowerCase();
    if (destKey !== ELIMINATED && !roundByLabel.has(destKey)) {
      return err(undeclaredDestinationMessage(name, band.destinationLabel));
    }
    for (const rank of expanded.value) {
      if (rank < 1) return err(`${name}: rank ${rank} is out of range -- ${SOURCE_RANK[kind]}s start at 1.`);
      if (destinations[rank - 1] !== undefined) {
        return err(`${name}: rank ${rank} is routed more than once -- bands must not overlap.`);
      }
      destinations[rank - 1] = band.destinationLabel;
    }
  }
  let length = destinations.length;
  while (length > 0 && (destinations[length - 1] ?? ELIMINATED).toLowerCase() === ELIMINATED) length -= 1;
  if (length === 0) {
    return err(`The ${name} line sends no ${SOURCE_RANK[kind]} on -- route at least one rank to a round.`);
  }
  return ok(Array.from({ length }, (_, index) => destinations[index] ?? ELIMINATED));
}

/** What is wrong with the line a graph has, when the tournament's pooling phase (`kind`, null for neither) wants another. */
function wrongSourceLineMessage(line: StandingsSourceKind, kind: StandingsSourceKind | null): string {
  if (line === 'qual') {
    return kind === 'groups'
      ? 'The Qual line routes a qualification table, but this tournament has a group stage -- use a Groups line instead.'
      : 'The Qual line routes the qualification table, but this tournament has no qualification table -- remove the Qual line.';
  }
  return kind === 'qual'
    ? 'The Groups line routes a group stage, but this tournament has a qualification table -- use a Qual line instead.'
    : "The Groups line routes the group stage's exit, but this tournament has no group stage -- remove the Groups line.";
}

/** The one round nothing routes into, or an error when there is none or more than one. */
function findEntryLabel(
  labels: string[],
  inDegree: Map<string, number>,
  roundByLabel: Map<string, RawRoundLine>,
): WaterfallParseResult<string> {
  const entryCandidates = labels.filter((label) => (inDegree.get(label) ?? 0) === 0);
  if (entryCandidates.length === 0) {
    return err('The routing table has a cycle -- no round has zero incoming routes to start from.');
  }
  if (entryCandidates.length > 1) {
    return err(
      `More than one round has no incoming routes (${entryCandidates.map((label) => roundByLabel.get(label)!.label).join(', ')}) -- there must be exactly one starting round.`,
    );
  }
  return ok(entryCandidates[0]);
}

function allEliminated(roomSize: number): string[] {
  return Array.from({ length: roomSize }, () => ELIMINATED);
}

function nonEliminatedLabels(destinations: string[]): string[] {
  return destinations.map((label) => label.toLowerCase()).filter((label) => label !== ELIMINATED);
}

function countByLabel(labels: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return counts;
}

/**
 * True when a round fed only by the standings line may declare more seats than the line routes: fewer
 * seats than it has rooms, so every room stays seated, and no room left under the format's minimum.
 * `removeSeatsFromLastRooms` is the shape such a round is drawn in.
 */
function arrivesShort(declared: number[], arriving: number, minimumRoom: number): boolean {
  const missing = declared.reduce((total, size) => total + size, 0) - arriving;
  if (missing <= 0 || missing >= declared.length) return false;
  return removeSeatsFromLastRooms(declared, missing).every((size) => size >= minimumRoom);
}

export function validateAndOrderWaterfallGraph(
  graph: RawWaterfallGraph,
  options: {
    roomSize: RoomSize;
    /**
     * Left out while it isn't known yet (no roster loaded); rule 9 is then skipped. Without a Qual
     * source it is the number entering the bracket phase; with `standingsSource` it is the registered
     * head count the qualification table is ranked from.
     */
    entrantCount?: number;
    /**
     * True when the graph is fed by a qualification table or a group stage: the Qual (or, with
     * `standingsKind: 'groups'`, the Groups) line is allowed (a graph without one is read as
     * `Qual: 1-<entry round total> -> <entry round>`), and every declared round must be fed by it or
     * another round. False: a Qual or Groups line is an error.
     */
    standingsSource?: boolean;
    /** Which line feeds the graph when `standingsSource` is set: 'qual' (the default) or 'groups'. */
    standingsKind?: StandingsSourceKind;
    /**
     * Round labels, in play order, that the returned order must start with
     * exactly (a live edit's already-reached rounds, which can't be
     * reordered). Without it, the play order is derived purely from the
     * routing, as normal.
     */
    fixedPrefix?: string[];
    /** Index-aligned with `fixedPrefix`: the column each of those rounds already has. Without it they are placed like any other round. */
    fixedColumns?: number[];
    /** The first column an unreached round may use (a live edit: the columns before it have started). Default 1. */
    firstOpenColumn?: number;
  },
): WaterfallParseResult<OrderedWaterfallGraph> {
  const { roundLines, routeLines } = graph;
  const { roomSize, entrantCount, fixedPrefix, standingsSource } = options;
  const kind: StandingsSourceKind | null = standingsSource ? (options.standingsKind ?? 'qual') : null;

  if (graph.standingsKind !== null && graph.standingsKind !== kind) {
    return err(wrongSourceLineMessage(graph.standingsKind, kind));
  }

  // Rule 1: every declared room size must fit the format's own bounds.
  for (const round of roundLines) {
    for (const size of round.roomSizes) {
      if (size < roomSize.min || size > roomSize.max) {
        return err(
          `Round "${round.label}" declares a room of size ${size}, outside this format's allowed room size (${roomSize.min}-${roomSize.max}).`,
        );
      }
    }
  }

  const roundByLabel = new Map(roundLines.map((round) => [round.label.toLowerCase(), round]));

  // Rule 2: exactly one FINAL round, with no outgoing line.
  const finalRounds = roundLines.filter((round) => round.isFinal);
  if (finalRounds.length === 0) {
    return err('No round is marked FINAL -- exactly one round must end with "FINAL".');
  }
  if (finalRounds.length > 1) {
    return err(
      `More than one round is marked FINAL (${finalRounds.map((round) => round.label).join(', ')}) -- exactly one is allowed.`,
    );
  }

  const routesByLabel = new Map<string, RawRouteLine[]>();
  for (const route of routeLines) {
    const key = route.label.toLowerCase();
    if (!roundByLabel.has(key)) {
      return err(undeclaredRoundMessage(route.label));
    }
    routesByLabel.set(key, [...(routesByLabel.get(key) ?? []), route]);
  }

  // Rule 3 + overlap check (rule 4; uncovered ranks are eliminated) + destination existence/self-loop (rule 5):
  // resolve every round's per-room destination-label arrays.
  const roomBandsByLabel = new Map<string, string[][]>();
  for (const round of roundLines) {
    const key = round.label.toLowerCase();
    const routes = routesByLabel.get(key) ?? [];
    if (round.isFinal) {
      if (routes.length > 0) {
        return err(
          `Round "${round.label}" is marked FINAL but has an outgoing ROUTES line -- nothing routes out of the Final.`,
        );
      }
      continue;
    }
    const roomCount = round.roomSizes.length;
    const roomDestinations: string[][] = new Array(roomCount);
    if (roomCount === 1) {
      if (routes.length > 1) {
        return err(
          `Round "${round.label}" has more than one ROUTES line -- it has only 1 room, combine them into one.`,
        );
      }
      if (routes.length === 0) {
        roomDestinations[0] = allEliminated(round.roomSizes[0]);
      } else {
        if (routes[0].room !== null) {
          return err(
            `Round "${round.label}" has only 1 room -- address it as "${round.label}", not "${round.label}.${roomIndexToLetter(routes[0].room)}".`,
          );
        }
        const built = buildRoomDestinations(round.label, round.roomSizes[0], routes[0].bands);
        if (!built.ok) return built;
        roomDestinations[0] = built.value;
      }
    } else {
      const seenRooms = new Set<number>();
      for (const route of routes) {
        if (route.room === null) {
          return err(
            `Round "${round.label}" has ${roomCount} rooms -- address each one as "${round.label}.A", "${round.label}.B", etc.`,
          );
        }
        if (route.room < 1 || route.room > roomCount) {
          return err(
            `Round "${round.label}" only has ${roomCount} room(s) -- "${round.label}.${roomIndexToLetter(route.room)}" is out of range.`,
          );
        }
        if (seenRooms.has(route.room)) {
          return err(
            `Round "${round.label}.${roomIndexToLetter(route.room)}" has more than one ROUTES line -- combine them into one.`,
          );
        }
        seenRooms.add(route.room);
        const built = buildRoomDestinations(
          `${round.label}.${roomIndexToLetter(route.room)}`,
          round.roomSizes[route.room - 1],
          route.bands,
        );
        if (!built.ok) return built;
        roomDestinations[route.room - 1] = built.value;
      }
      for (let room = 1; room <= roomCount; room += 1) {
        if (!seenRooms.has(room)) roomDestinations[room - 1] = allEliminated(round.roomSizes[room - 1]);
      }
    }
    for (const destinations of roomDestinations) {
      for (const destinationLabel of destinations) {
        const destKey = destinationLabel.toLowerCase();
        if (destKey === ELIMINATED) continue;
        if (!roundByLabel.has(destKey)) {
          return err(undeclaredDestinationMessage(`Round "${round.label}"`, destinationLabel));
        }
        if (destKey === key) {
          return err(
            `Round "${round.label}" routes to itself -- a band's destination must be a different round.`,
          );
        }
      }
    }
    roomBandsByLabel.set(key, roomDestinations);
  }

  // Rule 6 (DAG) + rule 8 (reachability), via Kahn's algorithm. Without a
  // Qual source it also proves, as a byproduct, that there is exactly one
  // round with no incoming routes (the entry round) and that every other
  // round is reachable from it: a second in-degree-0 round would make the
  // initial queue hold more than one label, and a cycle would leave some
  // rounds never reaching in-degree 0. With a Qual source, Qual is the
  // source instead, so every declared round just needs something feeding it.
  const destinationsByLabel = new Map<string, Set<string>>();
  for (const round of roundLines) {
    const key = round.label.toLowerCase();
    const set = new Set<string>();
    for (const destinations of roomBandsByLabel.get(key) ?? []) {
      for (const destinationLabel of destinations) {
        if (destinationLabel.toLowerCase() !== ELIMINATED) set.add(destinationLabel.toLowerCase());
      }
    }
    destinationsByLabel.set(key, set);
  }
  // The BEST lines are checked here, against the rooms' lines read above, and their destinations become edges of
  // the graph, so the order, the columns and "something feeds this round" see them.
  const best = resolveBestLines(graph.bestLines, {
    rounds: roundByLabel,
    roomDestinations: roomBandsByLabel,
    routedInto: destinationsByLabel,
  });
  if (!best.ok) return best;
  addBestEdges(destinationsByLabel, best.value);
  const labels = roundLines.map((round) => round.label.toLowerCase());
  const totalByLabel = new Map(
    roundLines.map((round) => [
      round.label.toLowerCase(),
      round.roomSizes.reduce((sum, size) => sum + size, 0),
    ]),
  );
  const inDegree = new Map<string, number>(labels.map((label) => [label, 0]));
  for (const destinations of destinationsByLabel.values()) {
    for (const destination of destinations) {
      inDegree.set(destination, (inDegree.get(destination) ?? 0) + 1);
    }
  }

  // The Qual source: the Qual line as written, or, for a qualification-table
  // graph without one, the older "everyone entering the bracket goes to the
  // entry round" reading. Only a graph with no Qual source at all has an
  // entry round (entryLabel) to special-case below.
  let qualLabels: string[] | null = null;
  let entryLabel: string | null = null;
  if (kind !== null && graph.qualBands) {
    const built = buildQualDestinations(graph.qualBands, roundByLabel, kind);
    if (!built.ok) return built;
    qualLabels = built.value;
  } else {
    const entry = findEntryLabel(labels, inDegree, roundByLabel);
    if (!entry.ok) return entry;
    if (standingsSource) {
      qualLabels = Array.from({ length: totalByLabel.get(entry.value) as number }, () => entry.value);
    } else {
      entryLabel = entry.value;
    }
  }
  const qualDestinations = new Set(nonEliminatedLabels(qualLabels ?? []));
  for (const destination of qualDestinations) {
    inDegree.set(destination, (inDegree.get(destination) ?? 0) + 1);
  }
  if (qualLabels) {
    const unfed = labels.find((label) => (inDegree.get(label) ?? 0) === 0);
    if (unfed) {
      return err(
        `Round "${roundByLabel.get(unfed)!.label}" has nothing routing into it -- send it a ${SOURCE_RANK[kind ?? 'qual']} or route another round into it.`,
      );
    }
  }

  const winsRounds = winsRoundsOf(roundLines);
  const winsBands = winsBandsOf(graph);
  const winsChecked = checkWinsRounds(
    winsRounds,
    winsBands,
    [...best.value.values()].map((line) => line.destinationKey),
  );
  if (!winsChecked.ok) return winsChecked;

  const fixedPrefixLower = (fixedPrefix ?? []).map((label) => label.toLowerCase());
  if (fixedPrefixLower.length > 0) {
    for (const [index, label] of fixedPrefixLower.entries()) {
      if (!roundByLabel.has(label)) {
        return err(
          `Round "${(fixedPrefix as string[])[index]}" has already been played, but this graph no longer declares it -- a played round's label can't change.`,
        );
      }
    }
    if (entryLabel !== null && fixedPrefixLower[0] !== entryLabel) {
      return err(
        `Round "${(fixedPrefix as string[])[0]}" is supposed to be the entry round (it's played first), but "${roundByLabel.get(entryLabel)!.label}" is the round nothing routes into now -- the entry round can't change.`,
      );
    }
    // A prefix round must depend only on earlier prefix rounds -- never on a
    // round outside the prefix (not yet played) or a prefix round that comes
    // later (also not yet played, from the prefix's own point of view).
    const prefixPosition = new Map(fixedPrefixLower.map((label, index) => [label, index]));
    for (const [source, destinations] of destinationsByLabel) {
      for (const destination of destinations) {
        const destPos = prefixPosition.get(destination);
        if (destPos === undefined) continue;
        const sourceLabel = roundByLabel.get(source)!.label;
        const destLabel = roundByLabel.get(destination)!.label;
        const sourcePos = prefixPosition.get(source);
        if (sourcePos === undefined) {
          return err(
            `Round "${destLabel}" has already been played, but round "${sourceLabel}", which hasn't been played yet, routes into it -- a played round's line-up can't depend on a round that hasn't happened.`,
          );
        }
        if (sourcePos >= destPos) {
          return err(
            `Round "${destLabel}" has already been played, but round "${sourceLabel}" is played after it -- a played round's line-up can't depend on a round played later.`,
          );
        }
      }
    }
  }

  // Standard Kahn, seeded with the fixedPrefix (in that exact order) or just
  // the entry round, then every other round that only the Qual source feeds
  // -- a seed label is dequeued, hence its own out-edges decremented, before
  // anything discovered ready afterward (newly-ready labels are only ever
  // appended to the back of the queue), so every fixedPrefix label is
  // guaranteed genuinely ready by the time it's its turn, given the
  // inbound-source checks above.
  const seed = fixedPrefixLower.length > 0 ? fixedPrefixLower : entryLabel !== null ? [entryLabel] : [];
  const seedSet = new Set(seed);
  const topoOrder: string[] = [];
  const remainingInDegree = new Map(inDegree);
  for (const destination of qualDestinations) {
    remainingInDegree.set(destination, (remainingInDegree.get(destination) ?? 0) - 1);
  }
  const queue = [
    ...seed,
    ...labels.filter((label) => !seedSet.has(label) && remainingInDegree.get(label) === 0),
  ];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    topoOrder.push(current);
    for (const destination of destinationsByLabel.get(current) ?? []) {
      const next = (remainingInDegree.get(destination) ?? 0) - 1;
      remainingInDegree.set(destination, next);
      if (next === 0 && !seedSet.has(destination)) queue.push(destination);
    }
  }
  if (topoOrder.length !== labels.length) {
    const stuck = labels.filter((label) => !topoOrder.includes(label));
    return err(
      `The routing table has a cycle involving: ${stuck.map((label) => roundByLabel.get(label)!.label).join(', ')}.`,
    );
  }

  // Rule 10: a non-Final round must send at least one rank on, so a round
  // whose route was forgotten (every rank eliminated) fails loudly, and a
  // RANKING round (a placement match) sends nobody on. Checked after the
  // feeding, entry and cycle checks, which name the earlier mistake.
  for (const round of roundLines) {
    const rooms = roomBandsByLabel.get(round.label.toLowerCase()) ?? [];
    const sendsNobody =
      !best.value.has(round.label.toLowerCase()) &&
      rooms.every((destinations) => nonEliminatedLabels(destinations).length === 0);
    if (round.isRanking && !sendsNobody) {
      return err(
        `Round "${round.label}" is marked RANKING but routes ranks on -- a ranking match sends nobody on.`,
      );
    }
    if (!round.isFinal && !round.isRanking && sendsNobody) {
      return err(
        `Round "${round.label}" sends nobody on -- route at least one rank to a later round, or make it the Final.`,
      );
    }
  }

  // Rule 7: every round's declared total (except the entry round of a graph
  // with no Qual source) must exactly equal what routes into it, checked
  // graph-wide (not just against one predecessor); Qual ranks count as incoming.
  // (destinationsByLabel is deduplicated per round-pair -- the DAG check
  // above only needed "does an edge exist", not how many ranks use it. The
  // incoming tally below needs the real per-rank count, so it walks
  // roomBandsByLabel directly instead of reusing that deduplicated set.)
  const incomingCountByLabel = new Map<string, number>(labels.map((label) => [label, 0]));
  const incomingLabels = [
    ...[...roomBandsByLabel.values()].flatMap((rooms) => rooms.flatMap(nonEliminatedLabels)),
    ...nonEliminatedLabels(qualLabels ?? []),
  ];
  for (const destKey of incomingLabels) {
    incomingCountByLabel.set(destKey, (incomingCountByLabel.get(destKey) ?? 0) + 1);
  }
  applyBestSeats(incomingCountByLabel, best.value);
  const lineIncomingByLabel = countByLabel(nonEliminatedLabels(qualLabels ?? []));
  for (const round of roundLines) {
    const key = round.label.toLowerCase();
    if (key === entryLabel) continue;
    const total = totalByLabel.get(key) as number;
    const incoming = incomingCountByLabel.get(key) ?? 0;
    const fedOnlyByLine = incoming > 0 && incoming === (lineIncomingByLabel.get(key) ?? 0);
    if (fedOnlyByLine && arrivesShort(round.roomSizes, incoming, roomSize.min)) continue;
    if (incoming !== total) {
      return err(
        `Round "${round.label}" declares ${total} player(s) but its routing bands only send it ${incoming} -- a round's declared size must exactly match what routes into it.`,
      );
    }
  }

  // Rule 9: the real head count must cover what the graph takes in. Without
  // a Qual source the entry round's declared total must match it exactly;
  // with one, the highest routed qualification rank must be reachable.
  if (qualLabels) {
    if (entrantCount !== undefined && qualLabels.length > entrantCount) {
      return err(
        `The graph sends ${SOURCE_RANK[kind ?? 'qual']} ${qualLabels.length} on, but only ${entrantCount} players are registered -- route fewer ranks or wait for more registrations.`,
      );
    }
  } else if (entryLabel !== null) {
    const entryRound = roundByLabel.get(entryLabel) as RawRoundLine;
    const entryTotal = totalByLabel.get(entryLabel) as number;
    if (entrantCount !== undefined && entryTotal !== entrantCount) {
      return err(
        `The starting round "${entryRound.label}" declares ${entryTotal} player(s), but ${entrantCount} are actually entering this bracket phase -- these must match exactly.`,
      );
    }
  }

  // Columns, then the play order: the fixed prefix as given, the other rounds column by column
  // (the routing walk's order within a column) -- still a valid topological order, since a round's column is
  // always later than its feeders'.
  const feeders = topoFeeders(topoOrder, destinationsByLabel);
  const columns = assignWaterfallColumns(
    topoOrder.map((label, index) => ({
      label: (roundByLabel.get(label) as RawRoundLine).label,
      column: (roundByLabel.get(label) as RawRoundLine).column,
      feeders: feeders[index],
    })),
    { fixed: options.fixedColumns, firstOpenColumn: options.firstOpenColumn },
  );
  if (!columns.ok) return columns;
  const columnOf = new Map(topoOrder.map((label, index) => [label, columns.value[index]]));
  const winTargets = resolveWinTargets(winsRounds, winsBands, columnOf);
  if (!winTargets.ok) return winTargets;
  // Array.sort is stable: rounds of one column keep their order in the routing walk (today's order), except
  // that RANKING rounds come first, so the units they send out rank below the column's other eliminations.
  const isRankingRound = (label: string) => (roundByLabel.get(label) as RawRoundLine).isRanking === true;
  const rest = topoOrder
    .slice(fixedPrefixLower.length)
    .sort(
      (first, second) =>
        (columnOf.get(first) as number) - (columnOf.get(second) as number) ||
        Number(isRankingRound(second)) - Number(isRankingRound(first)),
    );
  const playOrder = [...topoOrder.slice(0, fixedPrefixLower.length), ...rest];

  return ok(
    buildOrderedGraph(
      playOrder,
      playOrder.map((label) => columnOf.get(label) as number),
      roundByLabel,
      roomBandsByLabel,
      qualLabels,
      best.value,
      winTargets.value,
    ),
  );
}

/** The ROUNDS lines as `waterfall-wins.ts` reads them. */
function winsRoundsOf(roundLines: RawRoundLine[]): WinsRound[] {
  return roundLines.map((round) => ({
    label: round.label,
    roomSizes: round.roomSizes,
    wins: round.wins === true,
  }));
}

/** Every band of the graph that enters a round, with what `waterfall-wins.ts` checks of it. A band whose ranks can't be read counts none (the rank checks name it). */
function winsBandsOf(graph: RawWaterfallGraph): WinsBand[] {
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
function topoFeeders(topoOrder: string[], destinationsByLabel: Map<string, Set<string>>): number[][] {
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

function buildOrderedGraph(
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
function removeSeatsFromLastRooms(declared: number[], missing: number): number[] {
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
