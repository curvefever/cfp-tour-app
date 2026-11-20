import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RoomSize, TournamentRound } from '../types';
import { bestMoves } from '../waterfall-best';
import {
  advancingSeats,
  fitWaterfallRound,
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
} from '../waterfall-bracket';
import {
  assignWaterfallSlots,
  parseWaterfallDraft,
  resizeWaterfallRound,
  serializeWaterfallDraft,
  suggestedBest,
  waterfallDraftFromRounds,
  type WaterfallDraft,
} from '../waterfall-draft';
import { WATERFALL_EXAMPLES } from '../waterfall-examples';
import { buildQualWaterfall } from './qual-waterfall';

/**
 * Rooms of different sizes in one round: the `8+8+7` ROUNDS line (`docs/rules.md`, "Custom bracket"), through the
 * parser, the validator, the Setup draft, generation, a round drawn short and the BEST line.
 */

const ANY_ROOM_SIZE: RoomSize = { min: 1, max: 20, ideal: 8 };

const graphText = (rounds: string[], routes: string[]) =>
  `ROUNDS:\n${rounds.join('\n')}\n\nROUTES:\n${routes.join('\n')}`;

/** 8 + 8 + 7 in, the top 4 of each room to R5; R5 then sends 4 of each room to the Final. */
const ROUNDS = ['R4 = 8+8+7', 'R5 = 2x6', 'Final = 8 FINAL'];
const ROOMS = [
  'R4.A: 1-4->R5, 5-8->eliminated',
  'R4.B: 1-4->R5, 5-8->eliminated',
  'R4.C: 1-4->R5, 5-7->eliminated',
];
const AFTER = ['R5.A: 1-4->Final, 5-6->eliminated', 'R5.B: 1-4->Final, 5-6->eliminated'];

const plain = graphText(ROUNDS, [...ROOMS, ...AFTER]);

/** The same graph with a BEST line: R5 then gets 12 and the `chosen` units of the line, and is sized for them (7 + 6, 7 + 7). */
function withBest(line: string, chosen = 1) {
  const r5 = chosen === 1 ? 'R5 = 7+6' : 'R5 = 7+7';
  const after = [
    'R5.A: 1-4->Final, 5-7->eliminated',
    `R5.B: 1-4->Final, ${chosen === 1 ? '5-6' : '5-7'}->eliminated`,
  ];
  return graphText(['R4 = 8+8+7', r5, 'Final = 8 FINAL'], [...ROOMS, line, ...after]);
}

function parsed(text: string) {
  const result = parseWaterfallGraph(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function validated(text: string, entrantCount = 23) {
  return validateAndOrderWaterfallGraph(parsed(text), { roomSize: ANY_ROOM_SIZE, entrantCount });
}

function refusal(text: string): string {
  const result = validated(text);
  if (result.ok) throw new Error('the graph was accepted');
  return result.error;
}

function draftOf(text: string, standingsSource = false): WaterfallDraft {
  const result = parseWaterfallDraft(text, { standingsSource });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('the ROUNDS line with the sizes of the rooms', () => {
  it('reads 8+8+7 as three rooms, and leaves "3x8" and "8" as they were', () => {
    const rounds = parsed(
      graphText(['R4 = 8+8+7', 'R5 = 3x8', 'Final = 8 FINAL'], ['R4: 1-7->R5']),
    ).roundLines;
    expect(rounds.map((round) => round.roomSizes)).toEqual([[8, 8, 7], [8, 8, 8], [8]]);
  });

  it.each(['8+0', '0+8', '8+', '+8', '8++7', '8+x'])('refuses the size "%s"', (size) => {
    const result = parseWaterfallGraph(`ROUNDS:\nR4 = ${size}\nROUTES:\nR4: 1-8->eliminated`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid room size|unrecognized size/);
  });

  it('validates a graph with a mixed round and orders it with the rooms as declared', () => {
    const result = validated(plain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rounds.map((round) => round.roomSizes)).toEqual([[8, 8, 7], [6, 6], [8]]);
    expect(result.value.routes[0][2]).toEqual([1, 1, 1, 1, 'eliminated', 'eliminated', 'eliminated']);
  });

  it("checks a rank against its own room's size", () => {
    const text = plain.replace('R4.C: 1-4->R5, 5-7->eliminated', 'R4.C: 1-4->R5, 5-8->eliminated');
    expect(refusal(text)).toContain('rank 8 is out of range');
  });

  it("checks every room's size against the format's room sizes", () => {
    const result = validateAndOrderWaterfallGraph(parsed(plain), {
      roomSize: { min: 6, max: 8, ideal: 8 },
      entrantCount: 23,
    });
    expect(result.ok).toBe(true);
    const tooSmall = validateAndOrderWaterfallGraph(parsed(plain.replace('8+8+7', '8+8+4')), {
      roomSize: { min: 6, max: 8, ideal: 8 },
      entrantCount: 20,
    });
    expect(tooSmall.ok).toBe(false);
  });
});

describe('the draft of a mixed round', () => {
  it('reads the rooms, gives each its own places, and writes them back as 8+8+7', () => {
    const draft = draftOf(plain);
    expect(draft.rounds[0].roomSizes).toEqual([8, 8, 7]);
    expect(draft.routes.R4.map((room) => room.length)).toEqual([8, 8, 7]);
    expect(serializeWaterfallDraft(draft)).toContain('R4 = 8+8+7\n');
    expect(serializeWaterfallDraft(draft)).toBe(
      graphText(ROUNDS, [
        'R4.A: 1-4->R5',
        'R4.B: 1-4->R5',
        'R4.C: 1-4->R5',
        'R5.A: 1-4->Final',
        'R5.B: 1-4->Final',
      ]),
    );
  });

  it('refuses a rank its room does not have, with the room size in the words', () => {
    const text = plain.replace('R4.C: 1-4->R5, 5-7->eliminated', 'R4.C: 1-4->R5, 5-8->eliminated');
    const result = parseWaterfallDraft(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Round "R4": rank 8 is out of range for a room of 7.');
  });

  it('writes equal rooms as NxS, also when they were typed as a list', () => {
    const text = plain.replace('R4 = 8+8+7', 'R4 = 8+8+8');
    expect(serializeWaterfallDraft(draftOf(text))).toContain('R4 = 3x8\n');
  });

  it("assigns a slot only where the room has the place, and keeps a mixed round's other rooms on a resize of another round", () => {
    const draft = draftOf(plain);
    const assigned = assignWaterfallSlots(
      draft,
      'R4',
      [
        { room: 2, rank: 8 },
        { room: 1, rank: 8 },
      ],
      'R5',
    );
    expect(assigned.routes.R4[2]).toHaveLength(7);
    expect(assigned.routes.R4[1][7]).toBe('R5');
    const resized = resizeWaterfallRound(draft, 'R5', 2, 7);
    expect(resized.rounds[0].roomSizes).toEqual([8, 8, 7]);
  });

  it('is rebuilt from a drawn round with the rooms it declared, also while the round is short', () => {
    const state = buildQualWaterfall(22, graphText(ROUNDS, ['Qual: 1-22->R4', ...ROOMS, ...AFTER]));
    const r4 = state.rounds.find((round) => round.customLabel === 'R4');
    expect(r4).toMatchObject({ rooms: [8, 7, 7], declaredRooms: [8, 8, 7] });
    const draft = waterfallDraftFromRounds(state.rounds);
    expect(draft.rounds.find((round) => round.label === 'R4')?.roomSizes).toEqual([8, 8, 7]);
  });
});

describe('every graph written before mixed rooms comes back out byte for byte', () => {
  const stored = (id: string) =>
    JSON.parse(readFileSync(new URL(`./old-tournaments/${id}.json`, import.meta.url), 'utf8')) as {
      settings: { waterfallGraph: string };
    };
  const graphs: Array<[string, string]> = [
    ...WATERFALL_EXAMPLES.map((example): [string, string] => [
      `the example "${example.label}"`,
      example.text,
    ]),
    ...['1792339397443', '1792489989400', '1793555835749'].map((id): [string, string] => [
      `the graph of tournament ${id}`,
      stored(id).settings.waterfallGraph,
    ]),
  ];
  const roundsOf = (text: string) => text.slice(0, text.indexOf('\n\n'));

  it.each(graphs)('keeps the ROUNDS lines of %s, and writes the same text twice', (_name, text) => {
    const once = serializeWaterfallDraft(draftOf(text, text.includes('Qual:')));
    expect(roundsOf(once)).toBe(roundsOf(text.trim()));
    expect(serializeWaterfallDraft(draftOf(once, text.includes('Qual:')))).toBe(once);
  });
});

describe('a mixed round drawn short', () => {
  const round = (declared: number[]): TournamentRound => ({
    roundNum: 4,
    players: declared.reduce((total, size) => total + size, 0),
    rooms: declared,
    byeCount: 0,
    isQual: false,
    isNoElim: false,
    isSemis: false,
    isFinal: false,
    advPerRoom: null,
    advTotal: 0,
    luckyCount: 0,
    isWaterfall: true,
    customLabel: 'R4',
    waterfallRoutes: declared.map((size) => Array.from({ length: size }, () => 'eliminated' as const)),
  });

  it.each([
    [[8, 8, 7], 22, [8, 7, 7]],
    [[8, 8, 7], 21, [7, 7, 7]],
    [[8, 8, 7], 20, [7, 7, 6]],
    [[8, 7, 7], 21, [7, 7, 7]],
    [[8, 8, 7], 14, [5, 5, 4]],
    [[8, 7, 6], 20, [7, 7, 6]],
  ])(
    'seats %j with %i units as %j (a seat comes out of the last of the largest rooms)',
    (declared, pool, rooms) => {
      expect(fitWaterfallRound(round(declared), pool)).toMatchObject({ rooms, players: pool });
    },
  );
});

describe('a BEST line over a mixed round', () => {
  it('accepts the 8th of 8+8+7: only the two larger rooms have one', () => {
    const result = validated(withBest('R4.BEST: 1 OF 8->R5'));
    expect(result.ok).toBe(true);
  });

  it('counts the rooms that have the place: 2 of the 8th is refused, 2 of the 7th is accepted, 3 of the 7th is not', () => {
    expect(refusal(withBest('R4.BEST: 2 OF 8->R5'))).toContain('only 2 room(s) have one');
    expect(validated(withBest('R4.BEST: 2 OF 7->R5', 2), 23).ok).toBe(true);
    expect(refusal(withBest('R4.BEST: 3 OF 7->R5', 2))).toContain('only 3 room(s) have one');
  });

  it('refuses a place no room has, naming the largest room', () => {
    expect(refusal(withBest('R4.BEST: 1 OF 9->R5'))).toContain('places 1-8');
  });

  it('chooses the best of a place among the rooms that have it, also when a seat is missing', () => {
    const best = { place: 8, count: 2, destination: 1 };
    const routes = [
      [
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
      ],
      [
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
        'eliminated',
      ],
      ['eliminated', 'eliminated', 'eliminated', 'eliminated', 'eliminated', 'eliminated', 'eliminated'],
    ] as const;
    expect(bestMoves(best, routes, [8, 8, 7])).toEqual({ chosen: 2, rest: 'eliminated' });
    expect(bestMoves(best, routes, [8, 7, 7])).toEqual({ chosen: 1, rest: 'eliminated' });
    expect(bestMoves({ ...best, place: 7 }, routes, [8, 8, 7])).toEqual({ chosen: 2, rest: 'eliminated' });
  });

  it('draws the next round for the seats of the line at 23 and at 22 registered', () => {
    const graph = (registered: number) =>
      withBest('R4.BEST: 1 OF 8->R5').replace('ROUTES:\n', `ROUTES:\nQual: 1-${registered}->R4\n`);
    const at23 = buildQualWaterfall(23, graph(23));
    const at22 = buildQualWaterfall(22, graph(22));
    const labelled = (state: ReturnType<typeof buildQualWaterfall>, label: string) =>
      state.rounds.find((round) => round.customLabel === label);
    expect(labelled(at23, 'R4')?.rooms).toEqual([8, 8, 7]);
    expect(labelled(at22, 'R4')?.rooms).toEqual([8, 7, 7]);
    for (const state of [at23, at22]) {
      expect(labelled(state, 'R5')).toMatchObject({ players: 13, rooms: [7, 6] });
      const r4 = labelled(state, 'R4') as TournamentRound;
      expect(advancingSeats(r4, r4.rooms)).toBe(13);
    }
  });

  it('is offered for the 8th place of 8+8+7 in the draft, and not once only one room has it', () => {
    const draft = draftOf(plain);
    expect(suggestedBest(draft, 'R4', 8)).toMatchObject({ place: 8, count: 1 });
    const shorter = draftOf(
      plain.replace('R4 = 8+8+7', 'R4 = 8+7+7').replaceAll('5-8->eliminated', '5-7->eliminated'),
    );
    expect(suggestedBest(shorter, 'R4', 8)).toBeNull();
    expect(suggestedBest(shorter, 'R4', 7)).toMatchObject({ place: 7, count: 1 });
  });
});
