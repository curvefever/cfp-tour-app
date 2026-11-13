import { describe, expect, it } from 'vitest';
import type { RoomSize, TournamentRound } from '../types';
import { roundDestinations } from '../waterfall-best';
import {
  advancingSeats,
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
} from '../waterfall-bracket';
import { buildQualWaterfall } from './qual-waterfall';

/**
 * "The best n of the k-th places": the BEST line of a Custom bracket round, its refusals, the seats it
 * counts and the field it stores (`plans/2026-11-13-best-of-a-place.md`, stage 1).
 */

const ANY_ROOM_SIZE: RoomSize = { min: 1, max: 20, ideal: 8 };

const graphText = (rounds: string[], routes: string[]) =>
  `ROUNDS:\n${rounds.join('\n')}\n\nROUTES:\n${routes.join('\n')}`;

const ROUNDS = ['R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'];
const ROOMS = [
  'R4.A: 1-5->R5, 6-8->eliminated',
  'R4.B: 1-5->R5, 6-8->eliminated',
  'R4.C: 1-5->R5, 6-8->eliminated',
];
const ROUTES_AFTER = ['R5.A: 1-4->Final, 5-8->eliminated', 'R5.B: 1-4->Final, 5-8->eliminated'];

/** The organiser's example: 3 rooms of 8, places 1-5 of each to R5 and the best 6th of the three. */
const example = (...extra: string[]) => graphText(ROUNDS, [...ROOMS, ...extra, ...ROUTES_AFTER]);
const EXAMPLE = example('R4.BEST: 1 OF 6->R5');
/** The same graph with no BEST line: room A sends its 6th on too, so R5 still gets its 16. */
const PLAIN = example().replace('R4.A: 1-5->R5, 6-8->eliminated', 'R4.A: 1-6->R5, 7-8->eliminated');

/** The best 2 of the 6ths go to a round of their own, `Extra`, that nothing else feeds. */
const EXTRA = graphText(
  ['R4 = 3x8', 'R5 = 3x5', 'Extra = 2', 'Final = 11 FINAL'],
  [
    'R4.A: 1-5->R5',
    'R4.B: 1-5->R5',
    'R4.C: 1-5->R5',
    'R4.BEST: 2 OF 6->Extra',
    'Extra: 1-2->Final',
    'R5.A: 1-3->Final',
    'R5.B: 1-3->Final',
    'R5.C: 1-3->Final',
  ],
);

function validated(text: string, entrantCount = 24) {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed;
  return validateAndOrderWaterfallGraph(parsed.value, { roomSize: ANY_ROOM_SIZE, entrantCount });
}

function refusal(text: string): string {
  const result = validated(text);
  if (result.ok) throw new Error('the graph was accepted');
  return result.error;
}

function accepted(text: string, entrantCount = 24) {
  const result = validated(text, entrantCount);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('reading a BEST line', () => {
  it.each([
    ['R4.BEST: 1 OF 6->R5', 'R4'],
    ['r4.best:1 of 6 -> R5', 'r4'],
    ['  R4 .Best :  1  Of  6->  R5  ', 'R4'],
  ])('reads %j', (line, label) => {
    const parsed = parseWaterfallGraph(example(line));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.bestLines).toEqual([{ label, count: 1, place: 6, destinationLabel: 'R5' }]);
    expect(parsed.value.routeLines).toHaveLength(ROOMS.length + ROUTES_AFTER.length);
  });

  it('reads a round name with spaces', () => {
    const parsed = parseWaterfallGraph(
      graphText(
        ['Round 4 Upper = 3x8', 'Round 5 = 2x8', 'Final = 8 FINAL'],
        [
          'Round 4 Upper.A: 1-5->Round 5',
          'Round 4 Upper.B: 1-5->Round 5',
          'Round 4 Upper.C: 1-5->Round 5',
          'Round 4 Upper.BEST: 1 OF 6->Round 5',
          'Round 5.A: 1-4->Final',
          'Round 5.B: 1-4->Final',
        ],
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.bestLines).toEqual([
      { label: 'Round 4 Upper', count: 1, place: 6, destinationLabel: 'Round 5' },
    ]);
  });

  it('has no BEST lines in a graph without one', () => {
    const parsed = parseWaterfallGraph(example());
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.bestLines).toEqual([]);
  });

  it.each(['R4.BEST: 1->R5', 'R4.BEST: one OF 6->R5', 'R4.BEST: 1 OF 6', 'R4.BEST: 1 OF 6->', 'R4.BEST:'])(
    'refuses the malformed line %j',
    (line) => {
      const result = parseWaterfallGraph(example(line));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(`"${line}"`);
        expect(result.error).toContain('<round>.BEST: <n> OF <place>-><destination>');
      }
    },
  );
});

describe('what a BEST line adds to the ordered graph', () => {
  it('stores the line with the destination as a round index, aligned with the rounds', () => {
    const graph = accepted(EXAMPLE);
    expect(graph.rounds.map((round) => round.label)).toEqual(['R4', 'R5', 'Final']);
    expect(graph.best).toEqual([{ place: 6, count: 1, destination: 1 }, null, null]);
  });

  it('has no best list in a graph without a BEST line', () => {
    expect(accepted(PLAIN).best).toBeUndefined();
  });

  it('counts the best 6th as seats of R5: 15 + 1 = 16', () => {
    expect(refusal(example())).toBe(
      'Round "R5" declares 16 player(s) but its routing bands only send it 15 -- a round\'s declared size must exactly match what routes into it.',
    );
    expect(validated(EXAMPLE).ok).toBe(true);
  });

  it('counts the rest of the place in the round it goes to: m - n there, n in the chosen round', () => {
    const toLower = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'R5L = 2 RANKING', 'Final = 8 FINAL'],
      [
        'R4.A: 1-5->R5, 6->R5L',
        'R4.B: 1-5->R5, 6->R5L',
        'R4.C: 1-5->R5, 6->R5L',
        'R4.BEST: 1 OF 6->R5',
        ...ROUTES_AFTER,
      ],
    );
    expect(validated(toLower).ok).toBe(true);
    const tooMany = toLower.replace('R5L = 2 RANKING', 'R5L = 3 RANKING');
    expect(refusal(tooMany)).toBe(
      'Round "R5L" declares 3 player(s) but its routing bands only send it 2 -- a round\'s declared size must exactly match what routes into it.',
    );
  });

  it('refuses a wrong declared size', () => {
    expect(refusal(EXAMPLE.replace('1 OF 6', '2 OF 6'))).toContain('only send it 17');
  });

  it('lets a round send on only through its BEST route (its rooms send nobody on)', () => {
    const sendsNothingElse = graphText(
      ['R4 = 3x6', 'R5 = 2', 'Final = 2 FINAL'],
      [
        'R4.A: 6->eliminated',
        'R4.B: 6->eliminated',
        'R4.C: 6->eliminated',
        'R4.BEST: 2 OF 6->R5',
        'R5: 1-2->Final',
      ],
    );
    expect(validated(sendsNothingElse, 18).ok).toBe(true);
  });

  it('puts a round fed only through a BEST route in the column after its feeder', () => {
    const graph = accepted(EXTRA);
    const columnOf = new Map(graph.rounds.map((round, index) => [round.label, graph.columns[index]]));
    expect(columnOf.get('R4')).toBe(1);
    expect(columnOf.get('Extra')).toBe(2);
    expect(columnOf.get('Final')).toBe(3);
    expect(graph.rounds.findIndex((round) => round.label === 'Extra')).toBeGreaterThan(0);
  });
});

describe('the refusals of a BEST line, each naming the round', () => {
  it('refuses a second BEST line in a round', () => {
    expect(refusal(example('R4.BEST: 1 OF 6->R5', 'R4.BEST: 1 OF 7->R5'))).toBe(
      'Round "R4" has more than one BEST line -- a round sends the best of one place only.',
    );
  });

  it('refuses a round that is not declared', () => {
    expect(refusal(example('R9.BEST: 1 OF 6->R5'))).toBe(
      'BEST line references round "R9", which isn\'t declared in ROUNDS.',
    );
  });

  it('refuses the Final', () => {
    expect(refusal(example('R4.BEST: 1 OF 6->R5', 'Final.BEST: 1 OF 2->R5'))).toBe(
      'Round "Final" has a BEST line but is the Final -- nothing routes out of the Final.',
    );
  });

  it('refuses a RANKING round', () => {
    const ranking = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'R5L = 2x3 RANKING', 'Final = 8 FINAL'],
      [...ROOMS, 'R4.BEST: 1 OF 6->R5', ...ROUTES_AFTER, 'R5L.BEST: 1 OF 2->R5'],
    );
    expect(refusal(ranking)).toBe(
      'Round "R5L" has a BEST line but is marked RANKING -- a ranking match sends nobody on.',
    );
  });

  it('refuses the Qual and Groups lines, which are one ranked list', () => {
    expect(refusal(example('Qual.BEST: 1 OF 6->R5'))).toBe(
      '"Qual" can\'t have a BEST line -- the qualification table is one ranked list: route the rank itself.',
    );
    expect(refusal(example('Groups.BEST: 1 OF 6->R5'))).toBe(
      '"Groups" can\'t have a BEST line -- the group stage\'s exit is one ranked list: route the rank itself.',
    );
  });

  it('refuses a destination that is not declared', () => {
    expect(refusal(example('R4.BEST: 1 OF 6->R9'))).toBe(
      'Round "R4" sends the best 6th to "R9", which isn\'t declared in ROUNDS.',
    );
  });

  it('refuses eliminated as the destination', () => {
    expect(refusal(example('R4.BEST: 1 OF 6->eliminated'))).toBe(
      'Round "R4" sends the best 6th to "eliminated" -- the best of a place must go on to a round.',
    );
  });

  it('refuses a destination that is not later in the graph', () => {
    const earlier = graphText(
      ['R3 = 3x8', 'R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'],
      ['R3.A: 1-8->R4', 'R3.B: 1-8->R4', 'R3.C: 1-8->R4', ...ROOMS, 'R4.BEST: 1 OF 6->R3', ...ROUTES_AFTER],
    );
    expect(refusal(earlier)).toBe(
      'Round "R4" sends the best 6th to "R3", which is not later in the graph -- it must be a round that R4 can still reach.',
    );
    expect(refusal(example('R4.BEST: 1 OF 6->R4'))).toBe(
      'Round "R4" sends the best 6th to "R4", which is not later in the graph -- it must be a round that R4 can still reach.',
    );
  });

  it('refuses a place outside the rooms', () => {
    expect(refusal(example('R4.BEST: 1 OF 9->R5'))).toBe(
      'Round "R4" names place 9 in its BEST line, but its rooms only have places 1-8.',
    );
    expect(refusal(example('R4.BEST: 1 OF 0->R5'))).toBe(
      'Round "R4" names place 0 in its BEST line, but its rooms only have places 1-8.',
    );
  });

  it('refuses a count under 1', () => {
    expect(refusal(example('R4.BEST: 0 OF 6->R5'))).toBe(
      'Round "R4" asks for the best 0 of the 6th places -- ask for at least 1.',
    );
  });

  it('refuses a count of every room: that is a plain route', () => {
    expect(refusal(example('R4.BEST: 3 OF 6->R5'))).toBe(
      'Round "R4" asks for the best 3 of the 6th places, but only 3 room(s) have one -- to send them all, route place 6 of every room to R5 instead.',
    );
    expect(refusal(example('R4.BEST: 4 OF 6->R5'))).toContain('but only 3 room(s) have one');
  });

  it('refuses a round with one room: there is nothing to choose between', () => {
    const oneRoom = graphText(
      ['R4 = 8', 'R5 = 4', 'Final = 4 FINAL'],
      ['R4: 1-3->R5, 4-8->eliminated', 'R4.BEST: 1 OF 4->R5', 'R5: 1-4->Final'],
    );
    expect(refusal(oneRoom)).toContain('but only 1 room(s) have one');
  });

  it('refuses rooms that do not route the place to the same destination', () => {
    const split = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'R5L = 1 RANKING', 'Final = 8 FINAL'],
      [
        'R4.A: 1-5->R5, 6->R5L',
        'R4.B: 1-5->R5, 6-8->eliminated',
        'R4.C: 1-5->R5, 6-8->eliminated',
        'R4.BEST: 1 OF 6->R5',
        ...ROUTES_AFTER,
      ],
    );
    expect(refusal(split)).toBe(
      'Round "R4" sends the best 6th to R5, but its rooms do not all route the 6th place to the same destination -- the others must all go one way, to one round or out.',
    );
  });

  it('refuses a rest that goes to the chosen round itself', () => {
    const same = graphText(ROUNDS, [
      'R4.A: 1-5->R5, 6->R5',
      'R4.B: 1-5->R5, 6->R5',
      'R4.C: 1-5->R5, 6->R5',
      'R4.BEST: 1 OF 6->R5',
      ...ROUTES_AFTER,
    ]);
    expect(refusal(same)).toBe(
      'Round "R4" sends the best 6th to R5 and routes the other 6th places there too -- nothing to choose.',
    );
  });
});

describe('the field stored on the generated round', () => {
  it('writes waterfallBest with the destination as an absolute round index', () => {
    const rounds = waterfallBracketPhase(24, 4, { graph: accepted(EXAMPLE), finalsGames: 1 });
    expect(rounds[0].waterfallBest).toEqual({ place: 6, count: 1, destination: 4 });
    expect(rounds[1].waterfallBest).toBeUndefined();
    expect('waterfallBest' in rounds[1]).toBe(false);
    expect(rounds[0].advTotal).toBe(16);
  });

  it('writes nothing for a graph without a BEST line', () => {
    const rounds = waterfallBracketPhase(24, 1, { graph: accepted(PLAIN), finalsGames: 1 });
    expect(rounds.some((round) => 'waterfallBest' in round)).toBe(false);
  });
});

describe('the seats a round sends on', () => {
  const rooms = (sizes: number[]) => sizes;
  const round = (): TournamentRound => {
    const [r4] = waterfallBracketPhase(24, 1, { graph: accepted(EXAMPLE), finalsGames: 1 });
    return r4;
  };

  it.each([
    [[8, 8, 8], 16],
    [[8, 8, 7], 16],
    [[6, 6, 5], 16],
    [[6, 5, 5], 16],
    [[5, 5, 5], 15],
  ])('with the rest out, rooms %j send %i on', (sizes, seats) => {
    expect(advancingSeats(round(), rooms(sizes))).toBe(seats);
  });

  it('sends min(count, rooms with the place) on when the rest is out', () => {
    const [r4] = waterfallBracketPhase(18, 1, {
      graph: accepted(
        graphText(
          ['R4 = 3x6', 'R5 = 2', 'Final = 2 FINAL'],
          [
            'R4.A: 6->eliminated',
            'R4.B: 6->eliminated',
            'R4.C: 6->eliminated',
            'R4.BEST: 2 OF 6->R5',
            'R5: 1-2->Final',
          ],
        ),
        18,
      ),
      finalsGames: 1,
    });
    expect(advancingSeats(r4, [6, 6, 6])).toBe(2);
    expect(advancingSeats(r4, [6, 6, 5])).toBe(2);
    expect(advancingSeats(r4, [6, 5, 5])).toBe(1);
    expect(advancingSeats(r4, [5, 5, 5])).toBe(0);
  });

  it('counts the rest through its own line when it goes to a round', () => {
    const toLower = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'R5L = 2 RANKING', 'Final = 8 FINAL'],
      [
        'R4.A: 1-5->R5, 6->R5L',
        'R4.B: 1-5->R5, 6->R5L',
        'R4.C: 1-5->R5, 6->R5L',
        'R4.BEST: 1 OF 6->R5',
        ...ROUTES_AFTER,
      ],
    );
    const [r4] = waterfallBracketPhase(24, 1, { graph: accepted(toLower), finalsGames: 1 });
    expect(advancingSeats(r4, [8, 8, 8])).toBe(18);
    expect(r4.advTotal).toBe(18);
  });
});

describe('every destination of a round', () => {
  it("lists the rooms' routes and the BEST destination, once each", () => {
    const [r4, r5] = waterfallBracketPhase(24, 1, { graph: accepted(EXAMPLE), finalsGames: 1 });
    expect(roundDestinations(r4)).toEqual([1]);
    expect(roundDestinations(r5)).toEqual([2]);
  });

  it('adds a BEST destination no room line names', () => {
    const graph = accepted(EXTRA);
    const [r4] = waterfallBracketPhase(24, 1, { graph, finalsGames: 1 });
    expect(roundDestinations(r4).sort()).toEqual([1, 2]);
  });

  it('is empty for a round without routes', () => {
    expect(roundDestinations({})).toEqual([]);
  });
});

describe('a qualification table into a round with a BEST line, at awkward head counts', () => {
  const QUAL_BEST = graphText(ROUNDS, ['Qual: 1-24->R4', ...ROOMS, 'R4.BEST: 1 OF 6->R5', ...ROUTES_AFTER]);

  it.each([
    [31, 7],
    [37, 13],
    [43, 19],
    [53, 29],
  ])('at %i registered the line takes 24 on and the other %i are out', (registered, out) => {
    const state = buildQualWaterfall(registered, QUAL_BEST);
    const r4 = state.rounds.find((round) => round.customLabel === 'R4');
    const r5 = state.rounds.find((round) => round.customLabel === 'R5');
    expect(r4?.waterfallBest).toEqual({ place: 6, count: 1, destination: state.rounds.indexOf(r5!) });
    expect(r4?.rooms).toEqual([8, 8, 8]);
    expect(r5?.rooms).toEqual([8, 8]);
    const routes = state.rounds.find((round) => round.standingsRoutes)?.standingsRoutes;
    expect(routes).toHaveLength(24);
    expect(registered - (routes?.length ?? 0)).toBe(out);
  });
});
