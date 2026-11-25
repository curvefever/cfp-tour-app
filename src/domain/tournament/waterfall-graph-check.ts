import type { OrderedWaterfallGraph, RoomSize } from './types';
import { addBestEdges, applyBestSeats, resolveBestLines, type ResolvedBest } from './waterfall-best';
import { removeSeatsFromLastRooms } from './waterfall-bracket';
import {
  assignWaterfallColumns,
  buildOrderedGraph,
  topoFeeders,
  winsBandsOf,
  winsRoundsOf,
} from './waterfall-graph-order';
import {
  ELIMINATED,
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
import { checkWinsRounds, resolveWinTargets, type WinsBand, type WinsRound } from './waterfall-wins';

/**
 * The checks of a Custom bracket graph. `validateAndOrderWaterfallGraph` refuses a parsed graph that breaks a rule,
 * with the message of the first check it fails, and otherwise returns the ordered graph (`waterfall-graph-order.ts`).
 * The checks run in the order of the code, which is not the order of the rule numbers in its comments;
 * `waterfall-validator-order.test.ts` pins it.
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

interface CheckOptions {
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
}

/**
 * What the checks start from. Each step below returns the context with what it read added, or the refusal. A step that
 * only checks returns the context it was given. Keys of the maps are round names in lower case.
 */
interface CheckInput {
  graph: RawWaterfallGraph;
  options: CheckOptions;
}

interface CheckedAfterRoomSizes extends CheckInput {
  /** Which line may feed the graph, null when it has no standings source. */
  kind: StandingsSourceKind | null;
  roundByLabel: Map<string, RawRoundLine>;
}

interface CheckedAfterRouteLines extends CheckedAfterRoomSizes {
  routesByLabel: Map<string, RawRouteLine[]>;
}

interface CheckedAfterRoomBands extends CheckedAfterRouteLines {
  /** Per round and room, the destination label of every rank; the Final has none. */
  roomBandsByLabel: Map<string, string[][]>;
}

interface CheckedAfterEdges extends CheckedAfterRoomBands {
  /** The rounds each round routes into, the BEST lines' among them. */
  destinationsByLabel: Map<string, Set<string>>;
  best: Map<string, ResolvedBest>;
  labels: string[];
  totalByLabel: Map<string, number>;
  /** How many rounds route into each round; the next step adds the standings line to it. */
  inDegree: Map<string, number>;
}

interface CheckedAfterStandingsSource extends CheckedAfterEdges {
  /** Per rank of the standings line, its destination label; null without a standings source. */
  qualLabels: string[] | null;
  /** The one round nothing routes into, set only without a standings source. */
  entryLabel: string | null;
  /** The rounds the standings line sends to. */
  qualDestinations: Set<string>;
}

interface CheckedAfterWins extends CheckedAfterStandingsSource {
  winsRounds: WinsRound[];
  winsBands: WinsBand[];
}

interface CheckedAfterFixedPrefix extends CheckedAfterWins {
  /** The played rounds a live edit keeps first, in play order; empty otherwise. */
  fixedPrefixLower: string[];
}

/** The line the graph has against the one the tournament wants, then rule 1. */
function checkSourceLineAndRoomSizes(input: CheckInput): WaterfallParseResult<CheckedAfterRoomSizes> {
  const { graph, options } = input;
  const { roundLines } = graph;
  const { roomSize, standingsSource } = options;
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
  return ok({ ...input, kind, roundByLabel });
}

function checkOneFinal(checked: CheckedAfterRoomSizes): WaterfallParseResult<CheckedAfterRoomSizes> {
  const { roundLines } = checked.graph;

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
  return ok(checked);
}

function groupRouteLines(checked: CheckedAfterRoomSizes): WaterfallParseResult<CheckedAfterRouteLines> {
  const { routeLines } = checked.graph;
  const { roundByLabel } = checked;

  const routesByLabel = new Map<string, RawRouteLine[]>();
  for (const route of routeLines) {
    const key = route.label.toLowerCase();
    if (!roundByLabel.has(key)) {
      return err(undeclaredRoundMessage(route.label));
    }
    routesByLabel.set(key, [...(routesByLabel.get(key) ?? []), route]);
  }
  return ok({ ...checked, routesByLabel });
}

/** Rule 3 for a round of one room, with its bands (rule 4): the destination label of every rank. */
function singleRoomBands(round: RawRoundLine, routes: RawRouteLine[]): WaterfallParseResult<string[][]> {
  const roomDestinations: string[][] = new Array(1);
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
  return ok(roomDestinations);
}

/** Rule 3 for a round of several rooms, with their bands (rule 4): per room, the destination label of every rank. */
function severalRoomBands(round: RawRoundLine, routes: RawRouteLine[]): WaterfallParseResult<string[][]> {
  const roomCount = round.roomSizes.length;
  const roomDestinations: string[][] = new Array(roomCount);
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
  return ok(roomDestinations);
}

/** Rule 5: every destination is a declared round, and not the round itself. */
function checkBandDestinations(
  round: RawRoundLine,
  roomDestinations: string[][],
  roundByLabel: Map<string, RawRoundLine>,
): WaterfallParseResult<null> {
  const key = round.label.toLowerCase();
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
  return ok(null);
}

function readRoomBands(checked: CheckedAfterRouteLines): WaterfallParseResult<CheckedAfterRoomBands> {
  const { roundLines } = checked.graph;
  const { roundByLabel, routesByLabel } = checked;

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
    const rooms =
      round.roomSizes.length === 1 ? singleRoomBands(round, routes) : severalRoomBands(round, routes);
    if (!rooms.ok) return rooms;
    const destinationsChecked = checkBandDestinations(round, rooms.value, roundByLabel);
    if (!destinationsChecked.ok) return destinationsChecked;
    roomBandsByLabel.set(key, rooms.value);
  }
  return ok({ ...checked, roomBandsByLabel });
}

/** The edges between the rounds, the BEST lines' among them, with each round's seats and in-degree. */
function readEdges(checked: CheckedAfterRoomBands): WaterfallParseResult<CheckedAfterEdges> {
  const { graph, roundByLabel, roomBandsByLabel } = checked;
  const { roundLines } = graph;

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
  return ok({ ...checked, destinationsByLabel, best: best.value, labels, totalByLabel, inDegree });
}

/** The Qual or Groups line, or the entry round: what feeds the first rounds. Adds the line's edges to `inDegree`. */
function readStandingsSource(checked: CheckedAfterEdges): WaterfallParseResult<CheckedAfterStandingsSource> {
  const { graph, kind, roundByLabel, labels, totalByLabel, inDegree } = checked;
  const { standingsSource } = checked.options;

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
  return ok({ ...checked, qualLabels, entryLabel, qualDestinations });
}

/** The checks of the WINS rounds (`waterfall-wins.ts`). */
function checkWinsBands(checked: CheckedAfterStandingsSource): WaterfallParseResult<CheckedAfterWins> {
  const { graph, best } = checked;
  const { roundLines } = graph;

  const winsRounds = winsRoundsOf(roundLines);
  const winsBands = winsBandsOf(graph);
  const winsChecked = checkWinsRounds(
    winsRounds,
    winsBands,
    [...best.values()].map((line) => line.destinationKey),
  );
  if (!winsChecked.ok) return winsChecked;
  return ok({ ...checked, winsRounds, winsBands });
}

/** A live edit's played rounds are still declared and depend only on rounds played before them. */
function checkFixedPrefix(checked: CheckedAfterWins): WaterfallParseResult<CheckedAfterFixedPrefix> {
  const { roundByLabel, destinationsByLabel, entryLabel } = checked;
  const { fixedPrefix } = checked.options;

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
  return ok({ ...checked, fixedPrefixLower });
}

export function validateAndOrderWaterfallGraph(
  graph: RawWaterfallGraph,
  options: CheckOptions,
): WaterfallParseResult<OrderedWaterfallGraph> {
  const sized = checkSourceLineAndRoomSizes({ graph, options });
  if (!sized.ok) return sized;
  const withFinal = checkOneFinal(sized.value);
  if (!withFinal.ok) return withFinal;
  const routed = groupRouteLines(withFinal.value);
  if (!routed.ok) return routed;
  const banded = readRoomBands(routed.value);
  if (!banded.ok) return banded;
  const edged = readEdges(banded.value);
  if (!edged.ok) return edged;
  const fed = readStandingsSource(edged.value);
  if (!fed.ok) return fed;
  const winsRead = checkWinsBands(fed.value);
  if (!winsRead.ok) return winsRead;
  const prefixed = checkFixedPrefix(winsRead.value);
  if (!prefixed.ok) return prefixed;
  const { kind, roundByLabel, roomBandsByLabel, destinationsByLabel, best, labels, totalByLabel, inDegree } =
    prefixed.value;
  const { qualLabels, entryLabel, qualDestinations, winsRounds, winsBands, fixedPrefixLower } =
    prefixed.value;
  const { roundLines } = graph;
  const { roomSize, entrantCount } = options;

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
      !best.has(round.label.toLowerCase()) &&
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
  applyBestSeats(incomingCountByLabel, best);
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
      best,
      winTargets.value,
    ),
  );
}
