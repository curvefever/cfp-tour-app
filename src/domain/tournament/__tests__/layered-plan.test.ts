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
      levels: [16, 7],
      games: 12,
      rounds: [
        'Upper 2x8 top 4 stay (8 down); Lower 7 top 5 stay (2 out)',
        'semi wait; Lower 7+6 top 4 stay (5 out)',
        'Lower 8 top 4 last-semi (4 out)',
      ],
      waiting: [0, 0, 4],
    },
    {
      registered: 37,
      play: 33,
      inBracket: 24,
      levels: [16, 8],
      games: 12,
      rounds: [
        'Upper 2x8 top 4 stay (8 down); Lower 8 top 6 stay (2 out)',
        'semi wait; Lower 2x7 top 4 stay (6 out)',
        'Lower 8 top 4 last-semi (4 out)',
      ],
      waiting: [0, 0, 4],
    },
    {
      registered: 43,
      play: 39,
      inBracket: 32,
      levels: [16, 16],
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
    '$registered registered: $play play, $inBracket in the bracket, levels $levels, $games games',
    ({ registered, play, inBracket, levels, games, rounds, waiting }) => {
      const found = forRegistered(registered);
      expect(found.play.value).toBe(play);
      expect(found.inBracket.value).toBe(inBracket);
      expect(found.levels.map((level) => level.players)).toEqual(levels);
      expect(found.levels.map((level) => level.name)).toEqual(['Upper', 'Lower']);
      expect(found.games.value).toBe(games);
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
  const pinned: Array<[number, number]> = [
    [22, 18],
    [23, 19],
    [24, 20],
    [25, 20],
    [26, 22],
    [27, 22],
    [28, 23],
    ...[29, 30, 31, 32, 33, 34].map((play): [number, number] => [play, 24]),
    [35, 29],
    [36, 30],
    [37, 31],
    ...[38, 39, 40, 41, 42, 43, 44, 45].map((play): [number, number] => [play, 32]),
    [46, 39],
    [47, 39],
    ...Array.from({ length: 10 }, (_, index): [number, number] => [48 + index, 40]),
  ];

  it.each(pinned)('%i who play: %i in the bracket', (play, size) => {
    const result = planLayered({ registered: play, roomSize: FFA, typed: { play } });
    expect(result.ok && result.plan.inBracket.value).toBe(size);
  });

  it('is pinned for every field from 22 to 57', () => {
    expect(pinned.map(([play]) => play)).toEqual(Array.from({ length: 36 }, (_, index) => 22 + index));
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

  it('gives 48 in the bracket, in three levels, for 58 to 60 who play, and a plan for every field up to 80', () => {
    for (const play of [58, 59, 60]) {
      const found = plan({ registered: play, roomSize: FFA, typed: { play } });
      expect(found.inBracket.value).toBe(48);
      expect(found.levels.map((level) => level.players)).toEqual([16, 16, 16]);
      expect(found.levelCount.value).toBe(3);
    }
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

describe('a top level of 16 may play two rounds before its room: 16, then 12, then a full room of 8', () => {
  it('plans 22 in the bracket in full: nobody waits, the first semi-final is the third round', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 22 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 6]);
    expect(found.games.value).toBe(12);
    expect(found.rounds.map((round) => round.out)).toEqual([2, 4, 4]);
    expect(found.rounds.map((round) => round.waiting)).toEqual([0, 0, 0]);
    expect(found.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 6 stay (4 down); Lower 6 top 4 stay (2 out)',
      'Upper 2x6 top 4 stay (4 down); Lower 8 top 4 stay (4 out)',
      'semi last-semi; Lower 8 top 4 last-semi (4 out)',
    ]);
  });

  it('gives 22 in the bracket for 29 registered (26 who play)', () => {
    const found = forRegistered(29);
    expect(found.play.value).toBe(26);
    expect(found.inBracket.value).toBe(22);
    expect(found.rounds.map(roundText)).toEqual(
      plan({ registered: 80, roomSize: FFA, typed: { inBracket: 22 } }).rounds.map(roundText),
    );
  });

  it('plans a typed top of 16 at 21 in the bracket in full: out 2, 3, 4', () => {
    const found = plan({ registered: 80, roomSize: FFA, typed: { inBracket: 21, topLevel: 16 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 5]);
    expect(found.games.value).toBe(12);
    expect(found.rounds.map((round) => round.out)).toEqual([2, 3, 4]);
    expect(found.rounds.map(roundText)).toEqual([
      'Upper 2x8 top 6 stay (4 down); Lower 5 top 3 stay (2 out)',
      'Upper 2x6 top 4 stay (4 down); Lower 7 top 4 stay (3 out)',
      'semi last-semi; Lower 8 top 4 last-semi (4 out)',
    ]);
    expect(found.lastResortRooms).toBe(1);
  });
});

describe('three levels, 13 games: 41 to 48 in the bracket', () => {
  it.each([
    [41, [16, 7, 18], [6, 7, 12, 4]],
    [42, [16, 8, 18], [6, 8, 12, 4]],
    [43, [16, 8, 19], [7, 8, 12, 4]],
    [44, [16, 8, 20], [8, 8, 12, 4]],
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
      expect(found.games.value).toBe(13);
      expect(found.levelCount).toMatchObject({ value: 3, setBy: 'app' });
      expect(found.longShotRooms).toBe(4);
    },
  );

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

  it('plans 36 with three levels and 14 games as 16, 12 and 8 (the 15 Nov levels)', () => {
    const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 36, levels: 3, games: 14 } });
    expect(found.levels.map((level) => level.players)).toEqual([16, 12, 8]);
    expect(found.games.value).toBe(14);
    expect(found.rounds.map((round) => round.out)).toEqual([4, 4, 6, 6, 4]);
    expect(found.levelCount).toEqual({ value: 3, setBy: 'organiser', reason: '' });
  });

  it('has no room where more than half do not stay for 44 and 48 at 14 games', () => {
    for (const size of [44, 48]) {
      const found = plan({ registered: 90, roomSize: FFA, typed: { inBracket: size, games: 14 } });
      expect(found.longShotRooms, `${size} at 14 games`).toBe(0);
    }
  });

  it('takes three levels for a larger bracket than 40 and for a typed 3, and two for a typed 2', () => {
    expect(plan({ registered: 90, roomSize: FFA, typed: { inBracket: 41 } }).levelCount.value).toBe(3);
    const three = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 36, levels: 3 } });
    expect(three.levels.map((level) => level.players)).toEqual([16, 8, 12]);
    expect(three.games.value).toBe(13);
    const two = plan({ registered: 90, roomSize: FFA, typed: { inBracket: 44, levels: 2 } });
    expect(two.levels).toHaveLength(2);
    expect(two.games.value).toBeLessThanOrEqual(12);
    expect(two.levelCount).toEqual({ value: 2, setBy: 'organiser', reason: '' });
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
    [19, [13, 6], [3, 4], 11],
    [20, [12, 8], [4, 4], 11],
    [22, [16, 6], [2, 4, 4], 12],
    [28, [16, 12], [4, 4, 8], 12],
    [36, [16, 20], [8, 8, 8], 12],
  ])('%i in the bracket: levels %j, out per round %j', (size, levels, outs, games) => {
    const result = forSize(size);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.levels.map((level) => level.players)).toEqual(levels);
    expect(result.plan.rounds.map((round) => round.out)).toEqual(outs);
    expect(result.plan.games.value).toBe(games);
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
    const found = forRegistered(31);
    for (const number of [found.play, found.inBracket, found.games, found.levelCount, found.topLevel]) {
      expect(number.setBy).toBe('app');
      expect(number.reason.length).toBeGreaterThan(10);
    }
    expect(found.play.reason).toBe('9 in 10 of the 31 registered');
    const typed = plan({
      registered: 37,
      roomSize: FFA,
      typed: { play: 30, inBracket: 26, games: 12, topLevel: 14 },
    });
    expect(typed.play).toEqual({ value: 30, setBy: 'organiser', reason: '' });
    expect(typed.inBracket).toEqual({ value: 26, setBy: 'organiser', reason: '' });
    expect(typed.topLevel).toEqual({ value: 14, setBy: 'organiser', reason: '' });
    expect(typed.games.setBy).toBe('organiser');
    expect(typed.levels.map((level) => level.players)).toEqual([14, 12]);
  });

  it('says in words why a top level is not 16', () => {
    const found = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 21 } });
    expect(found.topLevel.value).toBe(14);
    expect(found.topLevel.reason).toContain('does not seat');
  });

  it('counts games from the formats: the table, one a bracket round, the semi-finals and the Final', () => {
    expect(bracketGames(USUAL_GAMES, 3)).toBe(12);
    expect(bracketGames(USUAL_GAMES, 4)).toBe(13);
    expect(bracketGames({ table: 3, semis: 1, final: 3 }, 3)).toBe(10);
    expect(plan({ registered: 31, roomSize: FFA, games: { table: 3, semis: 1, final: 3 } }).games.value).toBe(
      10,
    );
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
    expect(refused({ topLevel: 11 })).toContain('from 12 to 16');
    expect(refused({ topLevel: 17 })).toContain('from 12 to 16');
  });

  it('refuses a size that seats in no bracket, and a game limit no bracket fits', () => {
    const noSeat = forSize(18, { topLevel: 16 });
    expect(noSeat.ok).toBe(false);
    if (!noSeat.ok) expect(noSeat.message).toContain('No layered bracket seats 18 in the bracket');
    const tooFew = forSize(24, { games: 9 });
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.message).toContain('within 9 games');
  });

  it('keeps the games the organiser allows as a limit, and the nearest bracket under it', () => {
    const found = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 24, games: 12 } });
    expect(found.games).toEqual({ value: 12, setBy: 'organiser', reason: '' });
    const fewer = plan({ registered: 60, roomSize: FFA, typed: { inBracket: 18, games: 12 } });
    expect(fewer.games.value).toBe(11);
    expect(fewer.games.reason).toContain('allow is 12');
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
  expect(first.firstSemiFinal, `${label}: the first semi-final is not the first bracket round`).toBeNull();
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
  const usualRounds = found.levels.length === 2 ? 3 : 4;
  expect(found.rounds.length, `${label}: rounds`).toBeLessThanOrEqual(usualRounds);
  // One round fewer than the usual number is allowed, and no more.
  expect(found.games.value, `${label}: games`).toBeGreaterThanOrEqual(
    bracketGames(USUAL_GAMES, usualRounds) - 1,
  );
  expect(found.games.value).toBeLessThanOrEqual(bracketGames(USUAL_GAMES, usualRounds));
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
  expect(top).toBeGreaterThanOrEqual(2 * FFA.min);
  expect(top).toBeLessThanOrEqual(2 * FULL);
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

describe('the plan does not depend on anything but its input', () => {
  it('gives the same plan twice, and is not changed by the room size object being reused', () => {
    const first = planLayered({ registered: 43, roomSize: FFA });
    const second = planLayered({ registered: 43, roomSize: { ...FFA } });
    expect(second).toEqual(first);
    expect(FFA).toEqual({ min: 6, max: 8, ideal: 8 });
  });
});
