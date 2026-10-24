import { describe, expect, it } from 'vitest';
import { buildAdvancementTiers } from '../advancement';
import { removeRosterUnit } from '../mutations';
import {
  isFullFieldRound,
  seatsPerTier,
  smallerRoomSeatsBefore,
  splitByFinishingPlace,
  splitForSmallerRooms,
} from '../smaller-room-seats';
import type { TournamentRound, TournamentState } from '../types';
import {
  advanceScored,
  playToRound,
  spreadConfig,
  startSpread,
  type Places,
  type SpreadKind,
} from './spread-play';

/** After eliminations the smaller-room seats are shared between the finishing places in proportion to their size. */

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function tierMembers(sizes: number[]) {
  return sizes.flatMap((size, tierRank) =>
    Array.from({ length: size }, (_, index) => ({ name: `T${tierRank}-${index}`, tierRank })),
  );
}

describe('seatsPerTier', () => {
  it('3 firsts, 3 seconds, 3 thirds and 1 lucky loser into 6 smaller seats get 2, 2, 2, 0', () => {
    expect(seatsPerTier([3, 3, 3, 1], 6)).toEqual([2, 2, 2, 0]);
  });

  it('5 firsts, 5 seconds and 4 lucky losers into [4,4,3,3] (6 seats) get 2, 2, 2', () => {
    expect(seatsPerTier([5, 5, 4], 6)).toEqual([2, 2, 2]);
  });

  it('gives the leftover seats to the largest fractional parts, the better tier first on equal parts', () => {
    expect(seatsPerTier([4, 4, 4], 4)).toEqual([2, 1, 1]);
    expect(seatsPerTier([6, 2], 4)).toEqual([3, 1]);
    expect(seatsPerTier([1, 5], 3)).toEqual([1, 2]);
  });

  // Tier sizes of a cut round at an awkward count: [units in the round, tiers (rooms per place), smaller seats].
  it.each<[string, number[], number]>([
    ['31 units into [4,4,4,4,4,4,4,3] -> 24 survive', [6, 6, 6, 6], 3],
    ['37 units, rooms of 3 and 4', [10, 10, 9, 8], 9],
    ['43 units, a lucky-loser tier of 2', [11, 11, 11, 10, 2], 9],
    ['53 units, 3 smaller rooms', [14, 14, 14, 11], 9],
    ['a single tier', [17], 9],
    ['a tier of one', [1, 8, 8], 6],
  ])('%s: the shares sum to the seat count and never exceed a tier', (_name, sizes, seatCount) => {
    const shares = seatsPerTier(sizes, seatCount);
    expect(sum(shares)).toBe(seatCount);
    shares.forEach((share, tier) => {
      expect(share).toBeLessThanOrEqual(sizes[tier]);
      const exact = (seatCount * sizes[tier]) / sum(sizes);
      expect(share).toBeGreaterThanOrEqual(Math.floor(exact));
      expect(share).toBeLessThanOrEqual(Math.ceil(exact));
    });
  });
});

describe('splitByFinishingPlace', () => {
  const names = (group: Array<{ name: string }>) => group.map((member) => member.name);

  it('is null when every room is the same size', () => {
    expect(splitByFinishingPlace(tierMembers([4, 4]), [4, 4], {}, new Set())).toBeNull();
  });

  it('gives each tier its share of the seats whatever the seat counts so far', () => {
    const order = tierMembers([3, 3, 3, 1]);
    // Rooms [4,3,3]: 6 smaller seats. Everyone in tier 0 already sat in a smaller room once; no one else did.
    const seats = Object.fromEntries(order.filter((member) => member.tierRank === 0).map((m) => [m.name, 1]));
    const split = splitByFinishingPlace(order, [4, 3, 3], seats, new Set());
    expect(split?.smallRooms).toEqual([2, 3]);
    const tierOf = (name: string) => order.find((member) => member.name === name)?.tierRank;
    const perTier = [0, 1, 2, 3].map(
      (tier) => names(split?.small ?? []).filter((n) => tierOf(n) === tier).length,
    );
    expect(perTier).toEqual([2, 2, 2, 0]);
    // The whole-field split would have given tier 0 nothing.
    const whole = splitForSmallerRooms(order, [4, 3, 3], seats, new Set());
    expect(names(whole?.small ?? []).filter((n) => tierOf(n) === 0)).toHaveLength(0);
  });

  it('a place shared by several units is one tier', () => {
    // Two units tied for 2nd of their rooms share tier 1 with the others who finished 2nd.
    const order = [
      { name: 'a', tierRank: 0 },
      { name: 'b', tierRank: 0 },
      { name: 'c', tierRank: 1 },
      { name: 'd', tierRank: 1 },
    ];
    const split = splitByFinishingPlace(order, [2, 1, 1], {}, new Set());
    expect(split?.small.map((member) => member.tierRank).sort()).toEqual([0, 1]);
  });

  it('inside a tier the seats go to the units with the fewest so far, ties best first in the tier order', () => {
    const order = tierMembers([6, 6]);
    const seats = { 'T0-0': 1, 'T0-1': 1 };
    // Rooms [4,4,2,2]: 4 smaller seats, 2 per tier. Tier 0: the four with none, the first two of those.
    const split = splitByFinishingPlace(order, [4, 4, 2, 2], seats, new Set());
    const tier0 = names(split?.small ?? []).filter((name) => name.startsWith('T0'));
    expect(tier0).toEqual(['T0-2', 'T0-3']);
    expect(tier0).not.toContain('T0-0');
    expect(tier0).not.toContain('T0-1');
  });

  describe('units tied on the seats so far take them best first, in the order of their place', () => {
    const member = (name: string, tierRank: number) => ({ name, tierRank });
    const smallNames = (split: ReturnType<typeof splitByFinishingPlace>) => names(split?.small ?? []);

    it('Round 4 of the 17-team tournament: the lucky losers m (1) and h, l, g (1.5) share 2 seats: m and h', () => {
      const lucky = ['h', 'l', 'm', 'g'].map((name) => member(name, 2));
      const seats = { h: 1.5, l: 1.5, m: 1, g: 1.5 };
      const split = splitByFinishingPlace(lucky, [3, 1, 1], seats, new Set());
      expect(smallNames(split)).toEqual(['h', 'm']);
    });

    it('Round 6: the seconds o, i, d (all 1.5) take 2 seats as o, i; the thirds k, a, j as k, a', () => {
      const seconds = ['o', 'i', 'd'].map((name) => member(name, 1));
      const thirds = ['k', 'a', 'j'].map((name) => member(name, 2));
      const seats = Object.fromEntries([...seconds, ...thirds].map(({ name }) => [name, 1.5]));
      expect(smallNames(splitByFinishingPlace(seconds, [3, 1, 1], seats, new Set()))).toEqual(['o', 'i']);
      expect(smallNames(splitByFinishingPlace(thirds, [3, 1, 1], seats, new Set()))).toEqual(['k', 'a']);
    });

    it('a late joiner is still last for the seats, whatever its place in the order', () => {
      const tier = ['joiner', 'b', 'c', 'd'].map((name) => member(name, 0));
      const split = splitByFinishingPlace(tier, [3, 1, 1], {}, new Set(['joiner']));
      expect(smallNames(split)).toEqual(['b', 'c']);
    });

    it('the whole field still strides: one seat among three tied units takes the middle one', () => {
      const field = ['a', 'b', 'c'].map((name) => member(name, 0));
      expect(names(splitForSmallerRooms(field, [2, 1], {}, new Set())?.small ?? [])).toEqual(['b']);
    });
  });

  it('puts a late joiner last inside its tier', () => {
    const order = tierMembers([2, 2]);
    const split = splitByFinishingPlace(order, [2, 1, 1], {}, new Set(['T0-0']));
    expect(names(split?.small ?? [])).not.toContain('T0-0');
    expect(names(split?.small ?? [])).toContain('T0-1');
  });

  it('keeps both groups in the order given', () => {
    const order = tierMembers([5, 5, 4]);
    const split = splitByFinishingPlace(order, [4, 4, 3, 3], {}, new Set());
    for (const group of [split?.small ?? [], split?.large ?? []]) {
      const positions = group.map((member) => order.findIndex((entry) => entry.name === member.name));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe('isFullFieldRound', () => {
  const pooling = (extra: Partial<TournamentRound> = {}) =>
    ({ players: 17, advTotal: 17, isNoElim: true, isQual: true, ...extra }) as TournamentRound;
  const bracket = (players: number, advTotal: number) =>
    ({ players, advTotal, isNoElim: false }) as TournamentRound;

  it('is true for every pooling round', () => {
    const rounds = [pooling(), pooling(), pooling()];
    expect([0, 1, 2].map((index) => isFullFieldRound(rounds, index))).toEqual([true, true, true]);
  });

  it('is false for the first round after a qualification table that cuts the pool', () => {
    const rounds = [pooling(), pooling(), bracket(16, 8)];
    expect(isFullFieldRound(rounds, 2)).toBe(false);
  });

  it('is true for the first round after a qualification table that takes the whole pool', () => {
    const rounds = [pooling(), pooling(), bracket(17, 8)];
    expect(isFullFieldRound(rounds, 2)).toBe(true);
    expect(isFullFieldRound([...rounds, bracket(8, 4)], 3)).toBe(false);
  });

  it('is false after a Swiss or group-stage exit that cuts the pool', () => {
    const swiss = [pooling({ isQual: false, isSwiss: true }), bracket(8, 4)];
    expect(isFullFieldRound(swiss, 1)).toBe(false);
    const groups = [pooling({ isQual: false, isGroupStage: true }), bracket(8, 4)];
    expect(isFullFieldRound(groups, 1)).toBe(false);
  });

  it('is true for the first elimination round after warm-ups and false for the next one', () => {
    const warmUp = () => pooling({ isQual: false });
    const rounds = [warmUp(), warmUp(), bracket(17, 14), bracket(14, 8)];
    expect([0, 1, 2, 3].map((index) => isFullFieldRound(rounds, index))).toEqual([true, true, true, false]);
  });

  it('reads the real rounds of the 17-team tournament: R1-R3 true, R4 on false', () => {
    const { state } = playToRound(startSpread(spreadConfig('2v2v2v2', 17, { pooling: 'none' })), 2);
    const flags = state.rounds.map((_, index) => isFullFieldRound(state.rounds, index));
    expect(flags.slice(0, 3)).toEqual([true, true, true]);
    expect(flags.slice(3, -1).every((flag) => !flag)).toBe(true);
  });

  it('a withdrawal during the warm-ups leaves round 3 true', () => {
    const start = playToRound(startSpread(spreadConfig('2v2v2v2', 17, { pooling: 'none' })), 1).state;
    const victim = start.assignments[1].find((entry) => entry.room !== null)!.name;
    const after = removeRosterUnit(start, victim);
    expect(isFullFieldRound(after.rounds, 2)).toBe(true);
    expect(isFullFieldRound(after.rounds, 3)).toBe(false);
  });
});

/** Plays to the Final, keeping each round's places. */
function playToFinal(start: TournamentState): { state: TournamentState; places: Places[] } {
  let state = start;
  const places: Places[] = [];
  for (let guard = 0; guard < 40 && !state.rounds[state.curRound].isFinal; guard += 1) {
    const step = advanceScored(state);
    places[state.curRound] = step.places;
    state = step.state;
  }
  return { state, places };
}

/** The mixed-size rounds drawn after eliminations, each with how many smaller seats every finishing place got and its share. */
function placeShares(state: TournamentState, places: Places[]) {
  const checked: Array<{ round: number; actual: number[]; expected: number[] }> = [];
  for (let index = 1; index < state.rounds.length; index += 1) {
    const round = state.rounds[index];
    const lineUp = state.assignments[index] ?? [];
    const sizes = new Map<number, number>();
    for (const { room } of lineUp) if (room !== null) sizes.set(room, (sizes.get(room) ?? 0) + 1);
    const largest = Math.max(0, ...sizes.values());
    const isMixed = [...sizes.values()].some((size) => size < largest);
    const drawnAfterEliminations = !isFullFieldRound(state.rounds, index) && !round.isSemis && !round.isFinal;
    if (!isMixed || !drawnAfterEliminations || !places[index - 1]) continue;
    const seated = lineUp.filter((entry) => entry.room !== null);
    const tiers = [...new Set(seated.map((entry) => places[index - 1][entry.name]))].sort((a, b) => a - b);
    const inTier = (tier: number) => seated.filter((entry) => places[index - 1][entry.name] === tier);
    const smallSeats = seated.filter((entry) => (sizes.get(entry.room as number) ?? 0) < largest);
    checked.push({
      round: index,
      actual: tiers.map(
        (tier) => smallSeats.filter((entry) => places[index - 1][entry.name] === tier).length,
      ),
      expected: seatsPerTier(
        tiers.map((tier) => inTier(tier).length),
        smallSeats.length,
      ),
    });
  }
  return checked;
}

/**
 * For every mixed-size round drawn after eliminations: within each finishing place (in the order the draw
 * reads it), the units given a smaller-room seat against the units not given one. A violation is a unit with
 * a seat that has more seats so far than one without, or the same count and a later place in the order.
 */
function seatOrderChecks(state: TournamentState) {
  const violations: string[] = [];
  let tiedPairs = 0;
  for (let index = 1; index < state.rounds.length; index += 1) {
    const round = state.rounds[index];
    const lineUp = state.assignments[index] ?? [];
    const sizes = new Map<number, number>();
    for (const { room } of lineUp) if (room !== null) sizes.set(room, (sizes.get(room) ?? 0) + 1);
    const largest = Math.max(0, ...sizes.values());
    const afterEliminations = !isFullFieldRound(state.rounds, index) && !round.isSemis && !round.isFinal;
    if (!afterEliminations || ![...sizes.values()].some((size) => size < largest)) continue;
    const seated = lineUp.filter((entry) => entry.room !== null);
    const hasSmallSeat = new Set(
      seated.filter((entry) => (sizes.get(entry.room as number) ?? 0) < largest).map((entry) => entry.name),
    );
    const tally = smallerRoomSeatsBefore(state, index);
    const seatsOf = (name: string) => tally[name] ?? 0;
    const tiers = buildAdvancementTiers(
      state,
      index - 1,
      seated.map((entry) => entry.name),
    );
    for (const { members } of tiers) {
      const ordered = members.map((member) => member.name);
      for (const [position, taken] of ordered.entries()) {
        if (!hasSmallSeat.has(taken)) continue;
        for (const [otherPosition, other] of ordered.entries()) {
          if (hasSmallSeat.has(other)) continue;
          if (seatsOf(taken) === seatsOf(other)) tiedPairs += 1;
          const earns =
            seatsOf(taken) < seatsOf(other) ||
            (seatsOf(taken) === seatsOf(other) && position < otherPosition);
          if (!earns) {
            violations.push(
              `R${index + 1} ${taken} (${seatsOf(taken)}) has a seat, ${other} (${seatsOf(other)}) does not`,
            );
          }
        }
      }
    }
  }
  return { violations, tiedPairs };
}

describe('the draws after eliminations share the smaller-room seats per finishing place', () => {
  // [format, units, how many the qualification table sends on]: FFA cuts of 20+ give a bracket round of mixed rooms.
  const SHAPES: Array<[SpreadKind, number, string]> = [
    ['2v2v2v2', 31, '16'],
    ['2v2v2v2', 37, '16'],
    ['2v2v2v2', 43, '16'],
    ['2v2v2v2', 53, '16'],
    ['ffa', 37, '20'],
    ['ffa', 43, '26'],
    ['ffa', 53, '30'],
  ];

  it.each(SHAPES)(
    '%s at %i (%s advance), qualification table then the bracket cuts',
    (kind, count, qualAdv) => {
      const base = spreadConfig(kind, count);
      const { state, places } = playToFinal(startSpread({ ...base, setup: { ...base.setup, qualAdv } }));
      const checked = placeShares(state, places);
      expect(checked.length).toBeGreaterThan(0);
      for (const { actual, expected } of checked) expect(actual).toEqual(expected);
    },
  );

  it.each(SHAPES)(
    '%s at %i (%s advance): inside every place the seats go to the fewest so far, then best first',
    (kind, count, qualAdv) => {
      const base = spreadConfig(kind, count);
      const { state } = playToFinal(startSpread({ ...base, setup: { ...base.setup, qualAdv } }));
      expect(seatOrderChecks(state).violations).toEqual([]);
    },
  );

  it.each<[SpreadKind, number]>([
    ['2v2v2v2', 17],
    ['2v2v2v2', 31],
  ])('%s at %i, pooling none: round 4 on follows the shares', (kind, count) => {
    const { state, places } = playToFinal(startSpread(spreadConfig(kind, count, { pooling: 'none' })));
    const checked = placeShares(state, places);
    expect(checked.length).toBeGreaterThan(0);
    expect(Math.min(...checked.map(({ round }) => round))).toBe(3);
    for (const { actual, expected } of checked) expect(actual).toEqual(expected);
    expect(seatOrderChecks(state).violations).toEqual([]);
  });

  it('the tie rule is exercised: some unit with a seat is tied on the count with a unit without', () => {
    const total = SHAPES.reduce((sum, [kind, count, qualAdv]) => {
      const base = spreadConfig(kind, count);
      const { state } = playToFinal(startSpread({ ...base, setup: { ...base.setup, qualAdv } }));
      return sum + seatOrderChecks(state).tiedPairs;
    }, 0);
    expect(total).toBeGreaterThan(0);
  });
});
