import { parseAdvanceToBracket, requestedBracketEntry } from './bracket-entry-default';
import { groupExitIsTotal } from './group-exit';
import { groupSettingsOf, groupSizesOf } from './group-settings';
import { roundsBeforeBracket } from './pooling-rounds';
import { upperLowerFinalWins, type UpperLowerFinalWins, type UpperLowerWinsFields } from './upper-lower-wins';
import type { PersistedSetup, RoomSize } from './types';
import {
  GROUPS_LABEL,
  QUAL_LABEL,
  roomIndexToLetter,
  type StandingsSourceKind,
} from './waterfall-graph-text';

/**
 * The built-in upper and lower bracket (`docs/rules.md`, "Upper and lower bracket"): after a pooling phase the units
 * enter in two or four rooms by their pooling place, the upper half and the lower half meet again in Semi-Final rounds
 * and a Final. This file is the rule, pure: how many enter, the rooms, and the Custom bracket graph text that plays it.
 * Nothing here knows a game format by name: the rooms, the half and the Final follow from the format's room size.
 */

/** Half a room: the places that go to the Final, or to the next round up, from a room of the bracket. */
const halfOf = (roomSize: RoomSize): number => Math.floor(roomSize.ideal / 2);

/** The Final of an upper and lower bracket: two halves of a room. */
export const upperLowerFinalSize = (roomSize: RoomSize): number => 2 * halfOf(roomSize);

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** Splits `total` over `parts` rooms evenly, the larger rooms first. */
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * The numbers of units that can enter: two rooms (from 2 × the smallest room to 2 × the largest) or four rooms
 * (4 × to 4 ×). FFA: 12-16 and 24-32; head-to-head: 4 and 8.
 */
export function upperLowerEntries(roomSize: RoomSize): number[] {
  const entries = new Set([
    ...range(2 * roomSize.min, 2 * roomSize.max),
    ...range(4 * roomSize.min, 4 * roomSize.max),
  ]);
  return [...entries].sort((first, second) => first - second);
}

export type UpperLowerEntry = { ok: true; entry: number } | { ok: false; message: string };

function refusal(message: string): UpperLowerEntry {
  return { ok: false, message };
}

/** "use 16 or 24" / "use 32": the allowed numbers on each side of a number that isn't one. */
function nearestEntriesText(allowed: number[], requested: number): string {
  const below = allowed.filter((entry) => entry < requested).at(-1);
  const above = allowed.find((entry) => entry > requested);
  return [below, above].filter((entry) => entry !== undefined).join(' or ');
}

/**
 * How many enter. Everyone who fits by default: the largest allowed number at or below the units there are (and
 * below the override, when there is one). An override above the head count means everyone, as "Advance to bracket"
 * does elsewhere, and so does one equal to it; one below it that is no allowed number is refused, naming the nearest
 * numbers that work. A head count
 * under the floor (2 × the smallest room) is refused.
 */
export function upperLowerEntry(count: number, override: number | null, roomSize: RoomSize): UpperLowerEntry {
  const allowed = upperLowerEntries(roomSize);
  if (count < allowed[0]) {
    return refusal(
      `An upper and lower bracket needs at least ${allowed[0]} to enter, and only ${count} can.`,
    );
  }
  if (override !== null && override < count && !allowed.includes(override)) {
    return refusal(
      `Advance to bracket (${override}) has no upper and lower bracket: use ${nearestEntriesText(allowed, override)}.`,
    );
  }
  const ceiling = override === null ? count : Math.min(count, override);
  return { ok: true, entry: Math.max(...allowed.filter((entry) => entry <= ceiling)) };
}

/** The rooms of each side: two when the bracket has four rooms, one when it has two. */
const roomsPerSide = (entry: number, roomSize: RoomSize): number => (entry > 2 * roomSize.max ? 2 : 1);

/**
 * The numbers of units that can start in the upper rooms: every room of both sides stays within the format's room
 * sizes (the sides are each split evenly over their own rooms).
 */
export function upperLowerUpperRange(entry: number, roomSize: RoomSize): { min: number; max: number } {
  const rooms = roomsPerSide(entry, roomSize);
  return {
    min: Math.max(rooms * roomSize.min, entry - rooms * roomSize.max),
    max: Math.min(rooms * roomSize.max, entry - rooms * roomSize.min),
  };
}

export type UpperLowerUpper = { ok: true; upper: number | null } | { ok: false; message: string };

/**
 * "Upper rooms" as typed: null when empty (the sides are split evenly, half each), the number when the rooms can be
 * seated with it, otherwise why not, naming the numbers that work.
 */
export function upperLowerUpper(entry: number, typed: string, roomSize: RoomSize): UpperLowerUpper {
  const text = typed.trim();
  if (!text) return { ok: true, upper: null };
  const requested = parseAdvanceToBracket(text);
  if (requested === null) {
    return { ok: false, message: `Upper rooms must be a positive whole number — got "${typed}".` };
  }
  const { min, max } = upperLowerUpperRange(entry, roomSize);
  if (requested < min || requested > max) {
    const use = min === max ? `${min}` : `${min} to ${max}`;
    return {
      ok: false,
      message: `Upper rooms (${requested}) can't be seated: with ${entry} entering, use ${use}.`,
    };
  }
  return { ok: true, upper: requested };
}

/** Ranks of a room (or of the pooling standings) sent to one round; `to` null is a rank that goes out. */
export interface UpperLowerBand {
  first: number;
  last: number;
  to: string | null;
}

/** The two rounds that send a finalist straight into the Final: the upper finalist's source (the earlier column) and the lower finalist's. */
export interface UpperLowerFinalSources {
  upper: string;
  lower: string;
}

export interface UpperLowerRound {
  name: string;
  /** The seats per room as the graph declares them. */
  declared: number[];
  /** The seats per room really filled, with the units that enter (an entry round can be a seat short). */
  real: number[];
  isFinal: boolean;
  isRanking: boolean;
  /** Per declared room, where its ranks go; a rank no band covers is out. */
  rooms: UpperLowerBand[][];
}

export interface UpperLowerShape {
  entry: number;
  /** The rooms of the entry rounds: the upper ones, then the lower ones. */
  upper: number[];
  lower: number[];
  /** Where the pooling standings go: ranks 1 to the upper total to the upper round, the rest to the lower round. */
  pooling: UpperLowerBand[];
  rounds: UpperLowerRound[];
  finalSources: UpperLowerFinalSources;
}

const band = (first: number, last: number, to: string | null): UpperLowerBand => ({ first, last, to });

/** A room that sends its top `half` places to one round and the rest to another (either may be none: those ranks are out). */
function splitRoom(seats: number, half: number, top: string | null, rest: string | null): UpperLowerBand[] {
  return [band(1, half, top), band(half + 1, seats, rest)].filter((entry) => entry.to !== null);
}

function round(
  name: string,
  declared: number[],
  real: number[],
  rooms: UpperLowerBand[][],
  kind: { isFinal?: boolean; isRanking?: boolean } = {},
): UpperLowerRound {
  return { name, declared, real, isFinal: kind.isFinal === true, isRanking: kind.isRanking === true, rooms };
}

/**
 * A ranking match for units that are all going out, declared at the size of the units that will really be there:
 * played only when that is a room the format can seat. Otherwise null, and those ranks are not routed. The rooms that
 * feed it route only the ranks they really hold, so a room a seat short sends one place fewer.
 */
function rankingRound(name: string, seats: number, roomSize: RoomSize): UpperLowerRound | null {
  const fits = seats >= roomSize.min && seats <= roomSize.max;
  return fits ? round(name, [seats], [seats], [[]], { isRanking: true }) : null;
}

function twoRoomRounds(rooms: number[], roomSize: RoomSize, first: number): UpperLowerRound[] {
  const half = halfOf(roomSize);
  const [upper, lower] = rooms;
  const names = { upper: `Round ${first} - Upper`, lower: `Round ${first} - Lower`, semi: 'Semi-Final' };
  const ranking = rankingRound(`Round ${first + 1} - Ranking`, lower - half, roomSize);
  return [
    round(names.upper, [upper], [upper], [splitRoom(upper, half, 'Final', names.semi)]),
    round(names.lower, [lower], [lower], [splitRoom(lower, half, names.semi, ranking?.name ?? null)]),
    ...(ranking ? [ranking] : []),
    round(names.semi, [upper], [upper], [splitRoom(upper, half, 'Final', null)]),
    round('Final', [2 * half], [2 * half], [[]], { isFinal: true }),
  ];
}

function fourRoomRounds(rooms: number[], roomSize: RoomSize, first: number): UpperLowerRound[] {
  const half = halfOf(roomSize);
  const final = 2 * half;
  const upper = rooms.slice(0, 2);
  const lower = rooms.slice(2);
  const [upperTotal, lowerTotal] = [sum(upper), sum(lower)];
  const [largestUpper, largestLower] = [Math.max(...upper), Math.max(...lower)];
  const names = {
    upper: `Round ${first} - Upper`,
    lower: `Round ${first} - Lower`,
    semiA: 'Semi-Final A',
    semiB: 'Semi-Final B',
    middle: `Round ${first + 1} - Lower`,
    late: `Round ${first + 2} - Lower`,
  };
  const lowerRanking = rankingRound(`Round ${first + 1} - Ranking`, lowerTotal - final, roomSize);
  const middleRanking = rankingRound(`Round ${first + 2} - Ranking`, upperTotal - final, roomSize);
  const twice = <T>(value: T): T[] => [value, value];
  return [
    round(
      names.upper,
      twice(largestUpper),
      upper,
      twice(splitRoom(largestUpper, half, names.semiA, names.middle)),
    ),
    round(
      names.lower,
      twice(largestLower),
      lower,
      lower.map((seats) => splitRoom(seats, half, names.middle, lowerRanking?.name ?? null)),
    ),
    round(names.semiA, [final], [final], [splitRoom(final, half, 'Final', names.semiB)]),
    round(
      names.middle,
      twice(largestUpper),
      splitEvenly(upperTotal, 2),
      splitEvenly(upperTotal, 2).map((seats) =>
        splitRoom(seats, half, names.late, middleRanking?.name ?? null),
      ),
    ),
    ...(lowerRanking ? [lowerRanking] : []),
    round(names.late, [final], [final], [splitRoom(final, half, names.semiB, null)]),
    ...(middleRanking ? [middleRanking] : []),
    round(names.semiB, [final], [final], [splitRoom(final, half, 'Final', null)]),
    round('Final', [final], [final], [[]], { isFinal: true }),
  ];
}

/**
 * The rooms and rounds for `entry` units (a number `upperLowerEntry` gave). `firstRoundNumber` is the number of the
 * first bracket round ("Round 5" after four pooling rounds), which names the rounds after it. `upperTotal` is the
 * number of units starting in the upper rooms (a number `upperLowerUpper` gave), null for half each; each side is split
 * evenly over its own rooms.
 */
export function upperLowerShape(
  entry: number,
  roomSize: RoomSize,
  firstRoundNumber: number,
  upperTotal: number | null = null,
): UpperLowerShape {
  const perSide = roomsPerSide(entry, roomSize);
  const upperSum = upperTotal ?? sum(splitEvenly(entry, 2 * perSide).slice(0, perSide));
  const upper = splitEvenly(upperSum, perSide);
  const lower = splitEvenly(entry - upperSum, perSide);
  const rooms = [...upper, ...lower];
  const fourRooms = perSide === 2;
  const upperName = `Round ${firstRoundNumber} - Upper`;
  const lowerName = `Round ${firstRoundNumber} - Lower`;
  return {
    entry,
    upper,
    lower,
    pooling: [band(1, sum(upper), upperName), band(sum(upper) + 1, entry, lowerName)],
    rounds: fourRooms
      ? fourRoomRounds(rooms, roomSize, firstRoundNumber)
      : twoRoomRounds(rooms, roomSize, firstRoundNumber),
    // Two rooms: the Upper round sends its winner to the Final, the Semi-Final the other one. Four rooms: Semi-Final A and B.
    finalSources: fourRooms
      ? { upper: 'Semi-Final A', lower: 'Semi-Final B' }
      : { upper: upperName, lower: 'Semi-Final' },
  };
}

/** `bandWins` is the value a band into the Final carries (uneven wins), written ` WINS n` after its destination. */
function bandsText(bands: UpperLowerBand[], bandWins: number | null = null): string {
  return bands
    .map((entry) => {
      const ranks = entry.first === entry.last ? entry.first : `${entry.first}-${entry.last}`;
      return `${ranks}->${entry.to}${entry.to === FINAL_NAME && bandWins !== null ? ` WINS ${bandWins}` : ''}`;
    })
    .join(', ');
}

const FINAL_NAME = 'Final';

function roundLine(entry: UpperLowerRound, token: string): string {
  const seats =
    entry.declared.length > 1 ? `${entry.declared.length}x${entry.declared[0]}` : `${entry.declared[0]}`;
  return `${entry.name} = ${seats}${entry.isRanking ? ' RANKING' : ''}${entry.isFinal ? ' FINAL' : ''}${token ? ` ${token}` : ''}`;
}

function routeLines(entry: UpperLowerRound, bandWins: number | null): string[] {
  return entry.rooms.flatMap((bands, room) => {
    if (bands.length === 0) return [];
    const address = entry.rooms.length > 1 ? `${entry.name}.${roomIndexToLetter(room + 1)}` : entry.name;
    return [`${address}: ${bandsText(bands, bandWins)}`];
  });
}

/** The wins the bands out of this round into the Final carry: the upper finalist's source its number, the lower finalist's source its own; none elsewhere. */
function winsOfSource(
  entry: UpperLowerRound,
  sources: UpperLowerFinalSources,
  wins: UpperLowerFinalWins | null,
): number | null {
  if (!wins) return null;
  if (entry.name === sources.upper) return wins.upper;
  return entry.name === sources.lower ? wins.lower : null;
}

/**
 * The Custom bracket graph text (`ROUNDS:` / `ROUTES:`) that plays the shape. `source` is the pooling line that feeds
 * it: `Qual` after a qualification table or a Swiss, `Groups` after a group stage. The Custom bracket engine plays it.
 * `formatOf` gives the match format token of a round's ROUNDS line ("BO3", "GAMES 2", or none): the derived text has
 * none, the one "Adjust rounds by hand" writes carries the formats the Setup selects said. `finalWins` (a head-to-head
 * bracket with uneven wins, `upper-lower-wins.ts`) makes the Final `WINS` and gives the two bands into it their numbers.
 */
export function upperLowerGraphText(
  entry: number,
  roomSize: RoomSize,
  firstRoundNumber: number,
  source: StandingsSourceKind = 'qual',
  upperTotal: number | null = null,
  formatOf: (round: UpperLowerRound) => string = () => '',
  finalWins: UpperLowerFinalWins | null = null,
): string {
  const shape = upperLowerShape(entry, roomSize, firstRoundNumber, upperTotal);
  const tokenOf = (round: UpperLowerRound) => (finalWins && round.isFinal ? 'WINS' : formatOf(round));
  return [
    'ROUNDS:',
    ...shape.rounds.map((round) => roundLine(round, tokenOf(round))),
    '',
    'ROUTES:',
    `${source === 'groups' ? GROUPS_LABEL : QUAL_LABEL}: ${bandsText(shape.pooling)}`,
    ...shape.rounds.flatMap((round) => routeLines(round, winsOfSource(round, shape.finalSources, finalWins))),
    '',
  ].join('\n');
}

/** The Setup fields an upper and lower bracket reads to work out how many enter and what its rounds are called. */
export type UpperLowerForm = Pick<
  PersistedSetup,
  | 'poolingPhase'
  | 'qualRoundsOverride'
  | 'swissRoundsOverride'
  | 'groupSize'
  | 'roundRobinMode'
  | 'groupExit'
  | 'upperLowerAdvance'
  | 'upperLowerUpper'
  | keyof UpperLowerWinsFields
  | 'qualAdv'
  | 'qualifiersPerGroup'
>;

/** What the pooling setting asks for when "Advance to bracket" of the upper and lower bracket is left empty. */
export interface AutomaticRequest {
  /** The number asked for; null when the typed setting is no number (everyone who fits enters). */
  request: number | null;
  /** Set when the number is the exit of a group stage that sends so many per group: the words say where it came from. */
  perGroup?: { groups: number; qualifiers: number };
}

/**
 * The automatic request of the upper and lower bracket: the pooling setting, as the other bracket styles read it.
 * After a qualification table or a Swiss it is the form's "Advance to bracket" (`qualAdv`; left empty, the number the
 * app works out for this head count); after a group stage the exit of the group settings: groups times the qualifiers
 * per group, or the total of an Even split or a Fair cut (which is that same `qualAdv`). One reader for generation,
 * the Setup panel and the running Admin's re-work.
 */
export function automaticRequest(
  form: Pick<PersistedSetup, 'poolingPhase' | 'qualAdv' | 'qualifiersPerGroup' | 'groupExit'>,
  groupCount: number,
  unitCount: number,
  roomSize: RoomSize,
): AutomaticRequest {
  const total = requestedBracketEntry(
    { qualAdv: form.qualAdv, scheduleLogic: 'upper-lower' },
    unitCount,
    roomSize,
  );
  if (form.poolingPhase !== 'group-stage' || groupExitIsTotal(form)) return { request: total };
  const { qualifiersPerGroup: qualifiers } = groupSettingsOf(form);
  return { request: groupCount * qualifiers, perGroup: { groups: groupCount, qualifiers } };
}

/**
 * How many enter: the typed "Advance to bracket" when there is one, else the pooling setting (`automaticRequest`),
 * then `upperLowerEntry`. A refusal says where the number came from when it is a group stage's per-group exit.
 */
export function resolveUpperLowerEntry(
  form: Pick<
    PersistedSetup,
    'poolingPhase' | 'qualAdv' | 'qualifiersPerGroup' | 'groupExit' | 'upperLowerAdvance'
  >,
  unitCount: number,
  groupCount: number,
  roomSize: RoomSize,
  unitPlural: string,
): UpperLowerEntry {
  const typed = form.upperLowerAdvance.trim();
  const requested = typed ? parseAdvanceToBracket(typed) : null;
  if (typed && requested === null) {
    return refusal(`Advance to bracket must be a positive whole number — got "${form.upperLowerAdvance}".`);
  }
  if (typed) return upperLowerEntry(unitCount, requested, roomSize);
  const automatic = automaticRequest(form, groupCount, unitCount, roomSize);
  const entry = upperLowerEntry(unitCount, automatic.request, roomSize);
  const allowed = upperLowerEntries(roomSize);
  const { request, perGroup } = automatic;
  if (entry.ok || !perGroup || request === null || request >= unitCount || allowed.includes(request)) {
    return entry;
  }
  const options = nearestEntriesText(allowed, request);
  return refusal(
    `${perGroup.qualifiers} per group from ${perGroup.groups} groups gives ${request} ${unitPlural}: an upper and lower bracket takes ${options}. Choose Even split or Fair cut with ${options}, or type Advance to bracket.`,
  );
}

export type UpperLowerPlan =
  | {
      ok: true;
      entry: number;
      upper: number | null;
      firstRound: number;
      source: StandingsSourceKind;
      /** The Final's two targets when it plays uneven wins (head-to-head only), else null. */
      finalWins: UpperLowerFinalWins | null;
    }
  | { ok: false; message: string };

/**
 * How many of `unitCount` units enter, the number of the first bracket round and which pooling line feeds it, or why
 * there is no bracket: no pooling phase to split, an "Advance to bracket" that is not a number or makes no bracket, or
 * a per-group exit the groups can't share. The one place generation and the Setup panel both ask.
 */
export function planUpperLower(
  form: UpperLowerForm,
  unitCount: number,
  roomSize: RoomSize,
  unitPlural: string,
): UpperLowerPlan {
  if (form.poolingPhase === 'none') {
    return {
      ok: false,
      message:
        'An upper and lower bracket splits the qualifiers by their pooling place: choose a Qualification Table, a Swiss or a Group Stage.',
    };
  }
  const afterGroups = form.poolingPhase === 'group-stage';
  const groupCount = groupSizesOf(unitCount, groupSettingsOf(form).groupSize).length;
  const entry = resolveUpperLowerEntry(form, unitCount, groupCount, roomSize, unitPlural);
  if (!entry.ok) return entry;
  const upper = upperLowerUpper(entry.entry, form.upperLowerUpper, roomSize);
  if (!upper.ok) return upper;
  const finalWins = upperLowerFinalWins(form, roomSize);
  if (!finalWins.ok) return finalWins;
  const perGroup = !form.groupExit || form.groupExit === 'per-group';
  if (afterGroups && perGroup && entry.entry % groupCount !== 0) {
    return {
      ok: false,
      message: `An upper and lower bracket takes ${entry.entry} ${unitPlural}, and ${groupCount} groups can't each send the same number: choose Even split or Fair cut.`,
    };
  }
  return {
    ok: true,
    entry: entry.entry,
    upper: upper.upper,
    firstRound: roundsBeforeBracket(form, unitCount) + 1,
    source: afterGroups ? 'groups' : 'qual',
    finalWins: finalWins.wins,
  };
}
