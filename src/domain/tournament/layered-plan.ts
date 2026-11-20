import {
  compareKeys,
  createBracketSearch,
  ROUNDS_AFTER_THE_BRACKET_ROUNDS,
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
/**
 * Bracket rounds (the rounds after the table, the last semi-final and the Final included) the app designs with, by the
 * number of levels. The organiser may type another number, from the fewest a bracket can have to the most it may.
 */
const ROUNDS_BY_LEVELS: Record<LevelCount, number> = { 2: 5, 3: 6 };
export const MIN_BRACKET_ROUNDS = 4;
export const MAX_BRACKET_ROUNDS = 8;
/** How the size of the bracket widens before a room of a last-resort size is accepted. */
const WIDENINGS = 3;

export type LevelCount = 2 | 3;

/** The games of everything but the bracket rounds before the last semi-final: the length of the tournament is worked out from them. */
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
  /** The bracket rounds: the rounds after the table, the last semi-final and the Final included. */
  bracketRounds?: number;
  /** The top level: two equal rooms, 12, 14 or 16 players. */
  topLevel?: number;
  /** Two or three levels. */
  levels?: LevelCount;
}

export interface LayeredInput {
  registered: number;
  roomSize: RoomSize;
  /** How games are counted, for the length shown; they are not an input to the plan. */
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
  bracketRounds: LayeredNumber;
  /** The games of the whole tournament (the table's and every bracket round's), for display only. */
  games: number;
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

/** The games a bracket of `rounds` rounds before the last semi-final takes, the table's included. */
export function bracketGames(games: LayeredGames, rounds: number): number {
  return games.table + rounds + (games.semis - 1) + games.semis + games.final;
}

/** The top levels there can be: two equal rooms, so an even number from two smallest rooms to two full ones. */
function topLevels(roomSize: RoomSize): number[] {
  const tops: number[] = [];
  for (let top = 2 * roomSize.ideal; top >= 2 * roomSize.min; top -= 1) if (top % 2 === 0) tops.push(top);
  return tops;
}

/** A top level of one full room is the first semi-final (Semi A) in the first bracket round. */
const oneRoomTop = (roomSize: RoomSize): number => roomSize.ideal;

/** The level below the top starts with at least 3/4 of the top level's players: 16 needs 12, 14 needs 11, 12 needs 9. */
const belowTopIsBigEnough = (top: number, below: number): boolean => 4 * below >= 3 * top;

/**
 * The entry shapes for `size` in the bracket with `levelCount` levels, in the order they are tried. Unless the organiser
 * typed the top level, the level below the top must be big enough (3/4 of the top); when no top level of two rooms gives
 * that with the rest in normal rooms, the top level is one full room if its level below is big enough and seats in
 * normal rooms, else the smallest of two rooms (12).
 */
function entryShapes(
  size: number,
  roomSize: RoomSize,
  levelCount: LevelCount,
  typedTop?: number,
): EntryLevel[][] {
  const topMax = 2 * roomSize.ideal;
  if (levelCount === 3)
    return typedTop === oneRoomTop(roomSize) ? [] : threeLevelShapes(size, roomSize, typedTop);
  const seats = (top: number) => size - top >= roomSize.min - 1 && seatLevel(size - top, roomSize) !== null;
  const shape = (top: number): EntryLevel[] => [
    { name: 'Upper', players: top },
    { name: 'Lower', players: size - top },
  ];
  if (typedTop !== undefined) return seats(typedTop) ? [shape(typedTop)] : [];
  const seated = topLevels(roomSize).filter(seats);
  const bigEnough = seated.filter((top) => belowTopIsBigEnough(top, size - top));
  const cleanly = bigEnough.some((top) => seatsNormally(size - top, roomSize));
  const one = oneRoomTop(roomSize);
  if (!cleanly && belowTopIsBigEnough(one, size - one) && seatsNormally(size - one, roomSize)) {
    return [shape(one)];
  }
  const tops = bigEnough.length > 0 ? bigEnough : seated.filter((top) => top === 2 * roomSize.min);
  if (tops.includes(topMax) && size - topMax >= roomSize.min && seatsNormally(size - topMax, roomSize)) {
    return [shape(topMax)];
  }
  return tops.map((top) => shape(top));
}

/**
 * Every split of the rest into a Middle and a Lower level that both seat in normal rooms, the Middle level in at least
 * two rooms, the smaller Middle level first. The top level is two full rooms; the Middle level starts with at least 3/4 of
 * it, and when no split gives that the top level is the smallest there is. A typed top level is taken as it is.
 */
function threeLevelShapes(size: number, roomSize: RoomSize, typedTop?: number): EntryLevel[][] {
  const shapesFor = (top: number, checkMiddle: boolean): EntryLevel[][] => {
    const shapes: EntryLevel[][] = [];
    const rest = size - top;
    for (let middle = roomSize.min; middle <= rest - roomSize.min; middle += 1) {
      const rooms = seatLevel(middle, roomSize)?.rooms.length ?? 0;
      if (rooms < 2 || !seatsNormally(middle, roomSize) || !seatsNormally(rest - middle, roomSize)) continue;
      if (checkMiddle && !belowTopIsBigEnough(top, middle)) continue;
      shapes.push([
        { name: 'Upper', players: top },
        { name: 'Middle', players: middle },
        { name: 'Lower', players: rest - middle },
      ]);
    }
    return shapes;
  };
  if (typedTop !== undefined) return shapesFor(typedTop, false);
  const full = shapesFor(2 * roomSize.ideal, true);
  return full.length > 0 ? full : shapesFor(2 * roomSize.min, true);
}

/** What a plan is made from: the room size, how games are counted and what the organiser typed. */
interface Basis {
  roomSize: RoomSize;
  games: LayeredGames;
  typed?: LayeredTyped;
  /** One bracket round more than the usual: tried when the usual number cannot seat the share of those who play. */
  extraRound: boolean;
  /** The search of each number of levels, made when first asked for: a plan asks it for many sizes and shapes. */
  searches: Map<LevelCount, (entry: EntryLevel[]) => Bracket | null>;
}

/** The bracket rounds a bracket with `levelCount` levels is designed with: what the organiser typed, else the usual (one more when asked for). */
const wantedRounds = (basis: Basis, levelCount: LevelCount): number =>
  basis.typed?.bracketRounds ?? ROUNDS_BY_LEVELS[levelCount] + (basis.extraRound ? 1 : 0);

const searchSettings = (basis: Basis, levelCount: LevelCount): SearchSettings => ({
  roomSize: basis.roomSize,
  wantRounds: wantedRounds(basis, levelCount),
});

function searchFor(basis: Basis, levelCount: LevelCount): (entry: EntryLevel[]) => Bracket | null {
  const known = basis.searches.get(levelCount);
  if (known) return known;
  const made = createBracketSearch(searchSettings(basis, levelCount));
  basis.searches.set(levelCount, made);
  return made;
}

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

/** The levels a bracket of `size` in the bracket is designed with when the organiser typed none. */
const usualLevels = (size: number): LevelCount => (size <= TWO_LEVEL_MAX_IN_BRACKET ? 2 : 3);

/**
 * The bracket for `size`: the levels the organiser typed, else two up to 40 in the bracket and three from 41 (two when
 * no three-level bracket exists).
 */
function bracketForSize(size: number, basis: Basis): Bracket | null {
  const typedLevels = basis.typed?.levels;
  if (typedLevels) return bracketAt(size, typedLevels, basis);
  if (usualLevels(size) === 2) return bracketAt(size, 2, basis);
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
  /** The size is under 75% of those who play and was used because its bracket is clearly cleaner. */
  underShare: boolean;
}

/** Clearly cleaner: fewer rooms of a last-resort size, or fewer rooms where more than half do not stay. Seats missing alone are not enough. */
function clearlyCleaner(candidate: Bracket, other: Bracket): boolean {
  const [candidateResort, candidateLong] = candidate.key;
  const [otherResort, otherLong] = other.key;
  return candidateResort < otherResort || (candidateResort === otherResort && candidateLong < otherLong);
}

/**
 * The size of the bracket the app chooses: every number from 75% to 85% of the players who play (rounded inward, never
 * more than the roster, never under the floor), the best bracket of the sizes that give one, the larger size when two
 * are equal. A size from 70% to just under 75% is used only when its best bracket is clearly cleaner than the best of
 * the main range. When no size has a bracket without a last-resort room the range widens by one size at each end, up
 * to three times, before a last-resort room is accepted.
 */
function chooseSize(play: number, registered: number, basis: Basis): Chosen | null {
  const share70 = Math.ceil((7 * play) / 10);
  const share75 = Math.ceil((3 * play) / 4);
  const share85 = Math.floor((17 * play) / 20);
  const bestOf = (from: number, to: number, widened: number, underShare: boolean): Chosen | null => {
    let top: (Chosen & { key: number[] }) | null = null;
    for (let size = Math.max(LAYERED_MIN_IN_BRACKET, from); size <= Math.min(to, registered); size += 1) {
      const bracket = bracketForSize(size, basis);
      if (!bracket) continue;
      const key = sizeKey(bracket, basis.roomSize);
      if (!top || compareKeys(key, top.key) <= 0) top = { size, bracket, widened, underShare, key };
    }
    return top;
  };
  let found: Chosen | null = null;
  for (let widened = 0; widened <= WIDENINGS; widened += 1) {
    const main = bestOf(share75, share85 + widened, widened, false);
    const under = bestOf(share70 - widened, share75 - 1, widened, true);
    found = under && (!main || clearlyCleaner(under.bracket, main.bracket)) ? under : main;
    if (found && found.bracket.key[0] === 0) return found;
  }
  return found;
}

/** A bracket designed with one round more than the usual, and the size the usual number gave. */
interface ExtraRound {
  usualSize: number;
}

/**
 * The size of the bracket, with one more bracket round than usual when the usual number cannot seat the share: the size
 * it gives is under 75% of those who play. The longer bracket is used when it gives a size from 75% to 85% with no more
 * rooms of a last-resort size and no more rooms where more than half do not stay. A typed number of rounds turns this off.
 */
function chooseSizeAndRounds(
  play: number,
  registered: number,
  basis: Basis,
): { chosen: Chosen; basis: Basis; extra?: ExtraRound } | null {
  const usual = chooseSize(play, registered, basis);
  if (!usual) return null;
  const share75 = Math.ceil((3 * play) / 4);
  if (basis.typed?.bracketRounds !== undefined || usual.size >= share75) return { chosen: usual, basis };
  const longer: Basis = { ...basis, extraRound: true, searches: new Map() };
  const more = chooseSize(play, registered, longer);
  const fits =
    more &&
    more.size >= share75 &&
    more.size <= Math.floor((17 * play) / 20) &&
    more.bracket.key[0] <= usual.bracket.key[0] &&
    more.bracket.key[1] <= usual.bracket.key[1];
  return fits ? { chosen: more, basis: longer, extra: { usualSize: usual.size } } : { chosen: usual, basis };
}

function topLevelNumber(bracket: Bracket, roomSize: RoomSize, typed: boolean): LayeredNumber {
  const value = bracket.entry[0].players;
  if (typed) return yours(value);
  const full = 2 * roomSize.ideal;
  if (value === full) return app(value, `two full rooms of ${roomSize.ideal}`);
  if (value === oneRoomTop(roomSize)) {
    return app(
      value,
      `${value} in one room, which is Semi A: with two rooms on top the level below would be under 3/4 of the top level or need rooms of a last-resort size`,
    );
  }
  const below = bracket.entry.reduce((total, level) => total + level.players, 0) - full;
  const why = belowTopIsBigEnough(full, below)
    ? `with ${full} on top the rest of the bracket does not seat in rooms of ${roomSize.min} to ${roomSize.max}`
    : `with ${full} on top the level below would have ${below}, under 3/4 of ${full}`;
  return app(value, `${value} in two equal rooms: ${why}`);
}

function bracketRoundsNumber(
  bracket: Bracket,
  typed: number | undefined,
  levelCount: LevelCount,
  extra: { usualSize: number; play: number } | undefined,
): LayeredNumber {
  const value = bracket.rounds.length + ROUNDS_AFTER_THE_BRACKET_ROUNDS;
  if (typed === undefined) {
    const usual = ROUNDS_BY_LEVELS[levelCount];
    if (extra) {
      return app(
        value,
        `${usual + 1} bracket rounds for ${levelCount} levels, one more than usual: with ${usual} the bracket would hold only ${extra.usualSize}, under 75% of the ${extra.play} who play, or one fewer if that seats better`,
      );
    }
    return app(value, `${usual} bracket rounds for ${levelCount} levels, or one fewer if that seats better`);
  }
  return typed === value
    ? yours(value)
    : {
        value,
        setBy: 'organiser',
        reason: `you asked for ${typed} bracket rounds; this bracket takes ${value}`,
      };
}

function inBracketReason(chosen: Chosen, play: number): string {
  if (chosen.underShare) {
    return `${chosen.size} is under 75% of the ${play} who play; it is used because its bracket is clearly cleaner: fewer rooms of a last-resort size or fewer rooms where more than half do not stay`;
  }
  const share = `between 75% and 85% of the ${play} who play`;
  return chosen.widened === 0
    ? `the best fit ${share}`
    : `the best fit ${share}, looked at ${chosen.widened} ${chosen.widened === 1 ? 'size' : 'sizes'} wider each way because none seats in normal rooms`;
}

/**
 * How many levels, and why. A two-level bracket above 40 in the bracket is a fallback: the reason names the cause, the
 * bracket rounds the organiser asked for when three levels need more, else that no three-level bracket seats the size.
 */
function levelCountNumber(bracket: Bracket, size: number, basis: Basis): LayeredNumber {
  const count = bracket.entry.length;
  if (basis.typed?.levels) return yours(count);
  if (count === 3) return app(3, `three levels from ${TWO_LEVEL_MAX_IN_BRACKET + 1} in the bracket`);
  if (size <= TWO_LEVEL_MAX_IN_BRACKET) {
    return app(2, `two levels up to ${TWO_LEVEL_MAX_IN_BRACKET} in the bracket`);
  }
  const asked = basis.typed?.bracketRounds;
  return asked !== undefined && asked < ROUNDS_BY_LEVELS[3]
    ? app(
        2,
        `two levels: three levels need at least ${ROUNDS_BY_LEVELS[3]} bracket rounds, and you asked for ${asked}`,
      )
    : app(2, `two levels: no three-level bracket seats ${size} in the bracket`);
}

function planOf(
  input: LayeredInput,
  basis: Basis,
  play: LayeredNumber,
  inBracket: LayeredNumber,
  bracket: Bracket,
  extra?: ExtraRound,
): LayeredPlan {
  const { roomSize } = input;
  const levelRounds = bracket.rounds.flatMap((round) => round.levels);
  const levelCount = bracket.entry.length as LevelCount;
  return {
    registered: input.registered,
    play,
    inBracket,
    outAtTable: play.value - inBracket.value,
    bracketRounds: bracketRoundsNumber(
      bracket,
      basis.typed?.bracketRounds,
      levelCount,
      extra && { usualSize: extra.usualSize, play: play.value },
    ),
    games: bracketGames(basis.games, bracket.rounds.length),
    levelCount: levelCountNumber(bracket, inBracket.value, basis),
    topLevel: topLevelNumber(bracket, roomSize, basis.typed?.topLevel !== undefined),
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
  if (top !== undefined && top !== oneRoomTop(roomSize) && !topLevels(roomSize).includes(top)) {
    return `The top level is two equal rooms: ${topLevels(roomSize).reverse().join(', ')} players, or one full room: ${oneRoomTop(roomSize)}.`;
  }
  const rounds = typed?.bracketRounds;
  if (rounds !== undefined && (rounds < MIN_BRACKET_ROUNDS || rounds > MAX_BRACKET_ROUNDS)) {
    return `A bracket has from ${MIN_BRACKET_ROUNDS} to ${MAX_BRACKET_ROUNDS} bracket rounds (the last semi-final and the Final included).`;
  }
  return null;
};

const levelsWords = (levels: LevelCount | undefined): string =>
  levels === undefined ? '' : ` with ${levels === 2 ? 'two' : 'three'} levels`;

/** The bracket rounds a bracket of `size` in the bracket is designed with, for a refusal's words. */
function roundsWords(size: number, basis: Basis): string {
  const rounds = wantedRounds(basis, basis.typed?.levels ?? usualLevels(size));
  return `${rounds - 1} or ${rounds} bracket rounds`;
}

/** The plan for a field, or why there is none. */
export function planLayered(input: LayeredInput): LayeredResult {
  const { registered, roomSize, typed } = input;
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

  const basis: Basis = {
    roomSize,
    games: input.games ?? USUAL_GAMES,
    typed,
    extraRound: false,
    searches: new Map(),
  };
  if (typed?.inBracket !== undefined) {
    const bracket = bracketForSize(typed.inBracket, basis);
    if (!bracket) {
      return {
        ok: false,
        message: `No layered bracket seats ${typed.inBracket} in the bracket${levelsWords(typed.levels)} in ${roundsWords(typed.inBracket, basis)}. Try another number in the bracket, or another number of bracket rounds.`,
      };
    }
    return { ok: true, plan: planOf(input, basis, play, yours(typed.inBracket), bracket) };
  }
  const sized = chooseSizeAndRounds(play.value, registered, basis);
  if (!sized) {
    return {
      ok: false,
      message: `No layered bracket fits ${play.value} players${levelsWords(typed?.levels)} in ${roundsWords(Math.ceil((3 * play.value) / 4), basis)}. Try another number of bracket rounds, or build the bracket by hand with the Custom bracket.`,
    };
  }
  const { chosen, extra } = sized;
  const inBracket = app(chosen.size, inBracketReason(chosen, play.value));
  return { ok: true, plan: planOf(input, sized.basis, play, inBracket, chosen.bracket, extra) };
}
