import { MAX_WIN_TARGET, MIN_WIN_TARGET } from './match-format';
import type { WaterfallParseResult } from './waterfall-parse-result';

/**
 * Uneven wins in the Custom bracket (WINS): a round of one room of two whose units each race to their own number of
 * game wins. The ROUNDS line says `Final = 2 FINAL WINS`; each band into the round may carry the wins the unit
 * arriving by it needs, `Semi A: 1->Final WINS 1`; a band with no value takes the default by column: the unit from
 * the earlier column needs 1, the one from the later column 2 (a Qual or Groups arrival is column 0).
 *
 * This file reads a band's `WINS <n>` text, checks the bands against the round (one small function per refusal) and
 * works out the two targets. Of the other graph files it imports only the result type (`waterfall-parse-result.ts`),
 * so the files that call it never form an import loop with it. Labels are lower case, as the validator keys its rounds.
 */

/** The key of the Qual or Groups line as the source of a band. */
export const WINS_STANDINGS_SOURCE = 'qual';

/** The default targets: the unit that arrives first needs 1 win, the later one 2. */
const EARLIER_DEFAULT = 1;
const LATER_DEFAULT = 2;

/** A ROUNDS line, as far as WINS reads it. */
export interface WinsRound {
  label: string;
  roomSizes: number[];
  wins: boolean;
}

/** One band that routes units into a round, with the value it carries. */
export interface WinsBand {
  /** Who sends it, as a message names it: `Round "Semi A"`, "The Qual line". */
  sourceName: string;
  /** The lower-case label of the round that sends it, or `WINS_STANDINGS_SOURCE` for the Qual or Groups line. */
  source: string;
  /** The room of the source round the band leaves (1-based; 1 for a standings line). */
  room: number;
  /** The lower-case label of the round it enters. */
  destination: string;
  /** How many ranks the band sends. */
  ranks: number;
  /** The wins typed after the destination, null when none. */
  wins: number | null;
}

/** A WINS round's resolved target: the source it comes from (a lower-case label, or `WINS_STANDINGS_SOURCE`) and the wins it needs. */
export interface ResolvedWinTarget {
  source: string;
  wins: number;
}

function refuse<T>(error: string): WaterfallParseResult<T> {
  return { ok: false, error };
}

/**
 * The destination of a band as written, without its trailing `WINS <n>`: a name that is a declared round (or
 * "eliminated") is left as it is, so a round called "Big Wins" keeps working; otherwise `Semi B WINS 2` is the round
 * "Semi B" with the value 2 when that round is declared. Round names can hold spaces, so the split is by lookup.
 */
export function splitWinsSuffix(
  text: string,
  declared: ReadonlySet<string>,
  address: string,
): WaterfallParseResult<{ label: string; wins?: number }> {
  const whole = { ok: true as const, value: { label: text } };
  if (declared.has(text.toLowerCase()) || text.toLowerCase() === 'eliminated') return whole;
  const match = /^(.+?)\s+WINS(?:\s+(.*))?$/i.exec(text);
  if (!match || !declared.has(match[1].toLowerCase())) return whole;
  if (match[2] === undefined || !/^\d+$/.test(match[2])) {
    return refuse(
      `ROUTES line for "${address}" needs a whole number from ${MIN_WIN_TARGET} to ${MAX_WIN_TARGET} after WINS -- for example "${match[1]} WINS 2".`,
    );
  }
  return { ok: true, value: { label: match[1], wins: Number.parseInt(match[2], 10) } };
}

const NO_REFUSAL = { ok: true as const, value: null };

function winsLabels(rounds: WinsRound[]): Set<string> {
  return new Set(rounds.filter((round) => round.wins).map((round) => round.label.toLowerCase()));
}

/** WINS on a round that is not one room of two. */
function refuseWrongShape(rounds: WinsRound[]): WaterfallParseResult<null> {
  const wrong = rounds.find(
    (round) => round.wins && (round.roomSizes.length !== 1 || round.roomSizes[0] !== 2),
  );
  return wrong
    ? refuse(`Round "${wrong.label}" plays WINS, which needs one room of two players.`)
    : NO_REFUSAL;
}

/** A band value into a round that does not play WINS. */
function refuseValueOnPlainRound(
  rounds: WinsRound[],
  bands: WinsBand[],
  labelOf: (key: string) => string,
): WaterfallParseResult<null> {
  const wins = winsLabels(rounds);
  const stray = bands.find((band) => band.wins !== null && !wins.has(band.destination));
  return stray
    ? refuse(
        `${stray.sourceName} gives "${labelOf(stray.destination)}" a WINS value, but "${labelOf(stray.destination)}" doesn't play WINS -- add WINS to its ROUNDS line.`,
      )
    : NO_REFUSAL;
}

/** A target outside 1 to 9. */
function refuseOutOfRange(bands: WinsBand[], labelOf: (key: string) => string): WaterfallParseResult<null> {
  const wrong = bands.find(
    (band) => band.wins !== null && (band.wins < MIN_WIN_TARGET || band.wins > MAX_WIN_TARGET),
  );
  return wrong
    ? refuse(
        `Round "${labelOf(wrong.destination)}": WINS ${wrong.wins} is out of range -- a target is a whole number from ${MIN_WIN_TARGET} to ${MAX_WIN_TARGET}.`,
      )
    : NO_REFUSAL;
}

/** A band that sends more than one unit into a WINS round: each arrival needs exactly one band. */
function refuseSeveralUnits(
  rounds: WinsRound[],
  bands: WinsBand[],
  labelOf: (key: string) => string,
): WaterfallParseResult<null> {
  const wins = winsLabels(rounds);
  const many = bands.find((band) => wins.has(band.destination) && band.ranks !== 1);
  return many
    ? refuse(
        `${many.sourceName} sends ${many.ranks} units to "${labelOf(many.destination)}" in one band -- a WINS round takes one unit by each band.`,
      )
    : NO_REFUSAL;
}

/** Two bands from the same source round into one WINS round: the stored targets are told apart by the round they come from. */
function refuseSameSourceTwice(
  rounds: WinsRound[],
  bands: WinsBand[],
  labelOf: (key: string) => string,
): WaterfallParseResult<null> {
  const wins = winsLabels(rounds);
  const seen = new Set<string>();
  for (const band of bands) {
    if (!wins.has(band.destination)) continue;
    const key = `${band.destination}|${band.source}`;
    if (seen.has(key)) {
      return refuse(
        `${band.sourceName} sends two bands into "${labelOf(band.destination)}" -- the two units of a WINS round must come from different rounds.`,
      );
    }
    seen.add(key);
  }
  return NO_REFUSAL;
}

/** A BEST line that sends units into a WINS round: it takes its two units by bands. */
function refuseBestInto(
  rounds: WinsRound[],
  bestDestinations: string[],
  labelOf: (key: string) => string,
): WaterfallParseResult<null> {
  const wins = winsLabels(rounds);
  const into = bestDestinations.find((destination) => wins.has(destination));
  return into
    ? refuse(
        `A BEST line sends units into "${labelOf(into)}", which plays WINS -- a WINS round takes its two units by bands.`,
      )
    : NO_REFUSAL;
}

/** A WINS round that the bands do not feed with two units. */
function refuseNotTwoBands(rounds: WinsRound[], bands: WinsBand[]): WaterfallParseResult<null> {
  for (const round of rounds.filter((candidate) => candidate.wins)) {
    const fed = bands.filter((band) => band.destination === round.label.toLowerCase()).length;
    if (fed !== 2) {
      return refuse(
        `Round "${round.label}" plays WINS, so its two units must each come by a band (it has ${fed}).`,
      );
    }
  }
  return NO_REFUSAL;
}

/**
 * The checks of a graph's WINS rounds and bands that need nothing but the lines themselves, in order. `bestDestinations`
 * are the lower-case labels the BEST lines send to.
 */
export function checkWinsRounds(
  rounds: WinsRound[],
  bands: WinsBand[],
  bestDestinations: string[],
): WaterfallParseResult<null> {
  const labels = new Map(rounds.map((round) => [round.label.toLowerCase(), round.label]));
  const labelOf = (key: string) => labels.get(key) ?? key;
  const checks = [
    () => refuseWrongShape(rounds),
    () => refuseValueOnPlainRound(rounds, bands, labelOf),
    () => refuseOutOfRange(bands, labelOf),
    () => refuseSeveralUnits(rounds, bands, labelOf),
    () => refuseSameSourceTwice(rounds, bands, labelOf),
    () => refuseBestInto(rounds, bestDestinations, labelOf),
    () => refuseNotTwoBands(rounds, bands),
  ];
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
  }
  return NO_REFUSAL;
}

/** The two units of a WINS round are told apart by column; in one column nothing says which is first, so both must be typed. */
function refuseSameColumn(label: string, typed: Array<number | null>): WaterfallParseResult<null> {
  return typed.every((wins) => wins !== null)
    ? NO_REFUSAL
    : refuse(`${label}: both finalists qualify in the same column, so type the wins each one needs.`);
}

/** The default of the unit that arrives in `column` against one arriving in `other`: 1 for the earlier, 2 for the later. */
function defaultWins(column: number, other: number): number {
  return column < other ? EARLIER_DEFAULT : LATER_DEFAULT;
}

/**
 * The two targets of every WINS round, by its lower-case label. A typed value stands; an untyped band takes the
 * default by column (`columnOf` is by lower-case round label, the Qual and Groups line being column 0). Two units that
 * arrive in the same column are refused unless both are typed. Call after the checks of `checkWinsRounds`.
 */
export function resolveWinTargets(
  rounds: WinsRound[],
  bands: WinsBand[],
  columnOf: ReadonlyMap<string, number>,
): WaterfallParseResult<Map<string, ResolvedWinTarget[]>> {
  const targets = new Map<string, ResolvedWinTarget[]>();
  for (const round of rounds.filter((candidate) => candidate.wins)) {
    const arrivals = bands.filter((band) => band.destination === round.label.toLowerCase());
    const columns = arrivals.map((band) =>
      band.source === WINS_STANDINGS_SOURCE ? 0 : (columnOf.get(band.source) ?? 0),
    );
    if (columns[0] === columns[1]) {
      const level = refuseSameColumn(
        round.label,
        arrivals.map((band) => band.wins),
      );
      if (!level.ok) return level;
    }
    targets.set(
      round.label.toLowerCase(),
      arrivals.map((band, index) => ({
        source: band.source,
        wins: band.wins ?? defaultWins(columns[index], columns[1 - index]),
      })),
    );
  }
  return { ok: true, value: targets };
}
