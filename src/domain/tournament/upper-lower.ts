import { parseAdvanceToBracket } from './bracket-entry';
import { groupSizesOf } from './group-exit';
import { GROUP_SIZE_BOUNDS } from './pooling';
import { roundsBeforeBracket } from './pooling-rounds';
import type { PersistedSetup, RoomSize, ScheduleLogicKey, TournamentRound, TournamentState } from './types';
import { GROUPS_LABEL, QUAL_LABEL, roomIndexToLetter, type StandingsSourceKind } from './waterfall-bracket';

/**
 * The built-in upper and lower bracket (`docs/rules.md`, "Upper and lower bracket"): after a pooling phase the units
 * enter in two or four rooms by their pooling place, the upper half and the lower half meet again in Semi-Final rounds
 * and a Final. This file is the rule, pure: how many enter, the rooms, and the Custom bracket graph text that plays it.
 * Nothing here knows a game format by name: the rooms, the half and the Final follow from the format's room size.
 */

/** What reads the logic of a tournament: the schedule logic, or `'upper-lower'` for a Custom bracket the app works out itself. */
export type BracketLogic = ScheduleLogicKey | 'upper-lower';

/**
 * The logic a tournament is set up and shown with. At runtime an upper and lower bracket is a Custom bracket
 * (`state.scheduleLogic` is `'waterfall-bracket'`, never `'upper-lower'`); `gamemodeConfig.upperLowerVersion` marks it.
 */
export function bracketLogicOf(
  state: Pick<TournamentState, 'scheduleLogic' | 'gamemodeConfig'>,
): BracketLogic {
  return state.gamemodeConfig.upperLowerVersion ? 'upper-lower' : state.scheduleLogic;
}

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
 * does elsewhere; one that is no allowed number is refused, naming the nearest numbers that work. A head count
 * under the floor (2 × the smallest room) is refused.
 */
export function upperLowerEntry(count: number, override: number | null, roomSize: RoomSize): UpperLowerEntry {
  const allowed = upperLowerEntries(roomSize);
  if (count < allowed[0]) {
    return refusal(
      `An upper and lower bracket needs at least ${allowed[0]} to enter, and only ${count} can.`,
    );
  }
  if (override !== null && override <= count && !allowed.includes(override)) {
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
  };
}

function bandsText(bands: UpperLowerBand[]): string {
  return bands
    .map(
      (entry) => `${entry.first === entry.last ? entry.first : `${entry.first}-${entry.last}`}->${entry.to}`,
    )
    .join(', ');
}

function roundLine(entry: UpperLowerRound, token: string): string {
  const seats =
    entry.declared.length > 1 ? `${entry.declared.length}x${entry.declared[0]}` : `${entry.declared[0]}`;
  return `${entry.name} = ${seats}${entry.isRanking ? ' RANKING' : ''}${entry.isFinal ? ' FINAL' : ''}${token ? ` ${token}` : ''}`;
}

function routeLines(entry: UpperLowerRound): string[] {
  return entry.rooms.flatMap((bands, room) => {
    if (bands.length === 0) return [];
    const address = entry.rooms.length > 1 ? `${entry.name}.${roomIndexToLetter(room + 1)}` : entry.name;
    return [`${address}: ${bandsText(bands)}`];
  });
}

/**
 * The Custom bracket graph text (`ROUNDS:` / `ROUTES:`) that plays the shape. `source` is the pooling line that feeds
 * it: `Qual` after a qualification table or a Swiss, `Groups` after a group stage. The Custom bracket engine plays it.
 * `formatOf` gives the match format token of a round's ROUNDS line ("BO3", "GAMES 2", or none): the derived text has
 * none, the one "Adjust rounds by hand" writes carries the formats the Setup selects said.
 */
export function upperLowerGraphText(
  entry: number,
  roomSize: RoomSize,
  firstRoundNumber: number,
  source: StandingsSourceKind = 'qual',
  upperTotal: number | null = null,
  formatOf: (round: UpperLowerRound) => string = () => '',
): string {
  const shape = upperLowerShape(entry, roomSize, firstRoundNumber, upperTotal);
  return [
    'ROUNDS:',
    ...shape.rounds.map((entry) => roundLine(entry, formatOf(entry))),
    '',
    'ROUTES:',
    `${source === 'groups' ? GROUPS_LABEL : QUAL_LABEL}: ${bandsText(shape.pooling)}`,
    ...shape.rounds.flatMap(routeLines),
    '',
  ].join('\n');
}

/** The match stage a round of the built-in bracket plays: the Final the Finals format, a Semi-Final the Semis format, every other round the bracket rounds format. */
export function upperLowerStageOf(name: string, isFinal: boolean): 'bracket' | 'semis' | 'finals' {
  if (isFinal) return 'finals';
  return name.startsWith('Semi-Final') ? 'semis' : 'bracket';
}

/**
 * Marks the rounds of a freshly built upper and lower bracket with the match stage they play: a Semi-Final round the
 * Semis format, the Final the Finals format, every other round the bracket rounds format. `applyMatchFormats` then
 * formats the marked rounds as it formats any stage, so each format can change live.
 */
export function markUpperLowerStages(rounds: TournamentRound[]): TournamentRound[] {
  return rounds.map((entry) => ({
    ...entry,
    graphMatchStage: upperLowerStageOf(entry.customLabel ?? '', entry.isFinal === true),
  }));
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
>;

export type UpperLowerPlan =
  | { ok: true; entry: number; upper: number | null; firstRound: number; source: StandingsSourceKind }
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
  const typed = form.upperLowerAdvance.trim();
  const requested = typed ? parseAdvanceToBracket(typed) : null;
  if (typed && requested === null) {
    return {
      ok: false,
      message: `Advance to bracket must be a positive whole number — got "${form.upperLowerAdvance}".`,
    };
  }
  const entry = upperLowerEntry(unitCount, requested, roomSize);
  if (!entry.ok) return entry;
  const upper = upperLowerUpper(entry.entry, form.upperLowerUpper, roomSize);
  if (!upper.ok) return upper;
  const afterGroups = form.poolingPhase === 'group-stage';
  const groupCount = groupSizesOf(
    unitCount,
    Number.parseInt(form.groupSize, 10) || GROUP_SIZE_BOUNDS.ideal,
  ).length;
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
  };
}
