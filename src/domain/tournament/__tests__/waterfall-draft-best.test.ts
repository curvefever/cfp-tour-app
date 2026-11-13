import { describe, expect, it } from 'vitest';
import type { RoomSize } from '../types';
import { parseWaterfallGraph, validateAndOrderWaterfallGraph } from '../waterfall-bracket';
import {
  bestDestinationChoices,
  parseWaterfallDraft,
  removeWaterfallRound,
  renameWaterfallRound,
  renameWaterfallRounds,
  resizeWaterfallRound,
  serializeWaterfallDraft,
  setWaterfallBest,
  setWaterfallFinal,
  setWaterfallRanking,
  suggestedBest,
  waterfallDraftFromRounds,
  waterfallFlowEdges,
  waterfallRoundIntake,
  type WaterfallDraft,
} from '../waterfall-draft';
import { buildQualWaterfall } from './qual-waterfall';

/** The "Best of a place" field of the graph editor: a BEST line in the draft (`plans/2026-11-13-best-of-a-place.md`, stage 3). */

const ROOM_SIZE: RoomSize = { min: 1, max: 20, ideal: 8 };

const graphText = (rounds: string[], routes: string[]) =>
  `ROUNDS:\n${rounds.join('\n')}\n\nROUTES:\n${routes.join('\n')}`;

const ROUNDS = ['R4 = 3x8', 'R5 = 2x8', 'Final = 8 FINAL'];
const ROOMS = ['A', 'B', 'C'].map((room) => `R4.${room}: 1-5->R5, 6-8->eliminated`);
const AFTER = ['R5.A: 1-4->Final, 5-8->eliminated', 'R5.B: 1-4->Final, 5-8->eliminated'];
const EXAMPLE = graphText(ROUNDS, [...ROOMS, 'R4.BEST: 1 OF 6->R5', ...AFTER]);
const WITHOUT = graphText(ROUNDS, [...ROOMS, ...AFTER]);

function draftOf(text: string): WaterfallDraft {
  const parsed = parseWaterfallDraft(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** Whether the text is a graph the engine accepts at 24 entrants. */
function accepted(text: string): string {
  const parsed = parseWaterfallGraph(text);
  if (!parsed.ok) return parsed.error;
  const result = validateAndOrderWaterfallGraph(parsed.value, { roomSize: ROOM_SIZE, entrantCount: 24 });
  return result.ok ? '' : result.error;
}

describe('a BEST line in the draft', () => {
  it('is read with its place, count and destination', () => {
    expect(draftOf(EXAMPLE).best).toEqual({ R4: { place: 6, count: 1, destination: 'R5' } });
  });

  it('is absent from a draft whose graph has no BEST line', () => {
    expect(draftOf(WITHOUT).best).toBeUndefined();
  });

  it('is written back after the round’s room lines, and reads again as the same draft', () => {
    const text = serializeWaterfallDraft(draftOf(EXAMPLE));
    expect(text).toContain('R4.BEST: 1 OF 6->R5');
    expect(text.indexOf('R4.C:')).toBeLessThan(text.indexOf('R4.BEST:'));
    expect(draftOf(text)).toEqual(draftOf(EXAMPLE));
    expect(accepted(text)).toBe('');
  });

  it('round-trips a spaced round name and a lower case line', () => {
    const spaced = graphText(
      ['Round 4 Upper = 3x8', 'Round 5 = 2x8', 'Final = 8 FINAL'],
      [
        ...['A', 'B', 'C'].map((room) => `Round 4 Upper.${room}: 1-5->Round 5, 6-8->eliminated`),
        'round 4 upper.best: 1 of 6 -> Round 5',
        'Round 5.A: 1-4->Final, 5-8->eliminated',
        'Round 5.B: 1-4->Final, 5-8->eliminated',
      ],
    );
    const draft = draftOf(spaced);
    expect(draft.best).toEqual({ 'Round 4 Upper': { place: 6, count: 1, destination: 'Round 5' } });
    expect(serializeWaterfallDraft(draft)).toContain('Round 4 Upper.BEST: 1 OF 6->Round 5');
  });

  it('refuses a line for a round, or to a destination, that is not declared', () => {
    const noRound = graphText(ROUNDS, [...ROOMS, 'R9.BEST: 1 OF 6->R5', ...AFTER]);
    const noDestination = graphText(ROUNDS, [...ROOMS, 'R4.BEST: 1 OF 6->R9', ...AFTER]);
    const refusals = [noRound, noDestination].map((text) => {
      const result = parseWaterfallDraft(text);
      return result.ok ? '' : result.error;
    });
    expect(refusals[0]).toBe('ROUTES references round "R9", which isn\'t declared in ROUNDS.');
    expect(refusals[1]).toBe('Round "R4" routes to "R9", which isn\'t declared in ROUNDS.');
  });
});

describe('setting the best of a place', () => {
  it('writes the line, and null takes it away', () => {
    const set = setWaterfallBest(draftOf(WITHOUT), 'R4', { place: 6, count: 1, destination: 'R5' });
    expect(set.best).toEqual({ R4: { place: 6, count: 1, destination: 'R5' } });
    expect(serializeWaterfallDraft(set)).toContain('R4.BEST: 1 OF 6->R5');
    const cleared = setWaterfallBest(set, 'R4', null);
    expect(cleared.best).toBeUndefined();
    expect(serializeWaterfallDraft(cleared)).not.toContain('BEST');
  });

  it('changes the count without touching the rest of the draft', () => {
    const changed = setWaterfallBest(draftOf(EXAMPLE), 'R4', { place: 6, count: 2, destination: 'R5' });
    expect(changed.routes).toEqual(draftOf(EXAMPLE).routes);
    expect(changed.best?.R4.count).toBe(2);
  });
});

describe('the best of a place follows the edits of the draft', () => {
  it('follows a renamed round and a renamed destination', () => {
    const source = renameWaterfallRound(draftOf(EXAMPLE), 'R4', 'Round 4');
    expect(source.ok && source.value.best).toEqual({ 'Round 4': { place: 6, count: 1, destination: 'R5' } });
    const destination = renameWaterfallRound(draftOf(EXAMPLE), 'R5', 'Round 5');
    expect(destination.ok && destination.value.best).toEqual({
      R4: { place: 6, count: 1, destination: 'Round 5' },
    });
  });

  it('follows renames made all at once', () => {
    const renamed = renameWaterfallRounds(
      draftOf(EXAMPLE),
      new Map([
        ['R4', 'R5'],
        ['R5', 'R6'],
      ]),
    );
    expect(renamed.best).toEqual({ R5: { place: 6, count: 1, destination: 'R6' } });
  });

  it('is dropped with its round, or when its destination is removed', () => {
    expect(removeWaterfallRound(draftOf(EXAMPLE), 'R4').best).toBeUndefined();
    expect(removeWaterfallRound(draftOf(EXAMPLE), 'R5').best).toBeUndefined();
  });

  it('is kept when another round is removed', () => {
    const three = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'Spare = 8', 'Final = 8 FINAL'],
      [...ROOMS, 'R4.BEST: 1 OF 6->R5', ...AFTER],
    );
    expect(removeWaterfallRound(draftOf(three), 'Spare').best).toEqual({
      R4: { place: 6, count: 1, destination: 'R5' },
    });
  });

  it('is dropped when a resize leaves its place past the room size, or leaves one room', () => {
    expect(resizeWaterfallRound(draftOf(EXAMPLE), 'R4', 3, 5).best).toBeUndefined();
    expect(resizeWaterfallRound(draftOf(EXAMPLE), 'R4', 1, 8).best).toBeUndefined();
  });

  it('keeps its count under the rooms left, and is untouched by a resize that keeps the place', () => {
    expect(resizeWaterfallRound(draftOf(EXAMPLE), 'R4', 4, 8).best?.R4.count).toBe(1);
    const two = setWaterfallBest(draftOf(EXAMPLE), 'R4', { place: 6, count: 2, destination: 'R5' });
    expect(resizeWaterfallRound(two, 'R4', 2, 8).best?.R4.count).toBe(1);
    expect(resizeWaterfallRound(two, 'R4', 3, 7).best).toEqual(two.best);
  });

  it('is dropped when the round becomes the Final or a ranking match', () => {
    expect(setWaterfallFinal(draftOf(EXAMPLE), 'R4', true).best).toBeUndefined();
    expect(setWaterfallRanking(draftOf(EXAMPLE), 'R4', true).best).toBeUndefined();
  });
});

describe('the flow of a draft with a best of a place', () => {
  it('counts the chosen units into the destination: 15 + 1 = 16 into R5', () => {
    const draft = draftOf(EXAMPLE);
    expect(waterfallRoundIntake(draft).incoming.R5).toBe(16);
    const toR5 = waterfallFlowEdges(draft).find((edge) => edge.from === 'R4' && edge.to === 'R5');
    expect(toR5?.players).toBe(16);
    const out = waterfallFlowEdges(draft).find((edge) => edge.from === 'R4' && edge.to === 'eliminated');
    expect(out?.players).toBe(8);
  });

  it('takes the chosen units away from where the rest go: 3 − 1 = 2 into a Lower round', () => {
    const lower = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'R5L = 6', 'Final = 8 FINAL'],
      [
        ...['A', 'B', 'C'].map((room) => `R4.${room}: 1-5->R5, 6->R5L, 7-8->eliminated`),
        'R4.BEST: 1 OF 6->R5',
        'R5.A: 1-3->Final, 4-5->R5L, 6-8->eliminated',
        'R5.B: 1-3->Final, 4-5->R5L, 6-8->eliminated',
        'R5L: 1-2->Final',
      ],
    );
    const incoming = waterfallRoundIntake(draftOf(lower)).incoming;
    expect(incoming.R5).toBe(16);
    expect(incoming.R5L).toBe(6);
  });

  it('is the flow of the graph without the line when there is none', () => {
    expect(waterfallRoundIntake(draftOf(WITHOUT)).incoming.R5).toBe(15);
  });

  it('orders a round fed only by the best of a place after its source', () => {
    const only = graphText(
      ['R4 = 3x8', 'R5 = 2x8', 'Extra = 2', 'Final = 11 FINAL'],
      [
        ...['A', 'B', 'C'].map((room) => `R4.${room}: 1-5->R5`),
        'R4.BEST: 2 OF 6->Extra',
        'Extra: 1-2->Final',
        'R5.A: 1-3->Final',
        'R5.B: 1-3->Final',
      ],
    );
    const { order } = waterfallRoundIntake(draftOf(only));
    expect(order.indexOf('R4')).toBeLessThan(order.indexOf('Extra'));
    expect(order.indexOf('Extra')).toBeLessThan(order.indexOf('Final'));
  });
});

describe('what the field offers', () => {
  it('offers the rounds that come after the round, never itself or an earlier one', () => {
    const draft = draftOf(EXAMPLE);
    expect(bestDestinationChoices(draft, 'R4')).toEqual(['R5', 'Final']);
    expect(bestDestinationChoices(draft, 'R5')).toEqual(['Final']);
  });

  it('suggests the first later round the rest of the place do not go to', () => {
    expect(suggestedBest(draftOf(WITHOUT), 'R4', 6)).toEqual({ place: 6, count: 1, destination: 'R5' });
    const toR5 = graphText(ROUNDS, [
      ...['A', 'B', 'C'].map((room) => `R4.${room}: 1-6->R5, 7-8->eliminated`),
      ...AFTER,
    ]);
    // Place 6 already goes to R5 in every room: the chosen ones can't go there too.
    expect(suggestedBest(draftOf(toR5), 'R4', 6)).toEqual({ place: 6, count: 1, destination: 'Final' });
  });

  it('suggests nothing for a round with fewer than two rooms or no later round', () => {
    expect(suggestedBest(draftOf(EXAMPLE), 'R5', 4)).toBeNull();
    expect(suggestedBest(resizeWaterfallRound(draftOf(WITHOUT), 'R4', 1, 8), 'R4', 6)).toBeNull();
  });
});

describe('the draft of a running tournament', () => {
  it('shows the BEST line of a drawn round, destination by label', () => {
    const state = buildQualWaterfall(
      37,
      graphText(ROUNDS, ['Qual: 1-24->R4', ...ROOMS, 'R4.BEST: 1 OF 6->R5', ...AFTER]),
    );
    const draft = waterfallDraftFromRounds(state.rounds);
    expect(draft.best).toEqual({ R4: { place: 6, count: 1, destination: 'R5' } });
    expect(serializeWaterfallDraft(draft)).toContain('R4.BEST: 1 OF 6->R5');
  });

  it('shows no best for a tournament drawn without one', () => {
    const state = buildQualWaterfall(
      37,
      graphText(ROUNDS, ['Qual: 1-24->R4', 'R4.A: 1-6->R5, 7-8->eliminated', ...ROOMS.slice(1), ...AFTER]),
    );
    expect(waterfallDraftFromRounds(state.rounds).best).toBeUndefined();
  });
});
