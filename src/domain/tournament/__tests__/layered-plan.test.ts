import { describe, expect, it } from 'vitest';
import {
  bracketGames,
  LAYERED_MIN_IN_BRACKET,
  planLayered,
  USUAL_GAMES,
  type LayeredPlan,
} from '../layered-plan';
import type { BracketRound, LevelName, LevelRound } from '../layered-search';
import type { RoomSize } from '../types';

/**
 * The layered bracket's plan (`plans/2026-11-16-layered-bracket-generator.md`, "What it gives"): the five brackets of
 * the recipe, the size chosen for every field, the other two-level sizes, and the rules every plan keeps, for every
 * size in the bracket and every field.
 */

const FFA: RoomSize = { min: 6, max: 8, ideal: 8 };
const FULL = FFA.ideal;
const HALF = FULL / 2;

function plan(input: Parameters<typeof planLayered>[0]): LayeredPlan {
  const result = planLayered(input);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

const forRegistered = (registered: number) => plan({ registered, roomSize: FFA });
/** A field of `play` players who play: the size chosen for them. */
const forPlay = (play: number) => planLayered({ registered: play, roomSize: FFA, typed: { play } });
const forSize = (size: number, typed = {}) =>
  planLayered({ registered: 90, roomSize: FFA, typed: { inBracket: size, ...typed } });

const roomsText = (rooms: number[]): string =>
  rooms.length === 1
    ? String(rooms[0])
    : rooms.every((size) => size === rooms[0])
      ? `${rooms.length}x${rooms[0]}`
      : rooms.join('+');

const levelText = (level: LevelRound): string =>
  `${level.level} ${roomsText(level.rooms)} top ${level.top} ${level.topGoes} (${level.out > 0 ? `${level.out} out` : `${level.down} down`})`;

/** A round as the recipe's table says it: the first semi-final and what becomes of its others, then each level. */
const roundText = (round: BracketRound): string =>
  [
    ...(round.firstSemiFinal ? [`semi ${round.firstSemiFinal.others}`] : []),
    ...round.levels.map(levelText),
  ].join('; ');

describe('the five brackets of the recipe, in full', () => {
  const rows = [
    {
      registered: 24,
      play: 22,
      inBracket: 18,
      levels: [12, 6],
      bracketRounds: 4,
      games: 11,
      rounds: [
        'Upper 2x6 top 4 stay (4 down); Lower 6 top 4 stay (2 out)',
        'semi last-semi; Lower 8 top 4 last-semi (4 out)',
      ],
      waiting: [0, 0],
    },
    {
      registered: 31,
      play: 28,
      inBracket: 23,
      levels: [8, 15],
      bracketRounds: 4,
      games: 11,
      rounds: ['semi wait; Lower 8+7 top 4 stay (7 out)', 'Lower 8 top 4 last-semi (4 out)'],
      waiting: [0, 4],
    },
    {
      registered: 37,
      play: 33,
      inBracket: 28,
      levels: [16, 12],
      bracketRounds: 5,
      games: 12,
      rounds: [
        'Upper 2x8 top 4 stay (8 down); Lower 2x6 top 4 stay (4 out)',
        'semi play-on; Lower 2x8 top 6 stay (4 out)',
        'Lower 2x8 top 4 last-semi (8 out)',
      ],
      waiting: [0, 0, 0],
    },
    {
      registered: 43,
      play: 39,
      inBracket: 32,
      levels: [16, 16],
      bracketRounds: 5,
      games: 12,
      rounds: [
        'Upper 2x8 top 4 stay (8 down); Lower 2x8 top 4 stay (8 out)',
        'semi play-on; Lower 2x8 top 6 stay (4 out)',
        'Lower 2x8 top 4 last-semi (8 out)',
      ],
      waiting: [0, 0, 0],
    },
    {
      registered: 53,
      play: 48,
      inBracket: 40,
      levels: [16, 24],
      bracketRounds: 5,
      games: 12,
      rounds: [
        'Upper 2x8 top 4 stay (8 down); Lower 3x8 top 5 stay (9 out)',
        'semi play-on; Lower 8+8+7 top 4 stay (11 out)',
        'Lower 2x8 top 4 last-semi (8 out)',
      ],
      waiting: [0, 0, 0],
    },
  ];

  it.each(rows)(
    '$registered registered: $play play, $inBracket in the bracket, levels $levels, $bracketRounds bracket rounds',
    ({ registered, play, inBracket, levels, bracketRounds, games, rounds, waiting }) => {
      const found = forRegistered(registered);
      expect(found.play.value).toBe(play);
      expect(found.inBracket.value).toBe(inBracket);
      expect(found.levels.map((level) => level.players)).toEqual(levels);
      expect(found.levels.map((level) => level.name)).toEqual(['Upper', 'Lower']);
      expect(found.bracketRounds.value).toBe(bracketRounds);
      expect(found.games).toBe(games);
      expect(found.rounds.map(roundText)).toEqual(rounds);
      expect(found.rounds.map((round) => round.waiting)).toEqual(waiting);
      expect(found.outAtTable).toBe(play - inBracket);
      expect(found.lastSemiFinal).toEqual({ players: FULL, toFinal: HALF });
    },
  );

  it('has no room of a last-resort size in any of the five', () => {
    for (const { registered } of rows) expect(forRegistered(registered).lastResortRooms).toBe(0);
  });
});

describe('the size chosen for every field', () => {
  // From the field who play to the size in the bracket, by ranges of fields: 75% to 85% of those who play (a 7th bracket round from 70 who play).
  const ranges: Array<[number, number, number]> = [
    [22, 22, 18],
    [23, 23, 19],
    [24, 24, 20],
    [25, 25, 21],
    [26, 27, 22],
    [28, 30, 23],
    [31, 31, 26],
    [32, 32, 27],
    [33, 34, 28],
    [35, 35, 29],
    [36, 36, 30],
    [37, 37, 31],
    [38, 42, 32],
    [43, 43, 36],
    [44, 44, 37],
    [45, 45, 38],
    [46, 47, 39],
    [48, 57, 40],
    [58, 64, 48],
    [65, 69, 52],
    [70, 70, 59],
    [71, 80, 60],
  ];
  const pinned: Array<[number, number]> = ranges.flatMap(([from, to, size]) =>
    Array.from({ length: to - from + 1 }, (_, index): [number, number] => [from + index, size]),
  );

  it.each(pinned)('%i who play: %i in the bracket', (play, size) => {
    const result = planLayered({ registered: play, roomSize: FFA, typed: { play } });
    expect(result.ok && result.plan.inBracket.value).toBe(size);
  });

  it('is pinned for every field from 22 to 80', () => {
    expect(pinned.map(([play]) => play)).toEqual(Array.from({ length: 59 }, (_, index) => 22 + index));
  });

  it('widens the range for fields of 20 and 21, and gives 18 (the floor): not pinned by the plan, reported', () => {
    const results = [20, 21].map((play) => forPlay(play));
    expect(results.map((result) => result.ok && result.plan.inBracket.value)).toEqual([18, 18]);
    for (const result of results) {
      expect(result.ok && result.plan.inBracket.reason).toContain('wider each way');
    }
  });

  it('widens the range before it accepts a last-resort room: with a top level typed, 22 who play get 20, not 19', () => {
    // Without the widening the first range holds 19 (14 and 5: a room of 5) and the answer would be a last-resort room.
    const found = plan({ registered: 80, roomSize: FFA, typed: { play: 22, topLevel: 14 } });
    expect(found.inBracket.value).toBe(20);
    expect(found.levels.map((level) => level.players)).toEqual([14, 6]);
    expect(found.lastResortRooms).toBe(0);
    expect(found.inBracket.reason).toContain('2 sizes wider each way');
  });

  it('widens up to three times: 23 who play with a top level of 16 get 22, never 21 (16 and 5)', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { play: 23, topLevel: 16 } });
    expect(found.inBracket.value).toBe(22);
    expect(found.lastResortRooms).toBe(0);
    expect(found.inBracket.reason).toContain('3 sizes wider each way');
  });

  it('gives 48 in the bracket, in three levels, for 58 to 64 who play, and 52 (16, 12, 24) for 65 to 69', () => {
    for (const play of [58, 61, 64]) {
      const found = plan({ registered: play, roomSize: FFA, typed: { play } });
      expect(found.inBracket.value).toBe(48);
      expect(found.levels.map((level) => level.players)).toEqual([16, 16, 16]);
      expect(found.levelCount.value).toBe(3);
    }
    const found = plan({ registered: 80, roomSize: FFA, typed: { play: 65 } });
    expect(found.inBracket.value).toBe(52);
    expect(found.levels.map((level) => level.players)).toEqual([16, 12, 24]);
    expect(found.bracketRounds.value).toBe(6);
  });

  it('plans every field up to 80 who play, in three levels above 40 in the bracket', () => {
    for (let play = 58; play <= 80; play += 1) {
      const result = forPlay(play);
      expect(result.ok, `${play} who play`).toBe(true);
      if (result.ok) expect(result.plan.levels.length).toBe(result.plan.inBracket.value > 40 ? 3 : 2);
    }
  });

  it('keeps the app’s own choice at 40 or fewer in the bracket for every field up to 57', () => {
    for (let play = 20; play <= 57; play += 1) {
      const result = forPlay(play);
      expect(result.ok && result.plan.inBracket.value).toBeLessThanOrEqual(40);
    }
  });
});

describe('a typed top level of 16 may play two rounds before its room: 16, then 12, then a full room of 8', () => {
  it('plans 22 in the bracket in full: nobody waits, the first semi-final is the third round', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 22, topLevel: 16 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 6]);
    expect(found.bracketRounds.value).toBe(5);
    expect(found.rounds.map((round) => round.out)).toEqual([2, 4, 4]);
    expect(found.rounds.map((round) => round.waiting)).toEqual([0, 0, 0]);
    expect(found.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 6 stay (4 down); Lower 6 top 4 stay (2 out)',
      'Upper 2x6 top 4 stay (4 down); Lower 8 top 4 stay (4 out)',
      'semi last-semi; Lower 8 top 4 last-semi (4 out)',
    ]);
  });

  it('gives 22 in the bracket, 8 and 14, for 29 registered (26 who play): a top of 16 would leave 6 below it', () => {
    const found = forRegistered(29);
    expect(found.play.value).toBe(26);
    expect(found.inBracket.value).toBe(22);
    expect(found.levels.map((level) => level.players)).toEqual([8, 14]);
  });

  it('plans a typed top of 16 at 21 in the bracket in full: out 2, 3, 4', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 21, topLevel: 16 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 5]);
    expect(found.bracketRounds.value).toBe(5);
    expect(found.rounds.map((round) => round.out)).toEqual([2, 3, 4]);
    expect(found.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 6 stay (4 down); Lower 5 top 3 stay (2 out)',
      'Upper 2x6 top 4 stay (4 down); Lower 7 top 4 stay (3 out)',
      'semi last-semi; Lower 8 top 4 last-semi (4 out)',
    ]);
    expect(found.lastResortRooms).toBe(1);
  });
});

describe('three levels, 6 bracket rounds: 41 to 48 in the bracket', () => {
  it.each([
    [41, [16, 12, 13], [5, 4, 8, 12]],
    [42, [16, 14, 12], [4, 6, 8, 12]],
    [43, [16, 14, 13], [5, 6, 8, 12]],
    [44, [16, 16, 12], [4, 8, 8, 12]],
    [45, [16, 16, 13], [5, 8, 8, 12]],
    [46, [16, 16, 14], [6, 8, 8, 12]],
    [47, [16, 16, 15], [7, 8, 8, 12]],
    [48, [16, 16, 16], [8, 8, 8, 12]],
  ])(
    '%i in the bracket: levels %j, out per round %j, four rooms where more than half do not stay',
    (size, levels, outs) => {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size } });
      expect(found.levels.map((level) => level.players)).toEqual(levels);
      expect(found.levels.map((level) => level.name)).toEqual(['Upper', 'Middle', 'Lower']);
      expect(found.rounds.map((round) => round.out)).toEqual(outs);
      expect(found.bracketRounds.value).toBe(6);
      expect(found.games).toBe(13);
      expect(found.levelCount).toMatchObject({ value: 3, setBy: 'app' });
      expect(found.longShotRooms).toBe(4);
    },
  );

  it('plans 41 and 44 in full: the Middle level in equal rooms, only the Lower level mixing', () => {
    const at41 = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 41 } });
    expect(at41.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 4 stay (8 down); Middle 2x6 top 4 stay (4 down); Lower 7+6 top 4 stay (5 out)',
      'semi play-on; Middle 2x8 top 4 stay (8 down); Lower 2x6 top 4 stay (4 out)',
      'Middle 2x6 top 2 through (8 down); Lower 2x8 top 4 stay (8 out)',
      'Lower 2x8 top 2 last-semi (12 out)',
    ]);
    const at44 = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 44 } });
    expect(at44.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 4 stay (8 down); Middle 2x8 top 4 stay (8 down); Lower 2x6 top 4 stay (4 out)',
      'semi play-on; Middle 2x8 top 4 stay (8 down); Lower 2x8 top 4 stay (8 out)',
      'Middle 2x6 top 2 through (8 down); Lower 2x8 top 4 stay (8 out)',
      'Lower 2x8 top 2 last-semi (12 out)',
    ]);
  });

  it('plans 48 in full: four rounds, the Middle level sends its top two through, the Lower level sends 12 out last', () => {
    const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 48 } });
    expect(found.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 4 stay (8 down); Middle 2x8 top 4 stay (8 down); Lower 2x8 top 4 stay (8 out)',
      'semi play-on; Middle 2x8 top 4 stay (8 down); Lower 2x8 top 4 stay (8 out)',
      'Middle 2x6 top 2 through (8 down); Lower 2x8 top 4 stay (8 out)',
      'Lower 2x8 top 2 last-semi (12 out)',
    ]);
    expect(found.rounds.map((round) => round.waiting)).toEqual([0, 0, 0, 4]);
  });

  it('plans 36 with three levels and 7 bracket rounds as 16, 12 and 8 (the 15 Nov levels)', () => {
    const found = plan({
      registered: 90,
      roomSize: FFA,
      typed: { inBracket: 36, levels: 3, bracketRounds: 7 },
    });
    expect(found.levels.map((level) => level.players)).toEqual([16, 12, 8]);
    expect(found.bracketRounds).toEqual({ value: 7, setBy: 'organiser', reason: '' });
    expect(found.games).toBe(14);
    expect(found.rounds.map((round) => round.out)).toEqual([4, 4, 6, 6, 4]);
    expect(found.levelCount).toEqual({ value: 3, setBy: 'organiser', reason: '' });
    expect(found.longShotRooms).toBe(0);
  });

  it('has one room where more than half do not stay for 44 and 48 at 7 bracket rounds (none before the equal rooms)', () => {
    for (const size of [44, 48]) {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size, bracketRounds: 7 } });
      expect(
        found.levels.map((level) => level.players),
        `${size} at 7 rounds`,
      ).toEqual([16, 16, size - 32]);
      expect(found.longShotRooms, `${size} at 7 rounds`).toBe(1);
    }
  });

  it('takes three levels for a larger bracket than 40 and for a typed 3, and two for a typed 2', () => {
    expect(plan({ registered: 90, roomSize: FFA, typed: { inBracket: 41 } }).levelCount.value).toBe(3);
    const three = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 36, levels: 3 } });
    expect(three.levels.map((level) => level.players)).toEqual([16, 12, 8]);
    expect(three.bracketRounds.value).toBe(6);
    const two = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 44, levels: 2 } });
    expect(two.levels).toHaveLength(2);
    expect(two.bracketRounds.value).toBeLessThanOrEqual(5);
    expect(two.levelCount).toEqual({ value: 2, setBy: 'organiser', reason: '' });
  });

  it('falls back to two levels above 40 when the bracket rounds asked for are fewer than three levels need, and says so', () => {
    // Three levels take 6 bracket rounds at least: with 5 asked for only a two-level bracket exists, for every size from 41 to 64.
    for (const size of [41, 44, 52, 64]) {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size, bracketRounds: 5 } });
      expect(found.levels, `${size}`).toHaveLength(2);
      expect(found.bracketRounds.value).toBeLessThanOrEqual(5);
      expect(found.levelCount).toEqual({
        value: 2,
        setBy: 'app',
        reason: 'two levels: three levels need at least 6 bracket rounds, and you asked for 5',
      });
    }
    const typedTop = plan({
      registered: 90,
      roomSize: FFA,
      typed: { inBracket: 44, bracketRounds: 5, topLevel: 14 },
    });
    expect(typedTop.levels.map((level) => level.players)).toEqual([14, 30]);
    expect(
      plan({ registered: 90, roomSize: FFA, typed: { inBracket: 44, bracketRounds: 6 } }).levels,
    ).toHaveLength(3);
  });

  it('refuses typed three levels when no three-level bracket seats the size, naming the levels', () => {
    const result = forSize(18, { levels: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.message).toContain('No layered bracket seats 18 in the bracket with three levels');
  });

  it('works with a typed top level for three levels', () => {
    const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 40, levels: 3, topLevel: 14 } });
    expect(found.levels[0].players).toBe(14);
    expect(found.levels.reduce((total, level) => total + level.players, 0)).toBe(40);
  });
});

describe('the other two-level sizes', () => {
  it.each([
    [19, [12, 7], [3, 4], 4],
    [20, [8, 12], [4, 4], 4],
    [21, [8, 13], [5, 4], 4],
    [22, [8, 14], [6, 4], 4],
    [23, [8, 15], [7, 4], 4],
    [24, [12, 12], [4, 4, 4], 5],
    [25, [12, 13], [5, 4, 4], 5],
    [26, [14, 12], [4, 6, 4], 5],
    [27, [14, 13], [5, 6, 4], 5],
    [28, [16, 12], [4, 4, 8], 5],
    [36, [16, 20], [8, 8, 8], 5],
  ])('%i in the bracket: levels %j, out per round %j', (size, levels, outs, bracketRounds) => {
    const result = forSize(size);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.levels.map((level) => level.players)).toEqual(levels);
    expect(result.plan.rounds.map((round) => round.out)).toEqual(outs);
    expect(result.plan.bracketRounds.value).toBe(bracketRounds);
  });

  it('gives levels 16 and 12 for 28 typed at 37 registered', () => {
    const found = plan({ registered: 37, roomSize: FFA, typed: { inBracket: 28 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 12]);
    expect(found.inBracket).toEqual({ value: 28, setBy: 'organiser', reason: '' });
    expect(found.play.setBy).toBe('app');
  });
});

describe('who set each number, and why', () => {
  it('gives every number the app set a reason in words, and none to a number the organiser typed', () => {
    const found = forRegistered(37);
    for (const number of [
      found.play,
      found.inBracket,
      found.bracketRounds,
      found.levelCount,
      found.topLevel,
    ]) {
      expect(number.setBy).toBe('app');
      expect(number.reason.length).toBeGreaterThan(10);
    }
    expect(found.play.reason).toBe('9 in 10 of the 37 registered');
    const typed = plan({
      registered: 37,
      roomSize: FFA,
      typed: { play: 30, inBracket: 26, bracketRounds: 5, topLevel: 14 },
    });
    expect(typed.play).toEqual({ value: 30, setBy: 'organiser', reason: '' });
    expect(typed.inBracket).toEqual({ value: 26, setBy: 'organiser', reason: '' });
    expect(typed.topLevel).toEqual({ value: 14, setBy: 'organiser', reason: '' });
    expect(typed.bracketRounds.setBy).toBe('organiser');
    expect(typed.levels.map((level) => level.players)).toEqual([14, 12]);
  });

  it('says in words why a top level is not 16', () => {
    const found = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 19 } });
    expect(found.topLevel.value).toBe(12);
    expect(found.topLevel.reason).toContain('under 3/4');
    const seated = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 33 } });
    expect(seated.topLevel.value).toBe(12);
    expect(seated.topLevel.reason).toContain('does not seat');
    expect(plan({ registered: 60, roomSize: FFA, typed: { inBracket: 26 } }).topLevel.value).toBe(14);
  });

  it('counts games from the formats: the table, one a bracket round, the semi-finals and the Final', () => {
    expect(bracketGames(USUAL_GAMES, 3)).toBe(12);
    expect(bracketGames(USUAL_GAMES, 4)).toBe(13);
    expect(bracketGames({ table: 3, semis: 1, final: 3 }, 3)).toBe(10);
    expect(plan({ registered: 37, roomSize: FFA, games: { table: 3, semis: 1, final: 3 } }).games).toBe(10);
    expect(forRegistered(37).games).toBe(12);
    expect(forRegistered(31).games).toBe(11);
  });
});

describe('what the organiser typed is kept, and a bracket that cannot be planned is refused in words', () => {
  it('refuses a field under the floor, naming the single elimination and the Custom bracket', () => {
    const result = planLayered({ registered: LAYERED_MIN_IN_BRACKET - 1, roomSize: FFA });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(`at least ${LAYERED_MIN_IN_BRACKET}`);
    expect(result.message).toContain('single elimination');
    expect(result.message).toContain('Custom bracket');
  });

  it('refuses typed numbers outside what a layered bracket takes', () => {
    const refused = (typed: object, registered = 37) => {
      const result = planLayered({ registered, roomSize: FFA, typed });
      return result.ok ? null : result.message;
    };
    expect(refused({ play: 40 })).toContain('only 37 are registered');
    expect(refused({ inBracket: 17 })).toContain('from 18 up to the 37 registered');
    expect(refused({ inBracket: 38 })).toContain('from 18 up to the 37 registered');
    expect(refused({ topLevel: 11 })).toContain('two equal rooms: 12, 14, 16');
    expect(refused({ topLevel: 13 })).toContain('two equal rooms: 12, 14, 16');
    expect(refused({ topLevel: 17 })).toContain('two equal rooms: 12, 14, 16');
    expect(refused({ bracketRounds: 3 })).toContain('from 4 to 8 bracket rounds');
    expect(refused({ bracketRounds: 9 })).toContain('from 4 to 8 bracket rounds');
  });

  it('refuses a size that seats in no bracket, and a number of bracket rounds no bracket of the size has', () => {
    const noSeat = forSize(18, { topLevel: 16 });
    expect(noSeat.ok).toBe(false);
    if (!noSeat.ok) expect(noSeat.message).toContain('No layered bracket seats 18 in the bracket');
    const tooMany = forSize(18, { bracketRounds: 8 });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toContain('in 7 or 8 bracket rounds');
  });

  it('keeps the bracket rounds the organiser typed as the number wanted, and the nearest bracket at or one under it', () => {
    const found = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 24, bracketRounds: 5 } });
    expect(found.bracketRounds).toEqual({ value: 5, setBy: 'organiser', reason: '' });
    const fewer = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 18, bracketRounds: 5 } });
    expect(fewer.bracketRounds.value).toBe(4);
    expect(fewer.bracketRounds.setBy).toBe('organiser');
    expect(fewer.bracketRounds.reason).toContain('you asked for 5');
  });

  it('designs with the bracket rounds typed: 4 at 24 in the bracket, and 7 once the top level is typed as 16', () => {
    const planned = (typed: object) => {
      const result = forSize(24, typed);
      if (!result.ok) throw new Error(result.message);
      return result.plan;
    };
    expect(planned({ bracketRounds: 4 }).bracketRounds.value).toBe(4);
    expect(planned({ bracketRounds: 7, topLevel: 16 }).bracketRounds.value).toBeGreaterThanOrEqual(6);
    expect(planned({ bracketRounds: 7, topLevel: 16 }).bracketRounds.value).toBeLessThanOrEqual(7);
    expect(planned({}).bracketRounds.value).toBe(5);
  });

  it('refuses 7 bracket rounds at 24 in the bracket when the app picks 12 and 12, and says how many it looked for', () => {
    const result = forSize(24, { bracketRounds: 7 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('in 6 or 7 bracket rounds');
  });
});

/** What every plan keeps, checked by playing the plan's numbers through (`plans/...`, "The procedure"). */
function expectPlanKeepsTheRules(found: LayeredPlan, label: string) {
  const smallest = FFA.min - 1;
  const largest = FFA.max + 1;
  const players = new Map(found.levels.map((level) => [level.name, level.players]));
  let waiting = 0;
  let outTotal = 0;
  let sentToFinal = 0;
  let roundsWithWaiting = 0;
  const first = found.rounds[0];
  // The first semi-final is in the first bracket round only when the top level is one full room.
  if (found.levels[0].players !== FULL)
    expect(first.firstSemiFinal, `${label}: the first semi-final is not the first bracket round`).toBeNull();
  else
    expect(first.firstSemiFinal, `${label}: a top level of one room is the first semi-final`).not.toBeNull();
  found.rounds.forEach((round, index) => {
    const isLast = index === found.rounds.length - 1;
    expect(round.waiting, `${label}: round ${index + 1} waiting`).toBe(waiting);
    if (waiting > 0) roundsWithWaiting += 1;
    const next = new Map<LevelName, number>();
    const add = (name: LevelName, count: number) => next.set(name, (next.get(name) ?? 0) + count);
    const names = [...players.keys()];
    let semiDown = 0;
    let semiWait = 0;
    // The top level is like any other level: the first semi-final is played in the round after it is exactly one
    // full room, and until then it is more than one.
    const upper = players.get('Upper') ?? 0;
    if (round.firstSemiFinal)
      expect(upper, `${label}: the first semi-final comes when the top level is one full room`).toBe(FULL);
    else if (upper > 0)
      expect(
        upper,
        `${label}: the top level is not below a full room before the first semi-final`,
      ).toBeGreaterThan(FULL);
    if (round.firstSemiFinal) {
      const semi = names[0];
      expect(players.get(semi), `${label}: the first semi-final holds a full room`).toBe(FULL);
      sentToFinal += HALF;
      if (round.firstSemiFinal.others === 'wait') semiWait = HALF;
      else semiDown = HALF;
      players.delete(semi);
    }
    expect(
      round.levels.map((level) => level.level),
      `${label}: the levels of round ${index + 1}`,
    ).toEqual([...players.keys()]);
    let waitingNext = waiting + semiWait;
    round.levels.forEach((level, position) => {
      // Only the Lower level may have rooms of different sizes.
      if (level.level !== 'Lower') {
        expect(
          new Set(level.rooms).size,
          `${label}: round ${index + 1}, ${level.level} rooms are equal`,
        ).toBe(1);
      }
      expect(level.players, `${label}: ${level.level} players`).toBe(players.get(level.level));
      expect(
        level.rooms.reduce((total, size) => total + size, 0),
        `${label}: the rooms seat the level`,
      ).toBe(level.players);
      expect(level.rooms.every((size) => size >= smallest && size <= largest)).toBe(true);
      expect(level.lastResortRooms).toBe(
        level.rooms.filter((size) => size < FFA.min || size > FFA.max).length,
      );
      const smallestRoom = Math.min(...level.rooms);
      const isLowest = position === round.levels.length - 1;
      const lowestTop = isLowest ? 2 : Math.max(1, Math.ceil(smallestRoom / 2) - 1);
      expect(level.top, `${label}: k of ${level.level}`).toBeGreaterThanOrEqual(lowestTop);
      expect(level.top).toBeLessThanOrEqual(Math.max(lowestTop, smallestRoom - 2));
      const stays = level.top * level.rooms.length;
      expect(level.down + level.out + stays, `${label}: players are kept`).toBe(level.players);
      expect(level.out > 0 ? isLowest : true, `${label}: only the Lower level sends players out`).toBe(true);
      expect(
        level.down > 0 ? !isLowest : true,
        `${label}: nobody moves up, and the Lower level has nobody to move down`,
      ).toBe(true);
      if (level.topGoes === 'through') waitingNext += stays;
      else if (level.topGoes === 'stay') add(level.level, stays);
      else waitingNext += stays;
      if (level.down > 0) add(round.levels[position + 1].level, level.down);
      outTotal += level.out;
    });
    if (semiDown > 0) add(round.levels[0].level, semiDown);
    expect(round.out, `${label}: players out of round ${index + 1}`).toBe(
      round.levels.reduce((total, level) => total + level.out, 0),
    );
    players.clear();
    for (const [name, count] of next) if (count > 0) players.set(name, count);
    waiting = waitingNext;
    if (isLast) {
      const left = waiting + [...players.values()].reduce((total, count) => total + count, 0);
      expect(left, `${label}: a full room is left for the last semi-final`).toBe(FULL);
    }
  });
  expect(roundsWithWaiting, `${label}: nobody sits out more than one round`).toBeLessThanOrEqual(1);
  // Bracket rounds (the last semi-final and the Final included) are the number wanted, or one fewer: 5 for two levels,
  // 6 for three, and one more when the plan says it tried a 7th round of its own.
  const extraRound = found.bracketRounds.reason.includes('one more than usual');
  const wanted = (found.levels.length === 2 ? 5 : 6) + (extraRound ? 1 : 0);
  expect(found.bracketRounds.value, `${label}: bracket rounds`).toBeGreaterThanOrEqual(wanted - 1);
  expect(found.bracketRounds.value).toBeLessThanOrEqual(wanted);
  expect(found.bracketRounds.value).toBe(found.rounds.length + 2);
  expect(found.games, `${label}: the games shown are the formats' own count`).toBe(
    bracketGames(USUAL_GAMES, found.rounds.length),
  );
  // A Middle level starts in at least two rooms.
  const middle = found.levels.find((level) => level.name === 'Middle');
  if (middle)
    expect(
      Math.ceil(middle.players / FFA.max),
      `${label}: the Middle level starts in two rooms`,
    ).toBeGreaterThanOrEqual(2);
  expect(
    found.rounds.some((round) => round.firstSemiFinal),
    `${label}: there is a first semi-final`,
  ).toBe(true);
  // Everybody in the bracket is out, in the Final, or in the last semi-final, whose top half also go to the Final.
  expect(outTotal + sentToFinal + FULL, `${label}: players are conserved`).toBe(found.inBracket.value);
  expect(found.lastSemiFinal.toFinal + sentToFinal, `${label}: the Final holds a full room`).toBe(
    found.finalPlayers,
  );
  expect(found.levels.reduce((total, level) => total + level.players, 0)).toBe(found.inBracket.value);
  const top = found.levels[0].players;
  expect(top === FULL || top >= 2 * FFA.min).toBe(true);
  expect(top).toBeLessThanOrEqual(2 * FULL);
  // The level below the top starts with at least 3/4 of the top level (16 needs 12, 14 needs 11, 12 needs 9), unless the
  // organiser typed the top level; under 20 in the bracket no top level gives that, and the top level is 12.
  if (found.topLevel.setBy === 'app') {
    if (found.inBracket.value >= 20) {
      expect(
        4 * found.levels[1].players,
        `${label}: the level below the top is at least 3/4 of it`,
      ).toBeGreaterThanOrEqual(3 * top);
    } else expect(top, `${label}: under 20 in the bracket the top level is 12`).toBe(2 * FFA.min);
  }
}

describe('every plan keeps the rules: each size in the bracket from 18 to 64', () => {
  const sizes = Array.from(
    { length: 64 - LAYERED_MIN_IN_BRACKET + 1 },
    (_, index) => LAYERED_MIN_IN_BRACKET + index,
  );
  it.each(sizes)('%i in the bracket', (size) => {
    const result = forSize(size);
    if (!result.ok) {
      // Only 18 with a top level of 16 and a lower level of 2 has no bracket; the app picks its own top level, so none.
      throw new Error(`${size}: ${result.message}`);
    }
    expectPlanKeepsTheRules(result.plan, `${size} in the bracket`);
  });
});

describe('every plan keeps the rules: each field from 18 to 80 registered', () => {
  it('plans every field the app chooses a size for, or refuses it in words', () => {
    for (let registered = 18; registered <= 80; registered += 1) {
      const result = planLayered({ registered, roomSize: FFA });
      if (!result.ok) {
        expect(result.message.length, `${registered}: the refusal says something`).toBeGreaterThan(20);
        continue;
      }
      expectPlanKeepsTheRules(result.plan, `${registered} registered`);
    }
  });

  it('plans every field from 20 to 80 who play', () => {
    for (let play = 20; play <= 80; play += 1) {
      const result = forPlay(play);
      expect(result.ok, `${play} who play`).toBe(true);
      if (result.ok) expectPlanKeepsTheRules(result.plan, `${play} who play`);
    }
  });
});

describe('a 7th bracket round of its own, when the usual number cannot seat the share', () => {
  it('gives 60 in 7 bracket rounds for 80 registered: 16, 12 and 32, one room where more than half do not stay, 14 games', () => {
    const found = forRegistered(80);
    expect(found.play.value).toBe(72);
    expect(found.inBracket.value).toBe(60);
    expect(found.levels.map((level) => level.players)).toEqual([16, 12, 32]);
    expect(found.bracketRounds.value).toBe(7);
    expect(found.bracketRounds.setBy).toBe('app');
    expect(found.bracketRounds.reason).toContain('one more than usual');
    expect(found.bracketRounds.reason).toContain('only 52');
    expect(found.longShotRooms).toBe(1);
    expect(found.lastResortRooms).toBe(0);
    expect(found.games).toBe(14);
  });

  it('keeps 52 in 6 bracket rounds for 72 registered (65 play): 52 is over 75% of them', () => {
    const found = forRegistered(72);
    expect(found.play.value).toBe(65);
    expect(found.inBracket.value).toBe(52);
    expect(found.bracketRounds.value).toBe(6);
    expect(found.bracketRounds.reason).not.toContain('one more than usual');
  });

  it('is tried for 70 to 75 who play and for nobody else', () => {
    const extra = Array.from({ length: 61 }, (_, index) => 20 + index).filter((play) => {
      const result = forPlay(play);
      return result.ok && result.plan.bracketRounds.reason.includes('one more than usual');
    });
    expect(extra).toEqual([70, 71, 72, 73, 74, 75]);
  });

  it('is turned off by a typed number of bracket rounds', () => {
    const six = plan({ registered: 80, roomSize: FFA, typed: { bracketRounds: 6 } });
    expect(six.inBracket.value).toBe(52);
    expect(six.bracketRounds.value).toBe(6);
    expect(six.bracketRounds.setBy).toBe('organiser');
    const seven = plan({ registered: 80, roomSize: FFA, typed: { bracketRounds: 7 } });
    expect(seven.inBracket.value).toBe(60);
    expect(seven.bracketRounds).toEqual({ value: 7, setBy: 'organiser', reason: '' });
  });

  it('is not used when the longer bracket has more rooms of a last-resort size or more where more than half do not stay', () => {
    // Rooms of 5 to 6: 67 registered (60 play) seat 40 in two levels, under 75%; a 6th round gives a size with 3 more such rooms.
    const found = plan({ registered: 67, roomSize: { min: 5, max: 6, ideal: 6 } });
    expect(found.bracketRounds.reason).not.toContain('one more than usual');
    expect(found.bracketRounds.value).toBeLessThanOrEqual(5);
    expect(found.inBracket.value).toBeLessThan(Math.ceil((3 * found.play.value) / 4));
  });

  it('is not tried when the organiser typed the size of the bracket', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 52 } });
    expect(found.bracketRounds.value).toBe(6);
    expect(found.bracketRounds.reason).not.toContain('one more than usual');
  });
});

describe('the level below the top has at least 3/4 of the top level', () => {
  it.each([
    [24, [12, 12]],
    [25, [12, 13]],
    [26, [14, 12]],
    [27, [14, 13]],
    [28, [16, 12]],
  ])('%i in the bracket: levels %j', (size, levels) => {
    const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size } });
    expect(found.levels.map((level) => level.players)).toEqual(levels);
    expect(found.topLevel.setBy).toBe('app');
  });

  it('makes the top level 12 where no top level gives it: 18 and 19 in the bracket', () => {
    for (const size of [18, 19]) {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size } });
      expect(found.topLevel.value).toBe(12);
    }
  });

  it('gives the Middle level of three levels 3/4 of the top level as well: 12 or more under a top of 16', () => {
    for (let size = 41; size <= 64; size += 1) {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size } });
      if (found.levels.length === 3) expect(4 * found.levels[1].players).toBeGreaterThanOrEqual(3 * 16);
    }
  });

  it('turns a Middle level under 3/4 of the top into two levels: rooms of 5 to 8, 60 registered give 16 and 24, not 16, 10 and 16', () => {
    // With rooms of 5 to 8 a Middle level of 10 (two rooms of 5) seats, so only the 3/4 rule (12 under a top of 16) refuses it.
    const found = plan({ registered: 60, roomSize: { min: 5, max: 8, ideal: 8 } });
    expect(found.inBracket.value).toBe(40);
    expect(found.levels.map((level) => level.players)).toEqual([16, 24]);
    expect(found.levelCount.value).toBe(2);
  });

  it('says in words why the top level is 12 for 19 in the bracket: the level below a 16 would have 3', () => {
    const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 19 } });
    expect(found.levels.map((level) => level.players)).toEqual([12, 7]);
    expect(found.topLevel.reason).toBe(
      '12 in two equal rooms: with 16 on top the level below would have 3, under 3/4 of 16',
    );
  });

  it('keeps a top level the organiser typed, even when the level below is smaller than 3/4 of it', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 22, topLevel: 16 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 6]);
    expect(found.topLevel).toEqual({ value: 16, setBy: 'organiser', reason: '' });
  });
});

describe('a top level of one full room, the first semi-final in the first bracket round', () => {
  const sized = (size: number, typed = {}) =>
    plan({ registered: 90, roomSize: FFA, typed: { inBracket: size, ...typed } });

  it('plans 20 in the bracket as 8 and 12: Semi A waits, the Lower level plays 6 and 6, then a full room', () => {
    const found = sized(20);
    expect(found.levels.map((level) => [level.name, level.players])).toEqual([
      ['Upper', 8],
      ['Lower', 12],
    ]);
    expect(found.rounds.map(roundText)).toEqual([
      'semi wait; Lower 2x6 top 4 stay (4 out)',
      'Lower 8 top 4 last-semi (4 out)',
    ]);
    expect(found.rounds.map((round) => round.waiting)).toEqual([0, 4]);
    expect(found.bracketRounds.value).toBe(4);
    expect(found.lastResortRooms + found.longShotRooms).toBe(0);
  });

  it('plans 21, 22 and 23 in the bracket as 8 with 13, 14 and 15 below, with no room of a last-resort size', () => {
    expect(sized(21).rounds[0].levels[0].rooms).toEqual([7, 6]);
    expect(sized(22).rounds[0].levels[0].rooms).toEqual([7, 7]);
    expect(sized(23).rounds[0].levels[0].rooms).toEqual([8, 7]);
    for (const size of [21, 22, 23]) {
      expect(sized(size).levels.map((level) => level.players)).toEqual([8, size - 8]);
      expect(sized(size).lastResortRooms).toBe(0);
    }
  });

  it('keeps 12 on top at 18 and 19 in the bracket (8 and 10, 8 and 11 would need rooms of a last-resort size) and at 24', () => {
    const tops = (size: number) => sized(size).levels.map((level) => level.players);
    expect(tops(18)).toEqual([12, 6]);
    expect(tops(19)).toEqual([12, 7]);
    expect(tops(24)).toEqual([12, 12]);
  });

  it('says in words that it is one room and why two rooms on top were not used', () => {
    expect(sized(20).topLevel).toEqual({
      value: 8,
      setBy: 'app',
      reason:
        '8 in one room, which is Semi A: with two rooms on top the level below would be under 3/4 of the top level or need rooms of a last-resort size',
    });
  });

  it('takes a typed top of one full room as typed, in two levels only', () => {
    const found = sized(24, { topLevel: 8 });
    expect(found.levels.map((level) => level.players)).toEqual([8, 16]);
    expect(found.topLevel).toEqual({ value: 8, setBy: 'organiser', reason: '' });
    expect(found.rounds[0].firstSemiFinal).not.toBeNull();
    expect(forSize(48, { topLevel: 8, levels: 3 }).ok).toBe(false);
    const refused = planLayered({ registered: 90, roomSize: FFA, typed: { topLevel: 10 } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('one full room: 8');
  });

  it('leaves the first semi-final out of the first bracket round for every other top level', () => {
    for (let size = 24; size <= 40; size += 1) {
      expect(sized(size).rounds[0].firstSemiFinal, `${size} in the bracket`).toBeNull();
    }
  });

  it('follows the room size: with rooms of 5 to 6, 18 in the bracket are one room of 6 and 12 below', () => {
    const found = plan({ registered: 90, roomSize: { min: 5, max: 6, ideal: 6 }, typed: { inBracket: 18 } });
    expect(found.levels.map((level) => level.players)).toEqual([6, 12]);
    expect(found.rounds[0].firstSemiFinal).not.toBeNull();
  });

  it('has the size per field from 20 to 34 who play', () => {
    const sizes = Array.from({ length: 15 }, (_, index) => {
      const result = forPlay(20 + index);
      return result.ok ? result.plan.inBracket.value : null;
    });
    expect(sizes).toEqual([18, 18, 18, 19, 20, 21, 22, 22, 23, 23, 23, 26, 27, 28, 28]);
  });
});

describe('the plan does not depend on anything but its input', () => {
  it('gives the same plan twice, and is not changed by the room size object being reused', () => {
    const first = planLayered({ registered: 43, roomSize: FFA });
    const second = planLayered({ registered: 43, roomSize: { ...FFA } });
    expect(second).toEqual(first);
    expect(FFA).toEqual({ min: 6, max: 8, ideal: 8 });
  });
});
