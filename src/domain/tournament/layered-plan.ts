import {
  compareKeys,
  createBracketSearch,
  type Bracket,
  type BracketRound,
  type EntryLevel,
  type SearchSettings,
} from './layered-search';
import { seatLevel, seatsNormally } from './layered-seating';
import type { RoomSize } from './types';

/**
 * The layered bracket's plan (`docs/rules.md`, "Layered bracket"): from the number of players, the room size and what the
 * organiser typed, how many are in the bracket, the levels, the rooms of every round and who stays, each number with
 * who set it and the reason, or a refusal in plain words. Pure: no generation, no transition, no sync code, and
 * nothing here names a game format. The shape of a bracket is fixed by rules (`layered-search.ts`); this file chooses
 * the number in the bracket and puts a plan together.
 */

/** Fewer than this in the bracket (and fewer registered than this) has no layered bracket. */
export const LAYERED_MIN_IN_BRACKET = 18;
/** Up to this many in the bracket a plan has two levels; from one more, three. */
export const TWO_LEVEL_MAX_IN_BRACKET = 40;
/** Bracket rounds before the last semi-final that the usual formats allow, by the number of levels. */
const ROUNDS_BY_LEVELS: Record<LevelCount, number> = { 2: 3, 3: 4 };
/** How the size of the bracket widens before a room of a last-resort size is accepted. */
const WIDENINGS = 3;

export type LevelCount = 2 | 3;

/** The games of everything but the bracket rounds before the last semi-final. */
export interface LayeredGames {
  table: number;
  semis: number;
  final: number;
}

/** 4 table rounds, semi-finals and Final over two games each. */
export const USUAL_GAMES: LayeredGames = { table: 4, semis: 2, final: 2 };

/** What the organiser typed: each is fixed, empty (absent) is the app's. */
export interface LayeredTyped {
  /** The number expected to play. */
  play?: number;
  inBracket?: number;
  /** The most games the bracket may take. */
  games?: number;
  /** The top level: 12 to 16 players in two rooms. */
  topLevel?: number;
  /** Two or three levels. */
  levels?: LevelCount;
}

export interface LayeredInput {
  registered: number;
  roomSize: RoomSize;
  games?: LayeredGames;
  typed?: LayeredTyped;
}

/** One number of the plan: its value, who set it, and the app's reason (empty when the organiser set it). */
export interface LayeredNumber {
  value: number;
  setBy: 'app' | 'organiser';
  reason: string;
}

export interface LayeredPlan {
  registered: number;
  play: LayeredNumber;
  inBracket: LayeredNumber;
  /** Expected to play and not in the bracket. */
  outAtTable: number;
  games: LayeredNumber;
  levelCount: LayeredNumber;
  topLevel: LayeredNumber;
  /** The players each level starts the bracket with, the Upper level first. */
  levels: EntryLevel[];
  /** The rounds before the last semi-final. */
  rounds: BracketRound[];
  /** The last semi-final and the Final: a full room each, the top half of the semi-final to the Final. */
  lastSemiFinal: { players: number; toFinal: number };
  finalPlayers: number;
  /** Rooms of a last-resort size, and rooms where more than half do not stay, over the whole plan. */
  lastResortRooms: number;
  longShotRooms: number;
}

export type LayeredResult = { ok: true; plan: LayeredPlan } | { ok: false; message: string };

const app = (value: number, reason: string): LayeredNumber => ({ value, setBy: 'app', reason });
const yours = (value: number): LayeredNumber => ({ value, setBy: 'organiser', reason: '' });

/** The games a bracket of `rounds` rounds before the last semi-final takes. */
export function bracketGames(games: LayeredGames, rounds: number): number {
  return games.table + rounds + (games.semis - 1) + games.semis + games.final;
}

/** The entry shapes for `size` in the bracket with `levelCount` levels, in the order they are tried. */
function entryShapes(
  size: number,
  roomSize: RoomSize,
  levelCount: LevelCount,
  typedTop?: number,
): EntryLevel[][] {
  const topMax = 2 * roomSize.ideal;
  const topMin = 2 * roomSize.min;
  const seats = (top: number) => size - top >= roomSize.min - 1 && seatLevel(size - top, roomSize) !== null;
  if (levelCount === 3) return threeLevelShapes(size, roomSize, typedTop ?? topMax);
  const shape = (top: number): EntryLevel[] => [
    { name: 'Upper', players: top },
    { name: 'Lower', players: size - top },
  ];
  if (typedTop !== undefined) return seats(typedTop) ? [shape(typedTop)] : [];
  if (size - topMax >= roomSize.min && seatsNormally(size - topMax, roomSize)) return [shape(topMax)];
  const shapes: EntryLevel[][] = [];
  for (let top = topMax; top >= topMin; top -= 1) if (seats(top)) shapes.push(shape(top));
  return shapes;
}

/** The top level and every split of the rest into a Middle and a Lower level that both seat in normal rooms, the smaller Middle level first. */
function threeLevelShapes(size: number, roomSize: RoomSize, top: number): EntryLevel[][] {
  const shapes: EntryLevel[][] = [];
  const rest = size - top;
  for (let middle = roomSize.min; middle <= rest - roomSize.min; middle += 1) {
    if (!seatsNormally(middle, roomSize) || !seatsNormally(rest - middle, roomSize)) continue;
    shapes.push([
      { name: 'Upper', players: top },
      { name: 'Middle', players: middle },
      { name: 'Lower', players: rest - middle },
    ]);
  }
  return shapes;
}

/** What a plan is made from: the room size, how games are counted and what the organiser typed. */
interface Basis {
  roomSize: RoomSize;
  games: LayeredGames;
  typed?: LayeredTyped;
  /** The search of each number of levels, made when first asked for: a plan asks it for many sizes and shapes. */
  searches: Map<LevelCount, (entry: EntryLevel[]) => Bracket | null>;
}

function searchFor(basis: Basis, levelCount: LevelCount): (entry: EntryLevel[]) => Bracket | null {
  const known = basis.searches.get(levelCount);
  if (known) return known;
  const made = createBracketSearch(searchSettings(basis, levelCount));
  basis.searches.set(levelCount, made);
  return made;
}

const searchSettings = (basis: Basis, levelCount: LevelCount): SearchSettings => ({
  roomSize: basis.roomSize,
  tableGames: basis.games.table,
  semiGames: basis.games.semis,
  finalGames: basis.games.final,
  wantGames: basis.typed?.games ?? bracketGames(basis.games, ROUNDS_BY_LEVELS[levelCount]),
});

/** The best bracket for `size` in the bracket with `levelCount` levels: the first of the best over its entry shapes. */
function bracketAt(size: number, levelCount: LevelCount, basis: Basis): Bracket | null {
  const search = searchFor(basis, levelCount);
  let best: Bracket | null = null;
  for (const entry of entryShapes(size, basis.roomSize, levelCount, basis.typed?.topLevel)) {
    const found = search(entry);
    if (found && (!best || compareKeys(found.key, best.key) < 0)) best = found;
  }
  return best;
}

/**
 * The bracket for `size`: the levels the organiser typed, else two up to 40 in the bracket and three from 41 (two when
 * no three-level bracket exists).
 */
function bracketForSize(size: number, basis: Basis): Bracket | null {
  const typedLevels = basis.typed?.levels;
  if (typedLevels) return bracketAt(size, typedLevels, basis);
  if (size <= TWO_LEVEL_MAX_IN_BRACKET) return bracketAt(size, 2, basis);
  return bracketAt(size, 3, basis) ?? bracketAt(size, 2, basis);
}

/** What the size of the bracket is chosen by: a last-resort room is worst, then a top level under two full rooms, then the bracket's own comparison. */
function sizeKey(bracket: Bracket, roomSize: RoomSize): number[] {
  const topIsFull = bracket.entry[0].players === 2 * roomSize.ideal;
  return [bracket.key[0], topIsFull ? 0 : 1, ...bracket.key.slice(1)];
}

interface Chosen {
  size: number;
  bracket: Bracket;
  widened: number;
}

/**
 * The size of the bracket the app chooses: every number from 70% to 85% of the players who play (rounded inward, never
 * more than the roster, never under the floor), the best bracket of the sizes that give one, the larger size when two
 * are equal. When no size in the range has a bracket without a last-resort room the range widens by one at each end, up
 * to three times, before a last-resort room is accepted.
 */
function chooseSize(play: number, registered: number, basis: Basis): Chosen | null {
  const low = Math.ceil((7 * play) / 10);
  const high = Math.floor((17 * play) / 20);
  let found: Chosen | null = null;
  for (let widened = 0; widened <= WIDENINGS; widened += 1) {
    const from = Math.max(LAYERED_MIN_IN_BRACKET, low - widened);
    const to = Math.min(high + widened, registered);
    let top: (Chosen & { key: number[] }) | null = null;
    for (let size = from; size <= to; size += 1) {
      const bracket = bracketForSize(size, basis);
      if (!bracket) continue;
      const key = sizeKey(bracket, basis.roomSize);
      if (!top || compareKeys(key, top.key) <= 0) top = { size, bracket, widened, key };
    }
    found = top;
    if (top && top.key[0] === 0) return top;
  }
  return found;
}

function topLevelNumber(bracket: Bracket, roomSize: RoomSize, typed: boolean): LayeredNumber {
  const value = bracket.entry[0].players;
  if (typed) return yours(value);
  return app(
    value,
    value === 2 * roomSize.ideal
      ? `two full rooms of ${roomSize.ideal}`
      : `${value} in two rooms: with ${2 * roomSize.ideal} on top the rest of the bracket does not seat in rooms of ${roomSize.min} to ${roomSize.max}`,
  );
}

function gamesNumber(bracket: Bracket, typedGames: number | undefined, games: LayeredGames): LayeredNumber {
  if (typedGames !== undefined) {
    return typedGames === bracket.games
      ? yours(bracket.games)
      : {
          value: bracket.games,
          setBy: 'organiser',
          reason: `the most games you allow is ${typedGames}; this bracket takes ${bracket.games}`,
        };
  }
  const rounds = bracket.rounds.length;
  return app(
    bracket.games,
    `${games.table} table games, ${rounds} bracket rounds, then the last semi-final and the Final`,
  );
}

function inBracketReason(chosen: Chosen, play: number): string {
  const share = `between 70% and 85% of the ${play} who play`;
  return chosen.widened === 0
    ? `the best fit ${share}`
    : `the best fit ${share}, looked at ${chosen.widened} ${chosen.widened === 1 ? 'size' : 'sizes'} wider each way because none seats in normal rooms`;
}

function levelCountNumber(
  bracket: Bracket,
  size: number,
  typedLevels: LevelCount | undefined,
): LayeredNumber {
  const count = bracket.entry.length;
  if (typedLevels) return yours(count);
  if (count === 3) return app(3, `three levels from ${TWO_LEVEL_MAX_IN_BRACKET + 1} in the bracket`);
  return size <= TWO_LEVEL_MAX_IN_BRACKET
    ? app(2, `two levels up to ${TWO_LEVEL_MAX_IN_BRACKET} in the bracket`)
    : app(2, `two levels: no three-level bracket seats ${size} in the bracket`);
}

function planOf(
  input: LayeredInput,
  play: LayeredNumber,
  inBracket: LayeredNumber,
  bracket: Bracket,
  games: LayeredGames,
): LayeredPlan {
  const { roomSize, typed } = input;
  const levelRounds = bracket.rounds.flatMap((round) => round.levels);
  return {
    registered: input.registered,
    play,
    inBracket,
    outAtTable: play.value - inBracket.value,
    games: gamesNumber(bracket, typed?.games, games),
    levelCount: levelCountNumber(bracket, inBracket.value, typed?.levels),
    topLevel: topLevelNumber(bracket, roomSize, typed?.topLevel !== undefined),
    levels: bracket.entry,
    rounds: bracket.rounds,
    lastSemiFinal: { players: roomSize.ideal, toFinal: Math.floor(roomSize.ideal / 2) },
    finalPlayers: roomSize.ideal,
    lastResortRooms: levelRounds.reduce((total, level) => total + level.lastResortRooms, 0),
    longShotRooms: levelRounds.reduce((total, level) => total + level.longShotRooms, 0),
  };
}

const typedRefusal = (input: LayeredInput, play: number): string | null => {
  const { typed, registered, roomSize } = input;
  if (play > registered) return `${play} are expected to play, but only ${registered} are registered.`;
  const size = typed?.inBracket;
  if (size !== undefined && (size < LAYERED_MIN_IN_BRACKET || size > registered)) {
    return `${size} in the bracket is outside what a layered bracket takes: from ${LAYERED_MIN_IN_BRACKET} up to the ${registered} registered.`;
  }
  const top = typed?.topLevel;
  if (top !== undefined && (top < 2 * roomSize.min || top > 2 * roomSize.ideal)) {
    return `The top level is two rooms of ${roomSize.min} to ${roomSize.ideal} players: from ${2 * roomSize.min} to ${2 * roomSize.ideal}.`;
  }
  return null;
};

/** The plan for a field, or why there is none. */
export function planLayered(input: LayeredInput): LayeredResult {
  const { registered, roomSize, typed } = input;
  const games = input.games ?? USUAL_GAMES;
  if (registered < LAYERED_MIN_IN_BRACKET) {
    return {
      ok: false,
      message: `A layered bracket needs at least ${LAYERED_MIN_IN_BRACKET} players registered. For a smaller field use a single elimination, or build the bracket by hand with the Custom bracket.`,
    };
  }
  const play =
    typed?.play !== undefined
      ? yours(typed.play)
      : app(Math.round((9 * registered) / 10), `9 in 10 of the ${registered} registered`);
  const refusal = typedRefusal(input, play.value);
  if (refusal) return { ok: false, message: refusal };

  const basis: Basis = { roomSize, games, typed, searches: new Map() };
  if (typed?.inBracket !== undefined) {
    const bracket = bracketForSize(typed.inBracket, basis);
    if (!bracket) {
      return {
        ok: false,
        message: `No layered bracket seats ${typed.inBracket} in the bracket${levelsWords(typed.levels)} within ${wantedGames(typed.inBracket, basis)} games. Try another number in the bracket, or allow more games.`,
      };
    }
    return { ok: true, plan: planOf(input, play, yours(typed.inBracket), bracket, games) };
  }
  const chosen = chooseSize(play.value, registered, basis);
  if (!chosen) {
    return {
      ok: false,
      message: `No layered bracket fits ${play.value} players${levelsWords(typed?.levels)} within ${wantedGames(Math.ceil((7 * play.value) / 10), basis)} games. Allow more games, or build the bracket by hand with the Custom bracket.`,
    };
  }
  const inBracket = app(chosen.size, inBracketReason(chosen, play.value));
  return { ok: true, plan: planOf(input, play, inBracket, chosen.bracket, games) };
}

const levelsWords = (levels: LevelCount | undefined): string =>
  levels === undefined ? '' : ` with ${levels === 2 ? 'two' : 'three'} levels`;

/** The games a bracket of `size` in the bracket may take: what the organiser allows, else what its levels allow. */
function wantedGames(size: number, basis: Basis): number {
  const levels = basis.typed?.levels ?? (size <= TWO_LEVEL_MAX_IN_BRACKET ? 2 : 3);
  return searchSettings(basis, levels).wantGames;
}
