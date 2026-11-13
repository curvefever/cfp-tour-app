import { ordinal } from '../../lib/ordinal';
import type { TournamentRound, WaterfallBestRoute } from './types';
import type { WaterfallParseResult } from './waterfall-bracket';

/**
 * The BEST line of a Custom bracket round, "R4.BEST: 1 OF 6->R5": the best n of the rooms' k-th places go to a
 * later round, and the rest of that place follow the rooms' own lines. This file reads the line, checks it against
 * the rest of the graph (one small function per refusal), counts the seats it moves, and answers "where does this
 * round send units" for the code that follows routes. It imports only types from `waterfall-bracket.ts`, so the two
 * files do not import each other.
 */

/** A BEST line as written: the round it belongs to, how many go, from which place, and to which round. */
export interface RawBestLine {
  label: string;
  count: number;
  place: number;
  destinationLabel: string;
}

/** A BEST line that passed every check; labels are lower case, `restKey` is where the rooms send the rest of the place. */
export interface ResolvedBest {
  place: number;
  count: number;
  destinationKey: string;
  restKey: string;
}

interface BestRound {
  label: string;
  roomSizes: number[];
  isFinal: boolean;
  isRanking?: true;
}

/** What the checks of a BEST line read from the validator. Labels are lower case. */
export interface BestContext {
  rounds: Map<string, BestRound>;
  /** Per round and room, the destination label of every rank (`eliminated` for a rank no band covers); a Final has none. */
  roomDestinations: Map<string, string[][]>;
  /** Per round, the lower-case labels of the rounds it routes into so far. */
  routedInto: Map<string, Set<string>>;
}

const ELIMINATED = 'eliminated';
const BEST_FORMAT = '<round>.BEST: <n> OF <place>-><destination>';
const BEST_ADDRESS = /^(.*?)\s*\.\s*BEST$/i;
const BEST_BODY = /^(\d+)\s+OF\s+(\d+)\s*->\s*(.*)$/i;
/** The labels of the pooling lines; they are not rounds, so a BEST line on one gets a message of its own. */
const SOURCE_LINES: Record<string, string> = {
  qual: '"Qual" can\'t have a BEST line -- the qualification table is one ranked list: route the rank itself.',
  groups:
    '"Groups" can\'t have a BEST line -- the group stage\'s exit is one ranked list: route the rank itself.',
};

function refuse<T>(error: string): WaterfallParseResult<T> {
  return { ok: false, error };
}

function cleanLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
}

/** Reads a ROUTES line that is a BEST line; null when the line is any other kind of route line. */
export function parseBestLine(line: string): WaterfallParseResult<RawBestLine> | null {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) return null;
  const address = BEST_ADDRESS.exec(line.slice(0, colonIndex).trim());
  if (!address) return null;
  const body = BEST_BODY.exec(line.slice(colonIndex + 1).trim());
  const destinationLabel = body ? cleanLabel(body[3]) : '';
  if (!body || !destinationLabel) {
    return refuse(`ROUTES line "${line}" is not a best-of-a-place route -- expected "${BEST_FORMAT}".`);
  }
  const value = {
    label: cleanLabel(address[1]),
    count: Number.parseInt(body[1], 10),
    place: Number.parseInt(body[2], 10),
    destinationLabel,
  };
  return { ok: true, value };
}

type BestCheck = (line: RawBestLine, lines: RawBestLine[], context: BestContext) => string | null;

const sameRound = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();

/** The round a line belongs to; the checks after `undeclaredRound` can rely on it. */
function roundOf(line: RawBestLine, context: BestContext): BestRound {
  return context.rounds.get(line.label.toLowerCase()) as BestRound;
}

function undeclaredSource(line: RawBestLine): string | null {
  return SOURCE_LINES[line.label.toLowerCase()] ?? null;
}

function undeclaredRound(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  return context.rounds.has(line.label.toLowerCase())
    ? null
    : `BEST line references round "${line.label}", which isn't declared in ROUNDS.`;
}

function repeatedLine(line: RawBestLine, lines: RawBestLine[], context: BestContext): string | null {
  if (lines.filter((other) => sameRound(other.label, line.label)).length < 2) return null;
  return `Round "${roundOf(line, context).label}" has more than one BEST line -- a round sends the best of one place only.`;
}

function finalOrRanking(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  const round = roundOf(line, context);
  if (round.isFinal) {
    return `Round "${round.label}" has a BEST line but is the Final -- nothing routes out of the Final.`;
  }
  return round.isRanking
    ? `Round "${round.label}" has a BEST line but is marked RANKING -- a ranking match sends nobody on.`
    : null;
}

/** Whether `target` can be reached from `from` by following the routes already in the graph. */
function reaches(from: string, target: string, routedInto: BestContext['routedInto']): boolean {
  const seen = new Set<string>();
  const pending = [from];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...(routedInto.get(current) ?? []));
  }
  return false;
}

function badDestination(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  const round = roundOf(line, context);
  const target = line.destinationLabel.toLowerCase();
  const sends = `Round "${round.label}" sends the best ${ordinal(line.place)} to "${line.destinationLabel}"`;
  if (target === ELIMINATED) return `${sends} -- the best of a place must go on to a round.`;
  if (!context.rounds.has(target)) return `${sends}, which isn't declared in ROUNDS.`;
  const source = line.label.toLowerCase();
  if (target !== source && !reaches(target, source, context.routedInto)) return null;
  return `${sends}, which is ${round.label} itself or comes before it in the graph -- it must be a round that doesn't lead back to ${round.label}.`;
}

function placeOutsideRooms(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  const round = roundOf(line, context);
  const largest = Math.max(...round.roomSizes);
  if (line.place >= 1 && line.place <= largest) return null;
  return `Round "${round.label}" names place ${line.place} in its BEST line, but its rooms only have places 1-${largest}.`;
}

/** The destination labels of place `place` in every room that has one. */
function destinationsOfPlace(line: RawBestLine, context: BestContext): string[] {
  const rooms = context.roomDestinations.get(line.label.toLowerCase()) ?? [];
  return rooms.filter((room) => room.length >= line.place).map((room) => room[line.place - 1].toLowerCase());
}

function countOutOfRange(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  const round = roundOf(line, context);
  const rooms = destinationsOfPlace(line, context).length;
  const place = ordinal(line.place);
  if (line.count < 1) {
    return `Round "${round.label}" asks for the best ${line.count} of the ${place} places -- ask for at least 1.`;
  }
  if (line.count < rooms) return null;
  const destination = context.rounds.get(line.destinationLabel.toLowerCase())?.label ?? line.destinationLabel;
  return `Round "${round.label}" asks for the best ${line.count} of the ${place} places, but only ${rooms} room(s) have one -- to send them all, route place ${line.place} of every room to ${destination} instead.`;
}

function restSplit(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  if (new Set(destinationsOfPlace(line, context)).size < 2) return null;
  const round = roundOf(line, context);
  const destination = context.rounds.get(line.destinationLabel.toLowerCase())?.label ?? line.destinationLabel;
  return `Round "${round.label}" sends the best ${ordinal(line.place)} to ${destination}, but its rooms do not all route the ${ordinal(line.place)} place to the same destination -- the others must all go one way, to one round or out.`;
}

function restToSameRound(line: RawBestLine, _lines: RawBestLine[], context: BestContext): string | null {
  if (destinationsOfPlace(line, context)[0] !== line.destinationLabel.toLowerCase()) return null;
  const round = roundOf(line, context);
  const destination = context.rounds.get(line.destinationLabel.toLowerCase())?.label ?? line.destinationLabel;
  return `Round "${round.label}" sends the best ${ordinal(line.place)} to ${destination} and routes the other ${ordinal(line.place)} places there too -- nothing to choose.`;
}

/** The refusals of a BEST line, in the order they are made. */
const BEST_CHECKS: BestCheck[] = [
  undeclaredSource,
  undeclaredRound,
  repeatedLine,
  finalOrRanking,
  badDestination,
  placeOutsideRooms,
  countOutOfRange,
  restSplit,
  restToSameRound,
];

/**
 * Checks every BEST line against the graph read so far. Returns the lines keyed by their round (lower case) with
 * the destination and the rest resolved, or the first refusal, which names the round.
 */
export function resolveBestLines(
  lines: RawBestLine[],
  context: BestContext,
): WaterfallParseResult<Map<string, ResolvedBest>> {
  const resolved = new Map<string, ResolvedBest>();
  for (const line of lines) {
    for (const check of BEST_CHECKS) {
      const message = check(line, lines, context);
      if (message) return refuse(message);
    }
    resolved.set(line.label.toLowerCase(), {
      place: line.place,
      count: line.count,
      destinationKey: line.destinationLabel.toLowerCase(),
      restKey: destinationsOfPlace(line, context)[0],
    });
  }
  return { ok: true, value: resolved };
}

/** Makes the BEST destinations edges of the graph, so ordering, columns and "something feeds this round" see them. */
export function addBestEdges(routedInto: BestContext['routedInto'], best: Map<string, ResolvedBest>): void {
  for (const [key, line] of best) routedInto.get(key)?.add(line.destinationKey);
}

/**
 * Corrects a tally of the seats routes send to each round (lower-case label): the chosen round receives `count`
 * from the BEST round, and the round the rest go to receives that many fewer than its rooms' lines name.
 */
export function applyBestSeats(incoming: Map<string, number>, best: Map<string, ResolvedBest>): void {
  for (const line of best.values()) {
    incoming.set(line.destinationKey, (incoming.get(line.destinationKey) ?? 0) + line.count);
    if (line.restKey !== ELIMINATED) {
      incoming.set(line.restKey, (incoming.get(line.restKey) ?? 0) - line.count);
    }
  }
}

/** The BEST lines in the order of the ordered graph's rounds, the destination as an index into them. */
export function orderedBest(
  labels: string[],
  indexByLabel: Map<string, number>,
  best: Map<string, ResolvedBest>,
): Array<WaterfallBestRoute | null> {
  return labels.map((label) => {
    const line = best.get(label);
    if (!line) return null;
    return {
      place: line.place,
      count: line.count,
      destination: indexByLabel.get(line.destinationKey) as number,
    };
  });
}

/** The line of the ordered graph as it sits on a round, the destination as an absolute round index. */
export function absoluteBest(best: WaterfallBestRoute | null | undefined, startRoundNum: number) {
  return best ? { ...best, destination: startRoundNum - 1 + best.destination } : undefined;
}

type RoomRoutes = ReadonlyArray<ReadonlyArray<number | 'eliminated'>>;

/**
 * What the BEST route moves in a round drawn at `rooms`: the units chosen (at most `count`, and no more than
 * the rooms that have the place) and where the rest of the place goes (`'eliminated'` when no room has it).
 */
export function bestMoves(
  best: WaterfallBestRoute,
  routes: RoomRoutes,
  rooms: number[],
): { chosen: number; rest: number | 'eliminated' } {
  const candidates = rooms.flatMap((size, room) =>
    size >= best.place ? [routes[room]?.[best.place - 1]] : [],
  );
  const rest = candidates[0];
  return {
    chosen: Math.min(best.count, candidates.length),
    rest: typeof rest === 'number' ? rest : 'eliminated',
  };
}

/** The units the BEST route sends on although the rooms' lines send their place out. */
export function bestUnitsFromOut(
  best: WaterfallBestRoute | undefined,
  routes: RoomRoutes,
  rooms: number[],
): number {
  if (!best) return 0;
  const { chosen, rest } = bestMoves(best, routes, rooms);
  return rest === 'eliminated' ? chosen : 0;
}

/** Every round index the BEST lines of an ordered graph send to. */
export function bestDestinations(best: ReadonlyArray<WaterfallBestRoute | null> | undefined): number[] {
  return (best ?? []).flatMap((line) => (line ? [line.destination] : []));
}

/** Every round a waterfall round sends units to: its rooms' routes and its BEST destination, each once. */
export function roundDestinations(
  round: Pick<TournamentRound, 'waterfallRoutes' | 'waterfallBest'>,
): number[] {
  const destinations = new Set<number>();
  for (const route of round.waterfallRoutes?.flat() ?? []) {
    if (route !== 'eliminated') destinations.add(route);
  }
  if (round.waterfallBest) destinations.add(round.waterfallBest.destination);
  return [...destinations];
}
