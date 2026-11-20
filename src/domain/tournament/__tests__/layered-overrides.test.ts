import { describe, expect, it } from 'vitest';
import { bracketLogicOf } from '../app-written-bracket';
import { layeredTypedOf, planLayeredFor, parseTopCounts, topCountsText, withTopCount } from '../layered-form';
import { planLayered, type LayeredTyped } from '../layered-plan';
import { createDefaultSetup } from '../state-defaults';
import {
  expectEveryUnitRankedOnce,
  playDependency,
  playToBracketEntry,
  STRATEGIES,
} from './dependency-play-fixtures';
import {
  FFA_QUAL,
  FFA_ROOM,
  FIRST_ROUND,
  built,
  generate,
  plannedRounds,
  seatedRooms,
} from './layered-test-support';
import type { Setup } from './test-fixtures';

/**
 * What the organiser can type over the app's numbers for the top places of each room (per round and level) and for the
 * other half of Semi-Final A: the plan takes them as typed and designs the rest, refuses one it cannot use with the
 * numbers that can be, and marks one that refers to a round or level the plan no longer has.
 */

type Count = { round: number; level: 'Upper' | 'Middle' | 'Lower'; top: number };

const plan = (registered: number, typed: LayeredTyped = {}) =>
  planLayered({ registered, roomSize: FFA_ROOM, firstRound: FIRST_ROUND, typed });

function planned(registered: number, typed: LayeredTyped) {
  const result = plan(registered, typed);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

const topOf = (plan: ReturnType<typeof planned>, count: Count) =>
  plan.rounds[count.round]?.levels.find((level) => level.level === count.level)?.top;

/** One number typed for the top places of one round and level, per awkward count, each of which the app can keep. */
const ALONE: Array<[number, Count]> = [
  [31, { round: 1, level: 'Lower', top: 3 }],
  [37, { round: 0, level: 'Upper', top: 6 }],
  [43, { round: 0, level: 'Lower', top: 6 }],
  [53, { round: 1, level: 'Lower', top: 4 }],
  [53, { round: 2, level: 'Lower', top: 2 }],
];

describe('the other half of Semi-Final A, typed', () => {
  it.each([31, 37, 43, 53])('%i registered: play on and wait are each taken as typed', (registered) => {
    for (const semiOthers of ['play-on', 'wait'] as const) {
      const found = planned(registered, { semiOthers });
      expect(found.semiOthers, `${registered} ${semiOthers}`).toEqual({
        value: semiOthers,
        setBy: 'organiser',
      });
    }
  });

  it("is the app's own when nothing is typed", () => {
    expect(planned(31, {}).semiOthers).toEqual({ value: 'wait', setBy: 'app' });
    expect(planned(53, {}).semiOthers).toEqual({ value: 'play-on', setBy: 'app' });
  });
});

describe('the top places of each room, typed for one round and level', () => {
  it.each(ALONE)(
    '%i registered: %j is taken as typed, applies, and the plan seats everyone',
    (registered, count) => {
      const found = planned(registered, { topCounts: [count] });
      expect(topOf(found, count)).toBe(count.top);
      expect(found.topCounts).toEqual([{ ...count, applies: true }]);
      for (const round of found.rounds) {
        for (const level of round.levels) {
          expect(level.rooms.reduce((total, size) => total + size, 0)).toBe(level.players);
        }
      }
    },
  );

  it('is the number the app would have chosen when it is the same: nothing else changes', () => {
    const base = planned(53, {});
    const same = planned(53, { topCounts: [{ round: 0, level: 'Lower', top: 5 }] });
    expect(same.rounds).toEqual(base.rounds);
    expect(same.levels).toEqual(base.levels);
  });

  it('keeps the app designing the rest around it: a typed top changes what follows, not the number in the bracket', () => {
    const base = planned(53, {});
    const typed = planned(53, { topCounts: [{ round: 0, level: 'Lower', top: 4 }] });
    expect(typed.rounds[0].levels[1].top).toBe(4);
    expect(typed.rounds[1].levels[0].rooms).not.toEqual(base.rounds[1].levels[0].rooms);
    expect(typed.inBracket.value).toBe(base.inBracket.value);
  });
});

describe('two typed numbers together', () => {
  const together: Array<[number, LayeredTyped]> = [
    [
      31,
      {
        topCounts: [
          { round: 0, level: 'Lower', top: 3 },
          { round: 1, level: 'Lower', top: 3 },
        ],
      },
    ],
    [37, { semiOthers: 'wait', topCounts: [{ round: 0, level: 'Lower', top: 3 }] }],
    [
      43,
      {
        topCounts: [
          { round: 0, level: 'Upper', top: 6 },
          { round: 1, level: 'Lower', top: 5 },
        ],
      },
    ],
    [53, { semiOthers: 'wait', topCounts: [{ round: 0, level: 'Upper', top: 6 }] }],
  ];

  it.each(together)('%i registered: both are kept', (registered, typed) => {
    const found = planned(registered, typed);
    for (const count of typed.topCounts ?? []) expect(topOf(found, count)).toBe(count.top);
    if (typed.semiOthers) expect(found.semiOthers.setBy).toBe('organiser');
    expect(found.topCounts.every((entry) => entry.applies)).toBe(true);
  });
});

describe('a typed size', () => {
  it('of 28 at 37 registered gives levels 16 and 12', () => {
    const found = planned(37, { inBracket: 28 });
    expect(found.levels.map((level) => [level.name, level.players])).toEqual([
      ['Upper', 16],
      ['Lower', 12],
    ]);
    expect(found.inBracket).toEqual({ value: 28, setBy: 'organiser', reason: '' });
  });

  it('that cannot be seated names its neighbours that can', () => {
    expect(plan(37, { inBracket: 20, topLevel: 16 })).toEqual({
      ok: false,
      message:
        'No layered bracket seats 20 in the bracket in 4 or 5 bracket rounds. 21 in the bracket can be seated; or try another number of bracket rounds.',
    });
    expect(plan(37, { inBracket: 18, bracketRounds: 7 })).toEqual({
      ok: false,
      message:
        'No layered bracket seats 18 in the bracket in 6 or 7 bracket rounds. 28 in the bracket can be seated; or try another number of bracket rounds.',
    });
    expect(plan(80, { inBracket: 50, bracketRounds: 4 })).toMatchObject({
      ok: false,
      message: expect.stringContaining('48 in the bracket can be seated'),
    });
  });
});

describe('a typed number the plan cannot use is refused, with the numbers that can be', () => {
  it.each([
    [
      53,
      { round: 0, level: 'Lower', top: 7 },
      'The top 7 of each room cannot be used in Round 4 - Lower; 6 can.',
    ],
    [
      37,
      { round: 0, level: 'Upper', top: 5 },
      'The top 5 of each room cannot be used in Round 4 - Upper; 4 or 6 can.',
    ],
    [
      37,
      { round: 0, level: 'Upper', top: 3 },
      'The top 3 of each room cannot be used in Round 4 - Upper; 4 can.',
    ],
    [
      80,
      { round: 2, level: 'Middle', top: 1 },
      'The top 1 of each room cannot be used in Round 6 - Middle; 2 can.',
    ],
    [
      43,
      { round: 2, level: 'Lower', top: 3 },
      'The top 3 of each room cannot be used in Round 6 - Lower; 4 can.',
    ],
  ] as Array<[number, Count, string]>)('%i registered, %j', (registered, count, message) => {
    expect(plan(registered, { topCounts: [count] })).toEqual({ ok: false, message });
  });

  it('names the round by its number after the table rounds', () => {
    const result = planLayered({
      registered: 53,
      roomSize: FFA_ROOM,
      firstRound: 5,
      typed: { topCounts: [{ round: 0, level: 'Lower', top: 7 }] },
    });
    expect(result).toEqual({
      ok: false,
      message: 'The top 7 of each room cannot be used in Round 5 - Lower; 6 can.',
    });
  });

  it('names the first of two typed numbers that cannot be used', () => {
    expect(
      plan(53, {
        topCounts: [
          { round: 0, level: 'Lower', top: 6 },
          { round: 0, level: 'Upper', top: 3 },
        ],
      }),
    ).toEqual({ ok: false, message: 'The top 3 of each room cannot be used in Round 4 - Upper; 4 can.' });
  });

  it('is the same with a typed size', () => {
    expect(plan(53, { inBracket: 40, topCounts: [{ round: 0, level: 'Lower', top: 7 }] })).toEqual({
      ok: false,
      message: 'The top 7 of each room cannot be used in Round 4 - Lower; 6 can.',
    });
  });
});

describe('a typed number for a round or level the plan does not have no longer applies', () => {
  it('31 registered has no Middle level: the number stays in the plan, marked, and nothing else changes', () => {
    const base = planned(31, {});
    const found = planned(31, { topCounts: [{ round: 1, level: 'Middle', top: 3 }] });
    expect(found.topCounts).toEqual([{ round: 1, level: 'Middle', top: 3, applies: false }]);
    expect(found.rounds).toEqual(base.rounds);
  });

  it('a round the bracket does not have', () => {
    const found = planned(31, { topCounts: [{ round: 6, level: 'Lower', top: 3 }] });
    expect(found.topCounts[0].applies).toBe(false);
  });

  it('is told by the form, which also lists a line that names no round of a bracket', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'layered',
      ...FFA_QUAL,
      layeredTopCounts: 'Round 5 - Middle: 3\nRound 2 - Lower: 4\nbanana: 2',
    });
    const result = planLayeredFor(form, 31);
    if (!result.ok) throw new Error(result.message);
    expect(result.plan.topCounts).toEqual([{ round: 1, level: 'Middle', top: 3, applies: false }]);
    expect(result.orphans).toEqual([
      { name: 'Round 2 - Lower', top: '4' },
      { name: 'banana', top: '2' },
    ]);
  });
});

describe('the typed top places in the form', () => {
  it('are lines, read in order, and written back as they were', () => {
    const text = 'Round 6 - Middle: 3\nRound 4 - Lower: 4';
    expect(parseTopCounts(text)).toEqual([
      { name: 'Round 6 - Middle', top: '3' },
      { name: 'Round 4 - Lower', top: '4' },
    ]);
    expect(topCountsText(parseTopCounts(text))).toBe(text);
  });

  it('set, replace and clear one line, keeping the others', () => {
    let text = withTopCount('', 'Round 4 - Lower', '4');
    text = withTopCount(text, 'Round 5 - Lower', '3');
    expect(text).toBe('Round 4 - Lower: 4\nRound 5 - Lower: 3');
    text = withTopCount(text, 'Round 4 - Lower', '5');
    expect(text).toBe('Round 4 - Lower: 5\nRound 5 - Lower: 3');
    expect(withTopCount(text, 'Round 4 - Lower', '')).toBe('Round 5 - Lower: 3');
  });

  it('are mapped to rounds by the first bracket round: Round 6 is the third bracket round after three table rounds, the second after four', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'layered',
      ...FFA_QUAL,
      layeredTopCounts: 'Round 6 - Middle: 3',
    });
    expect(layeredTypedOf(form, 4)).toMatchObject({
      typed: { topCounts: [{ round: 2, level: 'Middle', top: 3 }] },
    });
    expect(layeredTypedOf(form, 5)).toMatchObject({
      typed: { topCounts: [{ round: 1, level: 'Middle', top: 3 }] },
    });
  });

  it('refuse a number that is no number, naming the round', () => {
    const form = createDefaultSetup({
      scheduleLogic: 'layered',
      ...FFA_QUAL,
      layeredTopCounts: 'Round 4 - Lower: x',
    });
    expect(layeredTypedOf(form, 4)).toEqual({
      ok: false,
      message: 'The top places of each room for Round 4 - Lower must be a whole number — got "x".',
    });
  });

  it('read the choice for the other half of Semi-Final A', () => {
    const form = createDefaultSetup({ scheduleLogic: 'layered', ...FFA_QUAL });
    expect(layeredTypedOf({ ...form, layeredSemiOthers: 'wait' }, 4)).toMatchObject({
      typed: { semiOthers: 'wait' },
    });
  });
});

describe('generating with the typed top places and the other half of Semi-Final A', () => {
  const FORMS: Array<[string, number, Setup]> = [
    ['31, the top 3 of each room in Round 5 - Lower', 31, { layeredTopCounts: 'Round 5 - Lower: 3' }],
    ['31, the other half plays on', 31, { layeredSemiOthers: 'play-on' }],
    ['37, the top 6 of each room in Round 4 - Upper', 37, { layeredTopCounts: 'Round 4 - Upper: 6' }],
    ['37, the other half waits', 37, { layeredSemiOthers: 'wait' }],
    ['43, the top 6 of each room in Round 4 - Lower', 43, { layeredTopCounts: 'Round 4 - Lower: 6' }],
    [
      '43, both: Round 4 - Upper 6 and Round 5 - Lower 5',
      43,
      { layeredTopCounts: 'Round 4 - Upper: 6\nRound 5 - Lower: 5' },
    ],
    ['53, the top 4 of each room in Round 5 - Lower', 53, { layeredTopCounts: 'Round 5 - Lower: 4' }],
    [
      '53, both: the other half waits and Round 4 - Upper 6',
      53,
      { layeredSemiOthers: 'wait', layeredTopCounts: 'Round 4 - Upper: 6' },
    ],
  ];

  it.each(FORMS)(
    '%s: stays a layered bracket, every round is drawn at the planned size, and it plays to the Final',
    (_what, registered, setup = {}) => {
      const state = built(registered, { ...FFA_QUAL, ...setup });
      expect(bracketLogicOf(state)).toBe('layered');
      expect(state.settings).toMatchObject({
        layeredTopCounts: setup.layeredTopCounts ?? '',
        layeredSemiOthers: setup.layeredSemiOthers ?? '',
      });
      const form = createDefaultSetup({ scheduleLogic: 'layered', ...FFA_QUAL, ...setup });
      const result = planLayeredFor(form, registered);
      if (!result.ok) throw new Error(result.message);
      const played = playDependency(playToBracketEntry(state), STRATEGIES['all at once']);
      for (const { name, rooms } of plannedRounds(result.plan)) {
        expect(seatedRooms(played, name), `${registered} registered, ${name}`).toEqual(rooms);
      }
      expectEveryUnitRankedOnce(played, registered);
    },
  );

  it('refuses a number the plan cannot use, in words, before anything is drawn', () => {
    expect(generate(53, { ...FFA_QUAL, layeredTopCounts: 'Round 4 - Lower: 7' })).toEqual({
      status: 'invalid',
      message: 'The top 7 of each room cannot be used in Round 4 - Lower; 6 can.',
    });
  });

  it('a typed number that no longer applies does not stop the tournament', () => {
    const state = built(31, { ...FFA_QUAL, layeredTopCounts: 'Round 5 - Middle: 3' });
    expect(bracketLogicOf(state)).toBe('layered');
  });
});
