import { describe, expect, it } from 'vitest';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { A, B, C, EXAMPLE, graphText, namesIn, scoreRooms, seatOf } from './best-place-fixtures';
import { atEntry, indexOf, pressed, scoreRound } from './dependency-play-fixtures';
import { withDependencyPlay } from './qual-waterfall';

/** Edit graph with a "best of a place" line: a round not drawn yet takes any change, a drawn round only one its replay accepts. */

const R4_LINES = [
  'R4.A: 1-6->R5, 7-8->eliminated',
  'R4.B: 1-5->R5, 6-8->eliminated',
  'R4.C: 1-5->R5, 6-8->eliminated',
];
/** R5 sends 7 to the Final, the 4th of its first room among them. */
const lateGraph = (r5Lines: string[]) =>
  graphText(['R4 = 3x8', 'R5 = 2x8', 'Final = 7 FINAL'], ['Qual: 1-24->R4', ...R4_LINES, ...r5Lines]);
const LATE_PLAIN = lateGraph(['R5.A: 1-4->Final, 5-8->eliminated', 'R5.B: 1-3->Final, 4-8->eliminated']);
const LATE_BEST = lateGraph([
  'R5.A: 1-3->Final, 4-8->eliminated',
  'R5.B: 1-3->Final, 4-8->eliminated',
  'R5.BEST: 1 OF 4->Final',
]);

function edited(state: Parameters<typeof applyWaterfallGraphEdit>[0], text: string) {
  const result = applyWaterfallGraphEdit(state, text);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('Edit graph, a best of a place on a round not drawn yet', () => {
  const entry = atEntry(37, LATE_PLAIN);

  it('is added, with the destination as an absolute round index', () => {
    const state = edited(entry, LATE_BEST);
    const r5 = state.rounds[indexOf(state, 'R5')];
    expect(r5.waterfallBest).toEqual({ place: 4, count: 1, destination: indexOf(state, 'Final') });
    expect(state.settings?.waterfallGraph).toBe(LATE_BEST);
  });

  it('is removed again without leaving the field behind', () => {
    const withBest = edited(entry, LATE_BEST);
    const state = edited(withBest, LATE_PLAIN);
    expect('waterfallBest' in state.rounds[indexOf(state, 'R5')]).toBe(false);
  });
});

describe('Edit graph, a best of a place on a round already drawn', () => {
  const R7TH = EXAMPLE.replace('R4.BEST: 1 OF 6->R5', 'R4.BEST: 1 OF 7->R5');
  const entry = withDependencyPlay(atEntry(37, EXAMPLE));
  const scored = scoreRooms(entry, indexOf(entry, 'R4'), [A, B, C]);
  const sent = pressed(scored);

  it('accepts the unchanged line after the round was sent on', () => {
    const state = edited(sent, EXAMPLE);
    expect(state.rounds[indexOf(state, 'R4')].waterfallBest).toEqual(
      sent.rounds[indexOf(sent, 'R4')].waterfallBest,
    );
    expect(namesIn(state, 'R5').sort()).toEqual(namesIn(sent, 'R5').sort());
  });

  it('takes a changed place and draws the round again with the units it now sends', () => {
    const state = edited(sent, R7TH);
    expect(state.rounds[indexOf(state, 'R4')].waterfallBest?.place).toBe(7);
    const r5 = namesIn(state, 'R5');
    expect(r5).toHaveLength(16);
    expect(r5).toContain(seatOf(scored, 1, 6));
    expect(r5).not.toContain(seatOf(scored, 3, 5));
  });

  it('refuses it once a score is entered in the round the change would redraw', () => {
    const playing = scoreRound(sent, indexOf(sent, 'R5'));
    const result = applyWaterfallGraphEdit(playing, R7TH);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('a score has already been entered in "R5"');
  });
});
