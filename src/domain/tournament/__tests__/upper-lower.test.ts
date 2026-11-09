import { describe, expect, it } from 'vitest';
import { GAME_FORMAT_LIST, deriveRoomSize, getGameFormat } from '../formats';
import type { RoomSize } from '../types';
import {
  bracketLogicOf,
  upperLowerEntries,
  upperLowerEntry,
  upperLowerFinalSize,
  upperLowerGraphText,
  upperLowerShape,
  type UpperLowerRound,
} from '../upper-lower';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  type OrderedWaterfallGraph,
} from '../waterfall-bracket';

const roomOf = (key: string): RoomSize => deriveRoomSize(getGameFormat(key as never) as never);
const FFA = roomOf('ffa-individual');
const FIRST = 5;

function validated(text: string, count: number, roomSize: RoomSize, kind: 'qual' | 'groups' = 'qual') {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return validateAndOrderWaterfallGraph(parsed.value, {
    roomSize,
    entrantCount: count,
    standingsSource: true,
    standingsKind: kind,
  });
}

function graphOf(entry: number, roomSize: RoomSize, count = entry): OrderedWaterfallGraph {
  const result = validated(upperLowerGraphText(entry, roomSize, FIRST), count, roomSize);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const roundNamed = (rounds: UpperLowerRound[], name: string) => rounds.find((round) => round.name === name);
const namesOf = (entry: number, roomSize: RoomSize = FFA) =>
  upperLowerShape(entry, roomSize, FIRST).rounds.map((round) => round.name);

describe('how many enter', () => {
  it('lists the numbers that make two or four rooms of the format', () => {
    expect(upperLowerEntries(FFA)).toEqual([12, 13, 14, 15, 16, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    expect(upperLowerEntries(roomOf('team-2v2v2v2'))).toEqual([6, 7, 8, 12, 13, 14, 15, 16]);
    expect(upperLowerEntries(roomOf('team-2v2v2v2v2'))).toEqual([8, 9, 10, 16, 17, 18, 19, 20]);
    expect(upperLowerEntries(roomOf('team-2v2v2'))).toEqual([4, 5, 6, 8, 9, 10, 11, 12]);
    expect(upperLowerEntries(roomOf('individual-1v1'))).toEqual([4, 8]);
  });

  it('takes everyone who fits: the largest allowed number at or below the head count', () => {
    const entry = (count: number) => upperLowerEntry(count, null, FFA);
    expect(entry(12)).toEqual({ ok: true, entry: 12 });
    expect(entry(23)).toEqual({ ok: true, entry: 16 });
    expect(entry(24)).toEqual({ ok: true, entry: 24 });
    expect(entry(31)).toEqual({ ok: true, entry: 31 });
    for (const count of [37, 43, 53]) expect(entry(count)).toEqual({ ok: true, entry: 32 });
  });

  it('refuses a head count under the floor of two small rooms', () => {
    expect(upperLowerEntry(11, null, FFA)).toEqual({
      ok: false,
      message: 'An upper and lower bracket needs at least 12 to enter, and only 11 can.',
    });
    expect(upperLowerEntry(3, null, roomOf('individual-1v1')).ok).toBe(false);
  });

  it('lets an override lower the number, never raise it past the head count', () => {
    expect(upperLowerEntry(40, 28, FFA)).toEqual({ ok: true, entry: 28 });
    expect(upperLowerEntry(29, 24, FFA)).toEqual({ ok: true, entry: 24 });
    expect(upperLowerEntry(29, 40, FFA)).toEqual({ ok: true, entry: 29 });
    expect(upperLowerEntry(53, 99, FFA)).toEqual({ ok: true, entry: 32 });
  });

  it('refuses an override that makes no bracket, naming the nearest numbers on both sides of the gap', () => {
    expect(upperLowerEntry(30, 20, FFA)).toEqual({
      ok: false,
      message: 'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    });
    expect(upperLowerEntry(30, 17, FFA)).toMatchObject({ message: expect.stringContaining('use 16 or 24') });
    expect(upperLowerEntry(30, 23, FFA)).toMatchObject({ message: expect.stringContaining('use 16 or 24') });
    expect(upperLowerEntry(30, 5, FFA)).toMatchObject({ message: expect.stringContaining('use 12.') });
    expect(upperLowerEntry(53, 40, FFA)).toMatchObject({ message: expect.stringContaining('use 32.') });
    expect(upperLowerEntry(53, 33, FFA)).toMatchObject({ message: expect.stringContaining('use 32.') });
  });

  it('knows an override above the head count is not a mistake, even where the number makes no bracket', () => {
    expect(upperLowerEntry(18, 20, FFA)).toEqual({ ok: true, entry: 16 });
  });
});

describe('the rooms', () => {
  const roomsOf = (entry: number) => {
    const shape = upperLowerShape(entry, FFA, FIRST);
    return { upper: shape.upper, lower: shape.lower };
  };

  it('splits the entry evenly over the rooms, the larger rooms first, the first half upper', () => {
    expect(roomsOf(29)).toEqual({ upper: [8, 7], lower: [7, 7] });
    expect(roomsOf(31)).toEqual({ upper: [8, 8], lower: [8, 7] });
    expect(roomsOf(32)).toEqual({ upper: [8, 8], lower: [8, 8] });
    expect(roomsOf(24)).toEqual({ upper: [6, 6], lower: [6, 6] });
    expect(roomsOf(25)).toEqual({ upper: [7, 6], lower: [6, 6] });
    expect(roomsOf(16)).toEqual({ upper: [8], lower: [8] });
    expect(roomsOf(13)).toEqual({ upper: [7], lower: [6] });
  });

  it('gives the Final two halves of a room in every format', () => {
    const finals = Object.fromEntries(
      ['ffa-individual', 'team-2v2v2v2', 'team-2v2v2v2v2', 'team-2v2v2', 'individual-1v1', 'team-4v4'].map(
        (key) => [key, upperLowerFinalSize(roomOf(key))],
      ),
    );
    expect(finals).toEqual({
      'ffa-individual': 8,
      'team-2v2v2v2': 4,
      'team-2v2v2v2v2': 4,
      'team-2v2v2': 2,
      'individual-1v1': 2,
      'team-4v4': 2,
    });
  });
});

describe('the walked examples', () => {
  it('FFA at 32 or more: the Upper and Lower rooms, a ranking room in each of the two last Lower rounds', () => {
    const text = upperLowerGraphText(32, FFA, 5);
    expect(text).toBe(
      [
        'ROUNDS:',
        'Round 5 - Upper = 2x8',
        'Round 5 - Lower = 2x8',
        'Semi-Final A = 8',
        'Round 6 - Lower = 2x8',
        'Round 6 - Ranking = 8 RANKING',
        'Round 7 - Lower = 8',
        'Round 7 - Ranking = 8 RANKING',
        'Semi-Final B = 8',
        'Final = 8 FINAL',
        '',
        'ROUTES:',
        'Qual: 1-16->Round 5 - Upper, 17-32->Round 5 - Lower',
        'Round 5 - Upper.A: 1-4->Semi-Final A, 5-8->Round 6 - Lower',
        'Round 5 - Upper.B: 1-4->Semi-Final A, 5-8->Round 6 - Lower',
        'Round 5 - Lower.A: 1-4->Round 6 - Lower, 5-8->Round 6 - Ranking',
        'Round 5 - Lower.B: 1-4->Round 6 - Lower, 5-8->Round 6 - Ranking',
        'Semi-Final A: 1-4->Final, 5-8->Semi-Final B',
        'Round 6 - Lower.A: 1-4->Round 7 - Lower, 5-8->Round 7 - Ranking',
        'Round 6 - Lower.B: 1-4->Round 7 - Lower, 5-8->Round 7 - Ranking',
        'Round 7 - Lower: 1-4->Semi-Final B',
        'Semi-Final B: 1-4->Final',
        '',
      ].join('\n'),
    );
  });

  it('live tournament 1793555835749 (11 teams of 4v4, groups of 4, 4, 3, a total exit of 8)', () => {
    const head2head = roomOf('team-4v4');
    expect(upperLowerEntry(11, null, head2head)).toEqual({ ok: true, entry: 8 });
    const text = upperLowerGraphText(8, head2head, 4, 'groups');
    expect(text.split('\n')).toEqual([
      'ROUNDS:',
      'Round 4 - Upper = 2x2',
      'Round 4 - Lower = 2x2',
      'Semi-Final A = 2',
      'Round 5 - Lower = 2x2',
      'Round 5 - Ranking = 2 RANKING',
      'Round 6 - Lower = 2',
      'Round 6 - Ranking = 2 RANKING',
      'Semi-Final B = 2',
      'Final = 2 FINAL',
      '',
      'ROUTES:',
      'Groups: 1-4->Round 4 - Upper, 5-8->Round 4 - Lower',
      'Round 4 - Upper.A: 1->Semi-Final A, 2->Round 5 - Lower',
      'Round 4 - Upper.B: 1->Semi-Final A, 2->Round 5 - Lower',
      'Round 4 - Lower.A: 1->Round 5 - Lower, 2->Round 5 - Ranking',
      'Round 4 - Lower.B: 1->Round 5 - Lower, 2->Round 5 - Ranking',
      'Semi-Final A: 1->Final, 2->Semi-Final B',
      'Round 5 - Lower.A: 1->Round 6 - Lower, 2->Round 6 - Ranking',
      'Round 5 - Lower.B: 1->Round 6 - Lower, 2->Round 6 - Ranking',
      'Round 6 - Lower: 1->Semi-Final B',
      'Semi-Final B: 1->Final',
      '',
    ]);
    expect(validated(text, 11, head2head, 'groups').ok).toBe(true);
  });

  it('FFA 31: upper 16 [8, 8], lower 15 [8, 7]; Round 6 - Lower 16, Round 6 - Ranking 7, Round 7 - Ranking 8', () => {
    const shape = upperLowerShape(31, FFA, 5);
    expect(shape.upper).toEqual([8, 8]);
    expect(shape.lower).toEqual([8, 7]);
    expect(roundNamed(shape.rounds, 'Round 5 - Lower')).toMatchObject({ declared: [8, 8], real: [8, 7] });
    expect(roundNamed(shape.rounds, 'Round 6 - Lower')).toMatchObject({ real: [8, 8] });
    expect(roundNamed(shape.rounds, 'Round 6 - Ranking')).toMatchObject({ declared: [8], real: [7] });
    expect(roundNamed(shape.rounds, 'Round 7 - Ranking')).toMatchObject({ declared: [8], real: [8] });
  });

  it('FFA 29: upper 15 [8, 7], lower 14 [7, 7]; Round 6 - Lower 15 [8, 7], Round 6 - Ranking 6, Round 7 - Ranking 7', () => {
    const shape = upperLowerShape(29, FFA, 5);
    expect(roundNamed(shape.rounds, 'Round 5 - Upper')).toMatchObject({ declared: [8, 8], real: [8, 7] });
    expect(roundNamed(shape.rounds, 'Round 5 - Lower')).toMatchObject({ declared: [7, 7], real: [7, 7] });
    expect(roundNamed(shape.rounds, 'Round 6 - Lower')).toMatchObject({ declared: [8, 8], real: [8, 7] });
    expect(roundNamed(shape.rounds, 'Round 6 - Ranking')).toMatchObject({ declared: [6], real: [6] });
    expect(roundNamed(shape.rounds, 'Round 7 - Ranking')).toMatchObject({ declared: [8], real: [7] });
  });

  it('FFA 24: rooms of 6 and no ranking room', () => {
    const shape = upperLowerShape(24, FFA, 5);
    expect(shape.rounds.filter((round) => round.isRanking)).toEqual([]);
    expect(roundNamed(shape.rounds, 'Round 5 - Upper')?.real).toEqual([6, 6]);
    expect(roundNamed(shape.rounds, 'Round 6 - Lower')?.real).toEqual([6, 6]);
  });

  it('FFA 27: only the ranking room of Round 7 is left (5 and 6 units)', () => {
    const shape = upperLowerShape(27, FFA, 5);
    expect(shape.upper).toEqual([7, 7]);
    expect(shape.lower).toEqual([7, 6]);
    expect(namesOf(27)).not.toContain('Round 6 - Ranking');
    expect(roundNamed(shape.rounds, 'Round 7 - Ranking')).toMatchObject({ declared: [6], real: [6] });
  });

  it('FFA 23: 16 enter (7 out at qualification), Semi-Final 8, and the ranking room of 4 is left out', () => {
    expect(upperLowerEntry(23, null, FFA)).toEqual({ ok: true, entry: 16 });
    const shape = upperLowerShape(16, FFA, 5);
    expect(shape.rounds.map((round) => round.name)).toEqual([
      'Round 5 - Upper',
      'Round 5 - Lower',
      'Semi-Final',
      'Final',
    ]);
    expect(roundNamed(shape.rounds, 'Semi-Final')?.declared).toEqual([8]);
  });

  it('FFA 12: rooms 6, 6, Semi-Final 6, the ranking room of 2 is left out', () => {
    const shape = upperLowerShape(12, FFA, 5);
    expect(shape.upper).toEqual([6]);
    expect(shape.lower).toEqual([6]);
    expect(roundNamed(shape.rounds, 'Semi-Final')?.declared).toEqual([6]);
    expect(shape.rounds.some((round) => round.isRanking)).toBe(false);
  });

  it.each([37, 43, 53])('%i registered: 32 enter, with %i - 32 out at qualification', (count) => {
    const result = upperLowerEntry(count, null, FFA);
    expect(result).toEqual({ ok: true, entry: 32 });
    const graph = graphOf(32, FFA, count);
    expect(graph.qualRoutes).toHaveLength(32);
  });

  it('2v2v2 at 12 has no ranking room: 4 is over its room size of 3', () => {
    const teams = roomOf('team-2v2v2');
    const shape = upperLowerShape(12, teams, 5);
    expect(shape.rounds.some((round) => round.isRanking)).toBe(false);
    expect(roundNamed(shape.rounds, 'Final')?.declared).toEqual([2]);
  });
});

describe('every format, every head count', () => {
  const bounds = (roomSize: RoomSize, sizes: number[]) =>
    sizes.every((size) => size >= roomSize.min && size <= roomSize.max);

  /** Walks the validated graph with the real room sizes: what arrives in each round, and who is out. */
  function walk(graph: OrderedWaterfallGraph, realByName: Map<string, number[]>) {
    const arrivals = graph.rounds.map(() => 0);
    for (const destination of graph.qualRoutes ?? []) {
      if (destination !== 'eliminated') arrivals[destination] += 1;
    }
    let out = (graph.qualRoutes ?? []).filter((destination) => destination === 'eliminated').length;
    graph.rounds.forEach((spec, index) => {
      const real = realByName.get(spec.label) as number[];
      expect(arrivals[index], `${spec.label} receives what its rooms hold`).toBe(
        real.reduce((total, size) => total + size, 0),
      );
      real.forEach((size, room) => {
        for (const destination of (graph.routes[index][room] ?? []).slice(0, size)) {
          if (destination === 'eliminated') out += 1;
          else arrivals[destination] += 1;
        }
        if (spec.isFinal) out += size;
      });
    });
    return out;
  }

  describe.each(GAME_FORMAT_LIST.map((format) => format.key))('%s', (key) => {
    const roomSize = roomOf(key);
    const half = Math.floor(roomSize.ideal / 2);

    it('has an entry for every head count, or is under the floor', () => {
      const allowed = upperLowerEntries(roomSize);
      for (let count = 1; count <= 80; count += 1) {
        const result = upperLowerEntry(count, null, roomSize);
        if (count < allowed[0]) {
          expect(result.ok, `${count} is under the floor`).toBe(false);
          continue;
        }
        expect(result.ok, `${count} has an entry`).toBe(true);
        if (!result.ok) continue;
        expect(allowed).toContain(result.entry);
        expect(result.entry).toBeLessThanOrEqual(count);
        expect(allowed.filter((entry) => entry > result.entry && entry <= count)).toEqual([]);
      }
    });

    it('writes a graph that validates, with every room inside the format and every unit accounted for', () => {
      for (const entry of upperLowerEntries(roomSize)) {
        for (const count of [entry, entry + 5, 80]) {
          const result = validated(upperLowerGraphText(entry, roomSize, FIRST), count, roomSize);
          expect(result.ok ? '' : result.error, `${key} at ${entry} of ${count}`).toBe('');
          if (!result.ok) continue;
          const shape = upperLowerShape(entry, roomSize, FIRST);
          for (const round of shape.rounds) {
            expect(bounds(roomSize, round.declared), `${round.name} declared at ${entry}`).toBe(true);
            expect(bounds(roomSize, round.real), `${round.name} real at ${entry}`).toBe(true);
          }
          expect(roundNamed(shape.rounds, 'Final')?.declared).toEqual([2 * half]);
          expect(result.value.rounds.map((spec) => spec.label).sort()).toEqual(
            shape.rounds.map((round) => round.name).sort(),
          );
          const realByName = new Map(shape.rounds.map((round) => [round.name, round.real]));
          expect(walk(result.value, realByName)).toBe(entry);
        }
      }
    });

    it('the Groups line is the same graph under another name', () => {
      const entry = upperLowerEntries(roomSize)[0];
      const groups = upperLowerGraphText(entry, roomSize, FIRST, 'groups');
      expect(groups).toContain('Groups: ');
      expect(groups).not.toContain('Qual: ');
      expect(validated(groups, entry, roomSize, 'groups').ok).toBe(true);
    });
  });
});

describe('bracketLogicOf', () => {
  const state = (scheduleLogic: 'waterfall-bracket' | 'single-elimination', upperLowerVersion?: 1) =>
    ({ scheduleLogic, gamemodeConfig: { ...(upperLowerVersion ? { upperLowerVersion } : {}) } }) as never;

  it('reads upper-lower from the version, else the schedule logic', () => {
    expect(bracketLogicOf(state('waterfall-bracket', 1))).toBe('upper-lower');
    expect(bracketLogicOf(state('waterfall-bracket'))).toBe('waterfall-bracket');
    expect(bracketLogicOf(state('single-elimination'))).toBe('single-elimination');
  });
});
