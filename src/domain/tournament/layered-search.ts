import { missingSeats, seatLevel } from './layered-seating';
import type { RoomSize } from './types';

/**
 * The search of the layered bracket (`docs/rules.md`, "Layered bracket"): for one entry shape (the players of every
 * level), the rounds of the bracket that the rules allow, and the best of them. Not a search with weights: the shape
 * of a bracket is fixed by rules, a small number of things are tried (the top `k` of each room, whether the first
 * semi-final's others play on or wait, whether the highest level sends its top `k` through), and what seats is
 * compared in a fixed order, each line looked at only when the lines above are equal. Pure.
 */

export type LevelName = 'Upper' | 'Middle' | 'Lower';

export interface EntryLevel {
  name: LevelName;
  players: number;
}

export interface SearchSettings {
  roomSize: RoomSize;
  /**
   * The bracket rounds wanted: the rounds after the table, Semi-Final B and the Final included. A bracket has this
   * many or one fewer, and the nearest to it is preferred.
   */
  wantRounds: number;
}

/** The rounds every bracket has beyond those before the last semi-final: the last semi-final and the Final. */
export const ROUNDS_AFTER_THE_BRACKET_ROUNDS = 2;

/** Where the top `k` of each room of a level go. */
export type TopGoes = 'stay' | 'through' | 'last-semi';

export interface LevelRound {
  level: LevelName;
  players: number;
  rooms: number[];
  /** The top `k` of each room. */
  top: number;
  topGoes: TopGoes;
  /** The players who go down a level (none from the Lower level). */
  down: number;
  /** The players out of the bracket (only from the Lower level). */
  out: number;
  /** Rooms of a last-resort size. */
  lastResortRooms: number;
  /** Rooms where more than half of the players do not stay. */
  longShotRooms: number;
  /** Seats missing from full rooms. */
  missingSeats: number;
}

/** Where the first semi-final's players who do not go to the Final are. */
export type SemiOthers = 'play-on' | 'wait' | 'last-semi';

export interface BracketRound {
  /** Players sitting out this round, waiting for the last semi-final. */
  waiting: number;
  /** The first semi-final, which takes the place of the top level this round. */
  firstSemiFinal: { others: SemiOthers } | null;
  levels: LevelRound[];
  /** Players out of the bracket this round. */
  out: number;
}

export interface Bracket {
  entry: EntryLevel[];
  /** The rounds before the last semi-final. */
  rounds: BracketRound[];
  /** The comparison of this bracket: see `compareKeys`. */
  key: number[];
}

/**
 * What a bracket is compared by, a sum over its rounds so the comparison is exact:
 * 0 rooms of a last-resort size; 1 rooms where more than half of the players do not stay; 2 seats missing from full
 * rooms; 3 bracket rounds off the number wanted; 4 the square of the players out, summed over the rounds (the evenness of the
 * cut); 5 rounds in which somebody waits; 6 seats missing counted again by the level's height above the Lower level.
 */
const KEY_LENGTH = 7;
const MAX_ROUNDS = 6;

export function compareKeys(first: number[], second: number[]): number {
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const addKeys = (first: number[], second: number[]): number[] =>
  first.map((value, index) => value + second[index]);
const zeroKey = (): number[] => Array.from({ length: KEY_LENGTH }, () => 0);

interface Position {
  levels: EntryLevel[];
  firstSemiPlayed: boolean;
  waiting: number;
  /** Rounds so far in which somebody waited. */
  waitedRounds: number;
  depth: number;
}

interface Tail {
  key: number[];
  rounds: BracketRound[];
}

/** What is built while the levels of one round are walked. */
interface RoundDraft {
  next: number[];
  waitingNext: number;
  key: number[];
  levels: LevelRound[];
  out: number;
}

type Mode = 'stay' | 'through' | 'play-on' | 'wait';

const positionId = (position: Position): string =>
  [
    position.levels.map((level) => `${level.name}${level.players}`).join(','),
    position.firstSemiPlayed,
    position.waiting,
    position.waitedRounds,
    position.depth,
  ].join('|');

/**
 * A search with these settings: it gives the best bracket for an entry shape, or null when none of the allowed ones
 * exists. Every shape asked of one search shares what has been worked out (a position later in a bracket is the same
 * whichever shape led to it), so asking for many shapes costs little more than asking for one.
 */
export function createBracketSearch(settings: SearchSettings): (entry: EntryLevel[]) => Bracket | null {
  const { roomSize, wantRounds } = settings;
  const full = roomSize.ideal;
  const half = Math.floor(full / 2);
  const memo = new Map<string, Tail | null>();

  /** Once the first semi-final is played and exactly a full room is left (the waiting ones included), they are the last semi-final. */
  function lastSemiFinal(depth: number): Tail | null {
    const rounds = depth + ROUNDS_AFTER_THE_BRACKET_ROUNDS;
    if (rounds > wantRounds || rounds < wantRounds - 1) return null;
    return { key: [0, 0, 0, wantRounds - rounds, 0, 0, 0], rounds: [] };
  }

  function best(position: Position): Tail | null {
    const id = positionId(position);
    if (memo.has(id)) return memo.get(id) ?? null;
    const found = bestFrom(position);
    memo.set(id, found);
    return found;
  }

  function bestFrom(position: Position): Tail | null {
    const { levels, firstSemiPlayed, waiting, depth } = position;
    const left = waiting + sum(levels.map((level) => level.players));
    if (firstSemiPlayed && left === full) return lastSemiFinal(depth);
    if (levels.length === 0 || depth >= MAX_ROUNDS || (firstSemiPlayed && left < full)) return null;
    if (!firstSemiPlayed && levels.length === 1) return null;
    const seatings = levels.map((level) => seatLevel(level.players, roomSize));
    const waitedRounds = position.waitedRounds + (waiting > 0 ? 1 : 0);
    if (waitedRounds > 1 || seatings.some((seating) => seating === null)) return null;
    // Only the Lower level may have rooms of different sizes: every room of the others is as big as its neighbours.
    const unequalAbove = levels.some(
      (level, index) => level.name !== 'Lower' && new Set(seatings[index]?.rooms).size > 1,
    );
    if (unequalAbove) return null;

    const firstSemi = !firstSemiPlayed && levels[0].players === full && levels.length > 1 && depth > 0;
    const modes: Mode[] = firstSemi ? ['play-on', 'wait'] : firstSemiPlayed ? ['through', 'stay'] : ['stay'];
    const lowest = levels.length - 1;
    let top: Tail | null = null;

    const finish = (mode: Mode, draft: RoundDraft) => {
      const nextLevels = levels
        .map((level, index) => ({ name: level.name, players: draft.next[index] }))
        .filter((level) => level.players > 0);
      const tail = best({
        levels: nextLevels,
        firstSemiPlayed: firstSemiPlayed || firstSemi,
        waiting: draft.waitingNext,
        waitedRounds,
        depth: depth + 1,
      });
      if (!tail) return;
      const roundKey = [0, 0, 0, 0, draft.out * draft.out, waiting > 0 ? 1 : 0, 0];
      const key = addKeys(addKeys(draft.key, roundKey), tail.key);
      if (top && compareKeys(key, top.key) >= 0) return;
      const firstSemiFinal = firstSemi
        ? { others: mode === 'wait' ? ('wait' as const) : ('play-on' as const) }
        : null;
      top = {
        key,
        rounds: [{ waiting, firstSemiFinal, levels: draft.levels, out: draft.out }, ...tail.rounds],
      };
    };

    const walk = (mode: Mode, index: number, draft: RoundDraft) => {
      if (index === levels.length) return finish(mode, draft);
      if (index === 0 && firstSemi) {
        // The first semi-final: its top half go to the Final, its other half go down and play on, or wait.
        const next = [...draft.next];
        if (mode === 'play-on') next[1] += full - half;
        const waitingNext = draft.waitingNext + (mode === 'wait' ? full - half : 0);
        return walk(mode, 1, { ...draft, next, waitingNext });
      }
      const { rooms, lastResortRooms } = seatings[index] as NonNullable<(typeof seatings)[number]>;
      const smallest = Math.min(...rooms);
      const bottom = index === lowest && (levels.length > 1 || firstSemiPlayed);
      const lowestTop = bottom ? 2 : Math.max(1, Math.ceil(smallest / 2) - 1);
      const highestTop = Math.max(lowestTop, smallest - 2);
      const through = index === 0 && mode === 'through';
      const missing = missingSeats(rooms, roomSize);
      for (let k = lowestTop; k <= highestTop; k += 1) {
        const stay = k * rooms.length;
        const rest = levels[index].players - stay;
        const next = [...draft.next];
        if (!through) next[index] += stay;
        if (!bottom) next[index + 1] += rest;
        const longShotRooms = rooms.filter((size) => size - k > size / 2).length;
        const level: LevelRound = {
          level: levels[index].name,
          players: levels[index].players,
          rooms,
          top: k,
          topGoes: through ? 'through' : 'stay',
          down: bottom ? 0 : rest,
          out: bottom ? rest : 0,
          lastResortRooms,
          longShotRooms,
          missingSeats: missing,
        };
        const levelKey = [lastResortRooms, longShotRooms, missing, 0, 0, 0, missing * (lowest - index)];
        walk(mode, index + 1, {
          next,
          waitingNext: draft.waitingNext + (through ? stay : 0),
          key: addKeys(draft.key, levelKey),
          levels: [...draft.levels, level],
          out: draft.out + (bottom ? rest : 0),
        });
      }
    };

    for (const mode of modes) {
      walk(mode, 0, {
        next: Array.from({ length: levels.length + 1 }, () => 0),
        waitingNext: waiting,
        key: zeroKey(),
        levels: [],
        out: 0,
      });
    }
    return top;
  }

  return (entry) => {
    const found = best({ levels: entry, firstSemiPlayed: false, waiting: 0, waitedRounds: 0, depth: 0 });
    return found ? { entry, rounds: withLastRoundToLastSemi(found.rounds), key: found.key } : null;
  };
}

/**
 * Everybody who goes on from the last round before the last semi-final goes to it: staying, going through and playing
 * on or waiting come to the same there, and the bracket says so.
 */
function withLastRoundToLastSemi(rounds: BracketRound[]): BracketRound[] {
  return rounds.map((round, index) =>
    index < rounds.length - 1
      ? round
      : {
          ...round,
          firstSemiFinal: round.firstSemiFinal && { others: 'last-semi' },
          levels: round.levels.map((level) => ({ ...level, topGoes: 'last-semi' })),
        },
  );
}
