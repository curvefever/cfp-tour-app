import type { RoomSize, TournamentRound } from './types';

/**
 * Waterfall / rank-band bracket phase (ROADMAP.md items 7+8, merged after
 * re-reading the real organiser spreadsheet that inspired both -- see
 * HANDOFF_LOG.md). Entirely organiser-authored and decided once at
 * generation time: a plain-text mini-language describes a round graph where
 * a room's finishers split BY RANK into bands, each band routing to its own
 * destination round (not necessarily the very next one -- a band can point
 * several rounds ahead), with multiple source rooms' bands able to converge
 * on the same destination. This file is the parser/validator only -- it has
 * no TournamentState/TournamentRound dependency, so it's testable in
 * isolation before anything about how the graph gets materialized into a
 * real schedule is decided (see the bracket-phase builder, added
 * separately).
 *
 * Grammar (one textarea, two sections):
 *
 *   ROUNDS:
 *   5 = 4x8
 *   6B = 8
 *   Final = 8 FINAL
 *
 *   ROUTES:
 *   5.A: 1-4->SemiA, 5,8->6B, 6,7->6C
 *   6B: 1-4->7A, 5-8->eliminated
 *
 * A round declared "N x size" has N rooms and needs a ".<letter>" suffix
 * when addressed in ROUTES (one line per room); a round declared as a bare
 * total has exactly 1 room and is addressed bare. Exactly one round is
 * marked FINAL (an explicit keyword, not inferred from "has no outgoing
 * line", so a round the organiser forgot to route out of fails loudly
 * instead of silently becoming the de facto Final). Every other declared
 * round needs exactly one outgoing line per room. A band's rank list is a
 * comma-separated mix of single ranks ("5,8") and ranges ("1-4"); every
 * room's bands must partition 1..roomSize exactly, with no gaps or overlaps.
 *
 * After a qualification table, a reserved "Qual" line routes the final
 * standings the same way, by rank ("Qual: 1-16->R1, 17-24->R1C"). It has no
 * room letter, may leave ranks unrouted (they are eliminated), and is only
 * valid for a qualification-table pooling phase (`standingsSource`).
 */

export interface WaterfallRoundSpec {
  label: string;
  roomSizes: number[];
  isFinal: boolean;
}

/**
 * The fully validated, topologically-sorted graph -- `rounds[0]` is always
 * the entry round (the one with no incoming bands), and every band's
 * destination has already been resolved to an index into `rounds`/`routes`
 * (or the literal 'eliminated'). `routes[i][room]` is index-aligned with
 * `rounds[i].roomSizes` and, within a room, index-aligned with rank (i.e.
 * `routes[i][room][rank - 1]` is that rank's destination) -- a flat
 * per-rank array rather than a list of {fromRank,toRank} ranges, since a
 * real band is often non-contiguous ("ranks 5 and 8 both go to 6B") and a
 * per-rank array sidesteps range-splitting entirely, both for this
 * validator's own partition check and for a later O(1) rank lookup.
 */
export interface OrderedWaterfallGraph {
  rounds: WaterfallRoundSpec[];
  routes: Array<Array<Array<number | 'eliminated'>>>;
  /**
   * Where the qualification table's standings go, when the graph has a Qual
   * source: index = standings rank - 1, value = index into `rounds` or
   * 'eliminated'. Its length is the highest routed rank (anything past the
   * end is eliminated).
   */
  qualRoutes?: Array<number | 'eliminated'>;
}

export type WaterfallParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

interface RawRoundLine {
  label: string;
  roomSizes: number[];
  isFinal: boolean;
}

interface RawRouteBand {
  rankTokens: string[];
  destinationLabel: string;
}

interface RawRouteLine {
  label: string;
  /** null = bare address (the round's one room); otherwise a 1-indexed room number parsed from ".A"/".B"/... */
  room: number | null;
  bands: RawRouteBand[];
}

export interface RawWaterfallGraph {
  roundLines: RawRoundLine[];
  routeLines: RawRouteLine[];
  /** The bands of the "Qual" route line (the qualification table as a source), null when the text has none. */
  qualBands: RawRouteBand[] | null;
}

export const LABEL_PATTERN = /^[A-Za-z0-9]+$/;
export const ELIMINATED = 'eliminated';
/** The reserved route-line label for the qualification table; never a declared round. */
export const QUAL_LABEL = 'Qual';
/** Rooms are addressed by a single letter in ROUTES, so a round can have at most 26. */
export const MAX_ROOMS_PER_ROUND = 26;

function ok<T>(value: T): WaterfallParseResult<T> {
  return { ok: true, value };
}
function err<T>(error: string): WaterfallParseResult<T> {
  return { ok: false, error };
}

function letterToRoomIndex(letter: string): number | null {
  if (!/^[A-Za-z]$/.test(letter)) return null;
  return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0) + 1;
}

export function roomIndexToLetter(room: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + room - 1);
}

export interface WaterfallParseOptions {
  /** Accept a graph that has no rounds or no route lines yet (the editor's in-progress draft), instead of rejecting it. */
  allowIncomplete?: boolean;
}

function splitSections(
  text: string,
  options: WaterfallParseOptions,
): WaterfallParseResult<{ roundsLines: string[]; routesLines: string[] }> {
  const lines = text.split(/\r?\n/);
  let section: 'none' | 'rounds' | 'routes' = 'none';
  const roundsLines: string[] = [];
  const routesLines: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'ROUNDS:') {
      section = 'rounds';
      continue;
    }
    if (upper === 'ROUTES:') {
      section = 'routes';
      continue;
    }
    if (section === 'rounds') roundsLines.push(line);
    else if (section === 'routes') routesLines.push(line);
    else return err(`Line "${line}" appears before a ROUNDS: or ROUTES: section header.`);
  }
  if (!options.allowIncomplete) {
    if (roundsLines.length === 0) {
      return err('No ROUNDS: section found, or it has no round declarations.');
    }
    if (routesLines.length === 0) {
      return err('No ROUTES: section found, or it has no routing rules.');
    }
  }
  return ok({ roundsLines, routesLines });
}

function parseRoundLine(line: string): WaterfallParseResult<RawRoundLine> {
  const eqIndex = line.indexOf('=');
  if (eqIndex === -1) {
    return err(
      `ROUNDS line "${line}" is missing "=" -- expected "<label> = <size>" or "<label> = <N>x<size>".`,
    );
  }
  const label = line.slice(0, eqIndex).trim();
  if (!LABEL_PATTERN.test(label)) {
    return err(
      `Round label "${label}" is invalid -- labels must be letters/digits only, no spaces or punctuation.`,
    );
  }
  if (label.toLowerCase() === ELIMINATED) {
    return err(`Round label "${label}" is reserved -- "eliminated" can't be used as a round label.`);
  }
  if (label.toLowerCase() === QUAL_LABEL.toLowerCase()) {
    return err(
      `Round label "${label}" is reserved -- "Qual" stands for the qualification table and can't be used as a round label.`,
    );
  }

  const rest = line.slice(eqIndex + 1).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return err(`ROUNDS line for "${label}" has no size after "=".`);
  }

  const sizeSpec = tokens[0];
  let roomSizes: number[];
  const nxMatch = sizeSpec.match(/^(\d+)x(\d+)$/i);
  if (nxMatch) {
    const roomCount = Number.parseInt(nxMatch[1], 10);
    const roomSize = Number.parseInt(nxMatch[2], 10);
    if (roomCount < 1 || roomSize < 1) {
      return err(
        `ROUNDS line for "${label}" has an invalid room count/size ("${sizeSpec}") -- both must be positive.`,
      );
    }
    roomSizes = Array.from({ length: roomCount }, () => roomSize);
  } else if (/^\d+$/.test(sizeSpec)) {
    const total = Number.parseInt(sizeSpec, 10);
    if (total < 1) {
      return err(
        `ROUNDS line for "${label}" has an invalid size ("${sizeSpec}") -- must be a positive whole number.`,
      );
    }
    roomSizes = [total];
  } else {
    return err(
      `ROUNDS line for "${label}" has an unrecognized size ("${sizeSpec}") -- expected a whole number or "<rooms>x<size>" (e.g. "4x8").`,
    );
  }

  const remaining = tokens.slice(1);
  let isFinal = false;
  if (remaining.length === 1 && remaining[0].toUpperCase() === 'FINAL') {
    isFinal = true;
  } else if (remaining.length > 0) {
    return err(
      `ROUNDS line for "${label}" has an unexpected trailing token ("${remaining.join(' ')}") -- only "FINAL" is allowed after the size.`,
    );
  }

  return ok({ label, roomSizes, isFinal });
}

function parseRouteLine(line: string): WaterfallParseResult<RawRouteLine> {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return err(`ROUTES line "${line}" is missing ":" -- expected "<round>: <ranks>-><destination>, ...".`);
  }
  const address = line.slice(0, colonIndex).trim();
  const dotIndex = address.indexOf('.');
  let label: string;
  let room: number | null;
  if (dotIndex === -1) {
    label = address;
    room = null;
  } else {
    label = address.slice(0, dotIndex);
    const letter = address.slice(dotIndex + 1);
    const parsedRoom = letterToRoomIndex(letter);
    if (parsedRoom === null) {
      return err(
        `ROUTES line "${line}" has an invalid room letter ("${letter}") -- expected a single letter like "A".`,
      );
    }
    room = parsedRoom;
  }
  if (!LABEL_PATTERN.test(label)) {
    return err(`ROUTES line "${line}" references an invalid round label ("${label}").`);
  }

  const rest = line.slice(colonIndex + 1).trim();
  if (!rest) {
    return err(`ROUTES line for "${address}" has no bands after ":".`);
  }
  const rawTokens = rest.split(',').map((token) => token.trim());
  const bands: RawRouteBand[] = [];
  let pending: string[] = [];
  for (const token of rawTokens) {
    if (!token) {
      return err(`ROUTES line for "${address}" has an empty entry (check for a stray comma).`);
    }
    const arrowIndex = token.indexOf('->');
    if (arrowIndex === -1) {
      pending.push(token);
      continue;
    }
    const rankPart = token.slice(0, arrowIndex).trim();
    const destPart = token.slice(arrowIndex + 2).trim();
    if (!rankPart) {
      return err(`ROUTES line for "${address}" has a band with no rank before "->".`);
    }
    if (!destPart) {
      return err(`ROUTES line for "${address}" has a band with no destination after "->".`);
    }
    pending.push(rankPart);
    bands.push({ rankTokens: [...pending], destinationLabel: destPart });
    pending = [];
  }
  if (pending.length > 0) {
    return err(
      `ROUTES line for "${address}" ends without a destination -- every rank must eventually be followed by "-><round>".`,
    );
  }

  return ok({ label, room, bands });
}

export function parseWaterfallGraph(
  text: string,
  options: WaterfallParseOptions = {},
): WaterfallParseResult<RawWaterfallGraph> {
  const sections = splitSections(text, options);
  if (!sections.ok) return sections;
  const { roundsLines, routesLines } = sections.value;

  const roundLines: RawRoundLine[] = [];
  const seenLabels = new Set<string>();
  for (const line of roundsLines) {
    const result = parseRoundLine(line);
    if (!result.ok) return result;
    const key = result.value.label.toLowerCase();
    if (seenLabels.has(key)) {
      return err(`Duplicate round label "${result.value.label}" in ROUNDS.`);
    }
    seenLabels.add(key);
    roundLines.push(result.value);
  }

  const routeLines: RawRouteLine[] = [];
  let qualBands: RawRouteBand[] | null = null;
  for (const line of routesLines) {
    const result = parseRouteLine(line);
    if (!result.ok) return result;
    if (result.value.label.toLowerCase() !== QUAL_LABEL.toLowerCase()) {
      routeLines.push(result.value);
      continue;
    }
    if (result.value.room !== null) {
      return err(
        `ROUTES line "${line}" gives "Qual" a room letter -- the qualification table has no rooms, write "Qual: ..." instead.`,
      );
    }
    if (qualBands) return err('The Qual line appears more than once -- combine them into one.');
    qualBands = result.value.bands;
  }

  return ok({ roundLines, routeLines, qualBands });
}

export function expandRankTokens(tokens: string[]): WaterfallParseResult<number[]> {
  const ranks: number[] = [];
  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const from = Number.parseInt(rangeMatch[1], 10);
      const to = Number.parseInt(rangeMatch[2], 10);
      if (from > to) return err(`Rank range "${token}" is backwards -- expected "<low>-<high>".`);
      for (let rank = from; rank <= to; rank += 1) ranks.push(rank);
      continue;
    }
    if (/^\d+$/.test(token)) {
      ranks.push(Number.parseInt(token, 10));
      continue;
    }
    return err(`"${token}" isn't a valid rank or rank range (expected a whole number or "<low>-<high>").`);
  }
  return ok(ranks);
}

/** Builds one room's per-rank destination-label array from its route line's bands, enforcing the exact-partition rule (every rank 1..roomSize covered exactly once). */
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
  const missing: number[] = [];
  destinations.forEach((destination, index) => {
    if (destination === undefined) missing.push(index + 1);
  });
  if (missing.length > 0) {
    return err(
      `${roomDisplayName}: rank(s) ${missing.join(', ')} have no destination -- every rank from 1 to ${roomSize} must be covered.`,
    );
  }
  return ok(destinations as string[]);
}

/**
 * The per-rank destination labels of the Qual line: ranks the line doesn't
 * route are eliminated (gaps allowed), and trailing eliminated ranks are
 * trimmed so the array's length is the highest routed rank.
 */
function buildQualDestinations(
  bands: RawRouteBand[],
  roundByLabel: Map<string, RawRoundLine>,
): WaterfallParseResult<string[]> {
  const destinations: Array<string | undefined> = [];
  for (const band of bands) {
    const expanded = expandRankTokens(band.rankTokens);
    if (!expanded.ok) return err(`Qual: ${expanded.error}`);
    const destKey = band.destinationLabel.toLowerCase();
    if (destKey !== ELIMINATED && !roundByLabel.has(destKey)) {
      return err(`Qual routes to "${band.destinationLabel}", which isn't declared in ROUNDS.`);
    }
    for (const rank of expanded.value) {
      if (rank < 1) return err(`Qual: rank ${rank} is out of range -- qualification ranks start at 1.`);
      if (destinations[rank - 1] !== undefined) {
        return err(`Qual: rank ${rank} is routed more than once -- bands must not overlap.`);
      }
      destinations[rank - 1] = band.destinationLabel;
    }
  }
  let length = destinations.length;
  while (length > 0 && (destinations[length - 1] ?? ELIMINATED).toLowerCase() === ELIMINATED) length -= 1;
  if (length === 0) {
    return err('The Qual line sends no qualification rank on -- route at least one rank to a round.');
  }
  return ok(Array.from({ length }, (_, index) => destinations[index] ?? ELIMINATED));
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

function nonEliminatedLabels(destinations: string[]): string[] {
  return destinations.map((label) => label.toLowerCase()).filter((label) => label !== ELIMINATED);
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
     * True when the graph is fed by a qualification table: the Qual line is allowed (a graph without
     * one is read as `Qual: 1-<entry round total> -> <entry round>`), and every declared round
     * must be fed by Qual or another round. False: a Qual line is an error.
     */
    standingsSource?: boolean;
    /**
     * Round labels, in play order, that the returned order must start with
     * exactly (a live edit's already-reached rounds, which can't be
     * reordered). Without it, the play order is derived purely from the
     * routing, as normal.
     */
    fixedPrefix?: string[];
  },
): WaterfallParseResult<OrderedWaterfallGraph> {
  const { roundLines, routeLines } = graph;
  const { roomSize, entrantCount, fixedPrefix, standingsSource } = options;

  if (!standingsSource && graph.qualBands) {
    return err(
      'The Qual line routes the qualification table, but this tournament has no qualification table -- remove the Qual line.',
    );
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
      return err(`ROUTES references round "${route.label}", which isn't declared in ROUNDS.`);
    }
    routesByLabel.set(key, [...(routesByLabel.get(key) ?? []), route]);
  }

  // Rule 3 + partition (rule 4) + destination existence/self-loop (rule 5):
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
      if (routes.length === 0) {
        return err(`Round "${round.label}" has no ROUTES line -- every non-Final round needs exactly one.`);
      }
      if (routes.length > 1) {
        return err(
          `Round "${round.label}" has more than one ROUTES line -- it has only 1 room, combine them into one.`,
        );
      }
      if (routes[0].room !== null) {
        return err(
          `Round "${round.label}" has only 1 room -- address it as "${round.label}", not "${round.label}.${roomIndexToLetter(routes[0].room)}".`,
        );
      }
      const built = buildRoomDestinations(round.label, round.roomSizes[0], routes[0].bands);
      if (!built.ok) return built;
      roomDestinations[0] = built.value;
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
        if (!seenRooms.has(room)) {
          return err(
            `Round "${round.label}.${roomIndexToLetter(room)}" has no ROUTES line -- every room needs exactly one.`,
          );
        }
      }
    }
    for (const destinations of roomDestinations) {
      for (const destinationLabel of destinations) {
        const destKey = destinationLabel.toLowerCase();
        if (destKey === ELIMINATED) continue;
        if (!roundByLabel.has(destKey)) {
          return err(
            `Round "${round.label}" routes to "${destinationLabel}", which isn't declared in ROUNDS.`,
          );
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
  if (standingsSource && graph.qualBands) {
    const built = buildQualDestinations(graph.qualBands, roundByLabel);
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
        `Round "${roundByLabel.get(unfed)!.label}" has nothing routing into it -- send it a qualification rank or route another round into it.`,
      );
    }
  }

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
  for (const round of roundLines) {
    const key = round.label.toLowerCase();
    if (key === entryLabel) continue;
    const total = totalByLabel.get(key) as number;
    const incoming = incomingCountByLabel.get(key) ?? 0;
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
        `The graph sends qualification rank ${qualLabels.length} on, but only ${entrantCount} players are registered -- route fewer ranks or wait for more registrations.`,
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

  return ok(buildOrderedGraph(topoOrder, roundByLabel, roomBandsByLabel, qualLabels));
}

function buildOrderedGraph(
  topoOrder: string[],
  roundByLabel: Map<string, RawRoundLine>,
  roomBandsByLabel: Map<string, string[][]>,
  qualLabels: string[] | null,
): OrderedWaterfallGraph {
  const indexByLabel = new Map(topoOrder.map((label, index) => [label, index]));
  const rounds: WaterfallRoundSpec[] = topoOrder.map((label) => {
    const round = roundByLabel.get(label) as RawRoundLine;
    return { label: round.label, roomSizes: round.roomSizes, isFinal: round.isFinal };
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

  return { rounds, routes, ...(qualRoutes ? { qualRoutes } : {}) };
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

export interface WaterfallBracketConfig {
  graph: OrderedWaterfallGraph;
  finalsGames: number;
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

  return graph.rounds.map((roundSpec, index): TournamentRound => {
    const players = roundSpec.roomSizes.reduce((sum, size) => sum + size, 0);
    const routesForRound = graph.routes[index] ?? [];
    const eliminatedCount = routesForRound.reduce(
      (sum, roomDestinations) =>
        sum + roomDestinations.filter((destination) => destination === 'eliminated').length,
      0,
    );
    return {
      roundNum: startRoundNum + index,
      players,
      rooms: roundSpec.roomSizes,
      byeCount: 0,
      isQual: false,
      isNoElim: false,
      isSemis: false,
      isFinal: roundSpec.isFinal,
      advPerRoom: null,
      advTotal: roundSpec.isFinal ? 1 : players - eliminatedCount,
      luckyCount: 0,
      ...(roundSpec.isFinal ? { numGames: config.finalsGames } : {}),
      isWaterfall: true,
      customLabel: roundSpec.label,
      waterfallRoutes: routesForRound.map((roomDestinations) =>
        roomDestinations.map((destination) =>
          destination === 'eliminated' ? 'eliminated' : startRoundNum - 1 + destination,
        ),
      ),
    };
  });
}
