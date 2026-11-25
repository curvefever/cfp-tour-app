import { BEST_OF_VALUES, MAX_SUMMED_GAMES, matchFormatToken, type MatchFormat } from './match-format';
import { parseBestLine, type RawBestLine } from './waterfall-best';
import type { WaterfallParseResult } from './waterfall-parse-result';
import { splitWinsSuffix } from './waterfall-wins';

/**
 * Waterfall / rank-band bracket phase (the Custom bracket). Entirely
 * organiser-authored and decided once at generation time: a plain-text
 * mini-language describes a round graph where a room's finishers split BY
 * RANK into bands, each band routing to its own destination round (not
 * necessarily the very next one -- a band can point several rounds ahead),
 * with multiple source rooms' bands able to converge on the same destination.
 *
 * This file holds the text grammar and its parser (`parseWaterfallGraph`), with the labels, the "undeclared round"
 * messages and the raw shape the parser reads.
 *
 * Grammar (one textarea, two sections):
 *
 *   ROUNDS:
 *   5 = 4x8
 *   6B = 8
 *   Final = 8 FINAL
 *
 * After the size a ROUNDS line takes, in any order and each at most once, FINAL, RANKING, COLUMN <n>, and one
 * match format: BO<n> (best of n, odd from 3 to 9), GAMES <n> (n games summed, 1 to 4) or WINS (a round of one room
 * of two whose units each need their own number of game wins, `waterfall-wins.ts`).
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
 * round has at most one outgoing line per room. A band's rank list is a
 * comma-separated mix of single ranks ("5,8") and ranges ("1-4"); a room's
 * bands must not overlap, and any rank no band routes (or a room with no line
 * at all) is eliminated, the same as on the Qual line. A non-Final round must
 * still send at least one rank on, so a forgotten route fails loudly, unless it
 * is marked RANKING: a placement match whose units all go out, ranked below the
 * other rounds of its column.
 *
 * After a qualification table, a reserved "Qual" line routes the final
 * standings the same way, by rank ("Qual: 1-16->R1, 17-24->R1C"). It has no
 * room letter, may leave ranks unrouted (they are eliminated), and is only
 * valid for a qualification-table pooling phase (`standingsSource`). After a
 * group stage the reserved "Groups" line does the same for the group exit
 * order ("Groups: 1-4->R1, 5-8->R1C"); each line is refused under the other
 * pooling phase.
 *
 * One more line per round may pick the best of one place, "5.BEST: 1 OF 6->SemiA": the best n of the rooms' k-th
 * places go to that later round and the rest of the place follow the rooms' own lines (`waterfall-best.ts`).
 */

export interface RawRoundLine {
  label: string;
  roomSizes: number[];
  isFinal: boolean;
  /** "RANKING": a placement match, every rank goes out. */
  isRanking?: true;
  /** The organiser's own column number ("COLUMN 2"), null when the round's column is automatic. */
  column: number | null;
  /** "BO3": the round is a best of n (odd, 3-9). At most one of `bestOf` and `games` is set. */
  bestOf?: number;
  /** "GAMES 2": the round plays n games, summed (1-4). */
  games?: number;
  /** "WINS": the round's two units each need their own number of game wins. */
  wins?: true;
}

export interface RawRouteBand {
  rankTokens: string[];
  destinationLabel: string;
  /** The "WINS <n>" typed after the destination: the wins the unit arriving by this band needs. */
  wins?: number;
}

export interface RawRouteLine {
  label: string;
  /** null = bare address (the round's one room); otherwise a 1-indexed room number parsed from ".A"/".B"/... */
  room: number | null;
  bands: RawRouteBand[];
}

export interface RawWaterfallGraph {
  roundLines: RawRoundLine[];
  routeLines: RawRouteLine[];
  /** The BEST lines ("R4.BEST: 1 OF 6->R5"), in the order written. */
  bestLines: RawBestLine[];
  /** The bands of the "Qual" or "Groups" route line (the pooling exit as a source), null when the text has none. */
  qualBands: RawRouteBand[] | null;
  /** Which of the two lines `qualBands` came from, null when the text has none. */
  standingsKind: StandingsSourceKind | null;
}

/** A round name: letters and digits, with single spaces or dashes between words; it starts and ends with a letter or digit. */
export const LABEL_PATTERN = /^[A-Za-z0-9]+(?:[ -]+[A-Za-z0-9]+)*$/;
export const ELIMINATED = 'eliminated';
/** The reserved route-line label for the qualification table; never a declared round. */
export const QUAL_LABEL = 'Qual';
/** The reserved route-line label for the group stage's exit order; never a declared round. */
export const GROUPS_LABEL = 'Groups';

/** What feeds the graph from the pooling phase: the qualification table (the Qual line) or the group exit (the Groups line). */
export type StandingsSourceKind = 'qual' | 'groups';

export const SOURCE_LINE: Record<StandingsSourceKind, string> = { qual: QUAL_LABEL, groups: GROUPS_LABEL };

function sourceKindOfLabel(label: string): StandingsSourceKind | null {
  const lower = label.toLowerCase();
  if (lower === QUAL_LABEL.toLowerCase()) return 'qual';
  return lower === GROUPS_LABEL.toLowerCase() ? 'groups' : null;
}
/** Rooms are addressed by a single letter in ROUTES, so a round can have at most 26. */
export const MAX_ROOMS_PER_ROUND = 26;

export function ok<T>(value: T): WaterfallParseResult<T> {
  return { ok: true, value };
}
export function err<T>(error: string): WaterfallParseResult<T> {
  return { ok: false, error };
}

/** The message for a ROUTES line (or a BEST line) of a round that ROUNDS does not declare. */
export function undeclaredRoundMessage(label: string): string {
  return `ROUTES references round "${label}", which isn't declared in ROUNDS.`;
}

/** The message for a band that routes to a round that ROUNDS does not declare; `source` is what routes ("Qual", `Round "R1"`). */
export function undeclaredDestinationMessage(source: string, destinationLabel: string): string {
  return `${source} routes to "${destinationLabel}", which isn't declared in ROUNDS.`;
}

/** Trims a round name and collapses runs of whitespace to one space, so "Semi   A" and "Semi A" are the same name. */
export function normalizeRoundLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ');
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
  const label = normalizeRoundLabel(line.slice(0, eqIndex));
  if (!LABEL_PATTERN.test(label)) {
    return err(
      `Round label "${label}" is invalid -- labels use letters, digits, spaces and dashes, and start and end with a letter or digit.`,
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
  if (label.toLowerCase() === GROUPS_LABEL.toLowerCase()) {
    return err(
      `Round label "${label}" is reserved -- "Groups" stands for the group stage's exit and can't be used as a round label.`,
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
  } else if (/^\d+(\+\d+)+$/.test(sizeSpec)) {
    roomSizes = sizeSpec.split('+').map((size) => Number.parseInt(size, 10));
    if (roomSizes.some((size) => size < 1)) {
      return err(
        `ROUNDS line for "${label}" has an invalid room size in "${sizeSpec}" -- every room must be positive.`,
      );
    }
  } else {
    return err(
      `ROUNDS line for "${label}" has an unrecognized size ("${sizeSpec}") -- expected a whole number, "<rooms>x<size>" (e.g. "4x8") or the sizes of the rooms (e.g. "8+8+7").`,
    );
  }

  const trailer = parseRoundLineTrailer(label, tokens.slice(1));
  if (!trailer.ok) return trailer;

  return ok({ label, roomSizes, ...trailer.value });
}

type RoundLineTrailer = Pick<RawRoundLine, 'bestOf' | 'games' | 'wins' | 'isRanking'> & {
  isFinal: boolean;
  column: number | null;
};

/** The match format already written on the line, as the organiser wrote it, for the "choose one" error. */
function writtenMatchFormat(trailer: Pick<RoundLineTrailer, 'bestOf' | 'games' | 'wins'>): string {
  const written: MatchFormat = { games: trailer.games ?? 1, bestOf: trailer.bestOf, wins: trailer.wins };
  return matchFormatToken(written);
}

/** Whether the line already has a match format of another kind than `keyword`'s own (BO, GAMES or WINS). */
function hasOtherMatchFormat(
  trailer: Pick<RoundLineTrailer, 'bestOf' | 'games' | 'wins'>,
  own: 'bestOf' | 'games' | 'wins',
): boolean {
  return (['bestOf', 'games', 'wins'] as const).some((kind) => kind !== own && trailer[kind] !== undefined);
}

/**
 * The tokens after a ROUNDS line's size, in any order, each at most once: "FINAL", "RANKING", "COLUMN <n>", and one match
 * format, "BO<n>" (best of n, odd from 3 to 9), "GAMES <n>" (n games summed, 1 to 4) or "WINS" (uneven wins).
 */
function parseRoundLineTrailer(label: string, tokens: string[]): WaterfallParseResult<RoundLineTrailer> {
  const trailer: RoundLineTrailer = { isFinal: false, column: null };
  let seenColumn = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index].toUpperCase();
    const bestOfMatch = /^BO(\d*)$/.exec(keyword);
    if (keyword === 'FINAL') {
      if (trailer.isFinal) return err(`ROUNDS line for "${label}" repeats FINAL -- write it once.`);
      trailer.isFinal = true;
    } else if (keyword === 'RANKING') {
      if (trailer.isRanking) return err(`ROUNDS line for "${label}" repeats RANKING -- write it once.`);
      trailer.isRanking = true;
    } else if (keyword === 'COLUMN') {
      if (seenColumn) return err(`ROUNDS line for "${label}" repeats COLUMN -- write it once.`);
      seenColumn = true;
      const number = tokens[index + 1];
      if (number === undefined || !/^\d+$/.test(number) || Number.parseInt(number, 10) < 1) {
        return err(
          `ROUNDS line for "${label}" needs a whole number from 1 after COLUMN -- for example "COLUMN 2".`,
        );
      }
      trailer.column = Number.parseInt(number, 10);
      index += 1;
    } else if (bestOfMatch) {
      const bestOf = Number.parseInt(bestOfMatch[1], 10);
      if (!BEST_OF_VALUES.includes(bestOf)) {
        return err(
          `ROUNDS line for "${label}" needs an odd number from 3 to 9 after BO -- for example "BO3".`,
        );
      }
      if (trailer.bestOf !== undefined)
        return err(`ROUNDS line for "${label}" repeats ${keyword} -- write it once.`);
      if (hasOtherMatchFormat(trailer, 'bestOf')) {
        return err(
          `ROUNDS line for "${label}" has both ${writtenMatchFormat(trailer)} and ${keyword} -- choose one match format.`,
        );
      }
      trailer.bestOf = bestOf;
    } else if (keyword === 'WINS') {
      if (trailer.wins) return err(`ROUNDS line for "${label}" repeats WINS -- write it once.`);
      if (hasOtherMatchFormat(trailer, 'wins')) {
        return err(
          `ROUNDS line for "${label}" has both ${writtenMatchFormat(trailer)} and WINS -- choose one match format.`,
        );
      }
      trailer.wins = true;
    } else if (keyword === 'GAMES') {
      const number = tokens[index + 1];
      const games = number !== undefined && /^\d+$/.test(number) ? Number.parseInt(number, 10) : 0;
      if (games < 1 || games > MAX_SUMMED_GAMES) {
        return err(
          `ROUNDS line for "${label}" needs a whole number from 1 to ${MAX_SUMMED_GAMES} after GAMES -- for example "GAMES 2".`,
        );
      }
      if (trailer.games !== undefined)
        return err(`ROUNDS line for "${label}" repeats GAMES -- write it once.`);
      if (hasOtherMatchFormat(trailer, 'games')) {
        return err(
          `ROUNDS line for "${label}" has both ${writtenMatchFormat(trailer)} and GAMES ${games} -- choose one match format.`,
        );
      }
      trailer.games = games;
      index += 1;
    } else {
      return err(
        `ROUNDS line for "${label}" has an unexpected trailing token ("${tokens.slice(index).join(' ')}") -- only "FINAL", "RANKING", "COLUMN <number>", "BO<number>", "GAMES <number>" and "WINS" are allowed after the size.`,
      );
    }
  }
  if (trailer.isFinal && trailer.isRanking) {
    return err(`ROUNDS line for "${label}" is marked both FINAL and RANKING -- choose one.`);
  }
  return ok(trailer);
}

function parseRouteLine(line: string, declared: ReadonlySet<string>): WaterfallParseResult<RawRouteLine> {
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return err(`ROUTES line "${line}" is missing ":" -- expected "<round>: <ranks>-><destination>, ...".`);
  }
  const address = line.slice(0, colonIndex).trim();
  const dotIndex = address.indexOf('.');
  let label: string;
  let room: number | null;
  if (dotIndex === -1) {
    label = normalizeRoundLabel(address);
    room = null;
  } else {
    label = normalizeRoundLabel(address.slice(0, dotIndex));
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
    const destPart = normalizeRoundLabel(token.slice(arrowIndex + 2));
    if (!rankPart) {
      return err(`ROUTES line for "${address}" has a band with no rank before "->".`);
    }
    if (!destPart) {
      return err(`ROUTES line for "${address}" has a band with no destination after "->".`);
    }
    const destination = splitWinsSuffix(destPart, declared, address);
    if (!destination.ok) return destination;
    pending.push(rankPart);
    bands.push({
      rankTokens: [...pending],
      destinationLabel: destination.value.label,
      ...(destination.value.wins === undefined ? {} : { wins: destination.value.wins }),
    });
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

  const declaredLabels = new Set(roundLines.map((round) => round.label.toLowerCase()));
  const routeLines: RawRouteLine[] = [];
  const bestLines: RawBestLine[] = [];
  let qualBands: RawRouteBand[] | null = null;
  let standingsKind: StandingsSourceKind | null = null;
  for (const line of routesLines) {
    const bestLine = parseBestLine(line);
    if (bestLine) {
      if (!bestLine.ok) return bestLine;
      bestLines.push(bestLine.value);
      continue;
    }
    const result = parseRouteLine(line, declaredLabels);
    if (!result.ok) return result;
    const kind = sourceKindOfLabel(result.value.label);
    if (kind === null) {
      routeLines.push(result.value);
      continue;
    }
    const name = SOURCE_LINE[kind];
    if (result.value.room !== null) {
      const what = kind === 'qual' ? 'the qualification table has' : "the group stage's exit has";
      return err(
        `ROUTES line "${line}" gives "${name}" a room letter -- ${what} no rooms, write "${name}: ..." instead.`,
      );
    }
    if (standingsKind !== null && standingsKind !== kind) {
      return err(
        'A graph has a Qual line or a Groups line, not both -- keep the one that matches the pooling phase.',
      );
    }
    if (qualBands) return err(`The ${name} line appears more than once -- combine them into one.`);
    qualBands = result.value.bands;
    standingsKind = kind;
  }

  return ok({ roundLines, routeLines, bestLines, qualBands, standingsKind });
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
