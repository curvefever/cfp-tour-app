import { describe, expect, it } from 'vitest';
import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import { bracketBoxes } from '../../domain/tournament/bracket';
import { isRoundDone, roundsInPlay } from '../../domain/tournament/round-columns';
import { describeStandings } from '../../domain/tournament/standings-display';
import {
  THREE_CHAIN_GRAPH,
  atEntry,
  indexOf,
  pressed,
  scoreRound,
} from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { withDependencyPlay } from '../../domain/tournament/__tests__/qual-waterfall';
import type { TournamentState } from '../../domain/tournament/types';
import {
  boxHoldingRound,
  defaultStripSelection,
  pickedItemKey,
  roundStrip,
  roundStripBoxLabels,
} from './round-strip';

/** A fixture tournament as the app holds it, with the round in play moved to `curRound` when given. */
function fixtureAt(id: string, curRound?: number): TournamentState {
  const fixture = fixtureTournaments().find((entry) => entry.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  const state = loadedState(fixture);
  return curRound === undefined ? state : { ...state, curRound };
}

/** The strip as text: each label, then ✓ when done and ● when in play. */
function strip(state: TournamentState): string[] {
  return roundStrip(state, describeStandings(state)).map(
    (item) => `${item.label}${item.done ? ' ✓' : ''}${item.now ? ' ●' : ''}`,
  );
}

describe('roundStrip, FFA 37 with a qualification table', () => {
  it('lists every round before the start, nothing folded or in play, the table after Round 3', () => {
    expect(strip(fixtureAt('drawn-ffa-31'))).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Qualification',
      'Round 4',
      'Round 5',
      'Semis',
      'Final',
    ]);
  });

  it('keeps a single finished round as its own item with a tick', () => {
    expect(strip(fixtureAt('ffa37-pooling', 1))).toEqual([
      'Round 1 ✓',
      'Round 2 ●',
      'Round 3',
      'Qualification',
      'Round 4',
      'Round 5',
      'Semis',
      'Final',
    ]);
  });

  it('folds two finished rounds into one item, naming the round numbers it covers', () => {
    expect(strip(fixtureAt('ffa37-pooling', 2))).toEqual([
      'R1–2 ✓',
      'Round 3 ●',
      'Qualification',
      'Round 4',
      'Round 5',
      'Semis',
      'Final',
    ]);
  });

  it('puts the table right after the group once the pooling rounds are all finished', () => {
    expect(strip(fixtureAt('ffa37-quarters'))).toEqual([
      'R1–3 ✓',
      'Qualification',
      'Round 4 ●',
      'Round 5',
      'Semis',
      'Final',
    ]);
  });

  it('keeps the table after the group during the Final, the Semis finished', () => {
    expect(strip({ ...fixtureAt('ffa37-final-complete'), finalScores: {} })).toEqual([
      'R1–6 ✓',
      'Qualification',
      'Final ●',
    ]);
  });

  it('shows no NOW once the Final is complete', () => {
    expect(strip(fixtureAt('ffa37-finished'))).toEqual(['R1–6 ✓', 'Qualification', 'Final']);
  });

  it('leaves the standings item out when the format has no standings phase', () => {
    const state = fixtureAt('ffa43-quarters');
    const withoutPooling = { ...state, rounds: state.rounds.map((round) => ({ ...round, isQual: false })) };

    expect(describeStandings(withoutPooling)).toBeNull();
    expect(strip(withoutPooling)).toEqual(['R1–3 ✓', 'Round 4 ●', 'Round 5', 'Semis', 'Final']);
  });

  it('gives the same strip at 43 and 53 players as at 37 (the shape follows the schedule)', () => {
    expect(strip(fixtureAt('ffa43-quarters'))).toEqual(strip(fixtureAt('ffa37-quarters')));
    expect(strip(fixtureAt('ffa53-quarters'))).toEqual(strip(fixtureAt('ffa37-quarters')));
  });
});

describe('roundStrip, other formats', () => {
  it('2v2v2v2 with 13 teams: the table after Round 3, the Semis in play', () => {
    expect(strip(fixtureAt('teams2v2-13'))).toEqual(['R1–3 ✓', 'Qualification', 'Semis ●', 'Final']);
  });

  it('names the Swiss table after its phase', () => {
    expect(strip(fixtureAt('teams-4v4-13'))).toEqual(['R1–4 ✓', 'Swiss', 'Round 5 ●', 'Semis', 'Final']);
  });

  it('names the group stage table "Groups" and puts it after its last round', () => {
    const items = strip(fixtureAt('groups-1v1-13', 0));
    expect(items.slice(3, 8)).toEqual(['Round 4', 'Round 5', 'Groups', 'Round 6', 'Semis']);
  });

  it('Kings Valley with 12 before the start: every round its own item, none folded', () => {
    expect(strip(fixtureAt('kings-valley-12', 0))).toEqual([
      'Round 1 ●',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Round 6',
      'Final',
    ]);
  });
});

describe('roundStrip, double elimination 1v1 with 16', () => {
  it('labels each wave "Round N" by its column, and the last box "Grand Final"', () => {
    const items = strip(fixtureAt('double-elim-1v1-16', 0));
    expect(items).toHaveLength(7);
    expect(items.slice(2, 6)).toEqual(['Round 3', 'Round 4', 'Round 5', 'Round 6']);
    expect(items[6]).toBe('Grand Final');
  });

  it('a wave is done only when all of its rounds are', () => {
    // Round index 5 is the first losers round of the wave that starts at index 4: that wave is in play, not done.
    // The group runs to the last finished box, column 3 (its losers round is stored as round 4).
    const midWave = strip(fixtureAt('double-elim-1v1-16', 5));
    expect(midWave).toEqual(['R1–3 ✓', 'Round 4 ●', 'Round 5', 'Round 6', 'Grand Final']);
    // Once index 7 is in play that wave is done and the next one is in play.
    expect(strip(fixtureAt('double-elim-1v1-16', 7))).toEqual([
      'R1–4 ✓',
      'Round 5 ●',
      'Round 6',
      'Grand Final',
    ]);
  });
});

describe('roundStrip, waterfall columns', () => {
  it('a column of several rounds is one item, labelled by its first round', () => {
    expect(strip(fixtureAt('waterfall-column-19'))).toEqual([
      'R1–3 ✓',
      'Qualification',
      'Round 5 Upper ●',
      'Semi A',
      'Round 7',
      'Semi-B',
      'Final',
    ]);
  });

  it('a group ending in a column spans the round numbers of that column', () => {
    expect(strip(fixtureAt('waterfall-column-19', 5))).toEqual([
      'R1–5 ✓',
      'Qualification',
      'Semi A ●',
      'Round 7',
      'Semi-B',
      'Final',
    ]);
  });
});

describe('roundStrip, dependency play', () => {
  it('puts NOW on every box that holds a round in play, and a tick on a box only once every round of it is done', () => {
    // SemiA, R6R and R6L are in play: the boxes [SemiA, R5L, R5R] and [R6L, R6R] both hold one (a ranking room is listed last); R4U and R4L are done.
    const state = fixtureAt('dependency-play-in-play');
    const items = roundStrip(state, describeStandings(state));
    const named = (label: string) => items.find((item) => item.label === label);
    expect(named('SemiA')?.now).toBe(true);
    expect(named('SemiA')?.done).toBe(false);
    expect(named('R6L')?.now).toBe(true);
    expect(named('SemiB')?.now).toBe(false);
  });

  it('groups only the finished boxes before the first one that is not finished', () => {
    const state = fixtureAt('dependency-play-in-play');
    const group = roundStrip(state, describeStandings(state)).find((item) => item.kind === 'group');
    // The pooling rounds and the first column are done; the boxes after the column in play are not grouped.
    expect(group?.done).toBe(true);
    const boxes = group?.boxes ?? [];
    expect(boxes).toEqual(boxes.map((_, index) => index));
    expect(state.rounds[state.curRound].customLabel).toBe('SemiA');
  });

  it('groups only the finished boxes before the first unfinished one, though a later box is finished too', () => {
    // Three chains: T3 is sent on while Z2, in the box before it, is still in play.
    let state = withDependencyPlay(atEntry(31, THREE_CHAIN_GRAPH, { qualAdv: '24' }));
    const t3 = indexOf(state, 'T3');
    const z2 = indexOf(state, 'Z2');
    for (let guard = 0; guard < 30 && !isRoundDone(state, t3); guard += 1) {
      for (const index of roundsInPlay(state)) if (index !== z2) state = scoreRound(state, index);
      state = pressed(state);
    }
    expect(isRoundDone(state, t3)).toBe(true);
    expect(isRoundDone(state, z2)).toBe(false);
    const boxes = bracketBoxes(state);
    const t3Box = boxes.findIndex((box) => box.kind === 'single' && box.roundIndex === t3);
    const firstUnfinished = boxes.findIndex((box) => box.kind === 'column' && box.roundIndices.includes(z2));
    expect(firstUnfinished).toBeLessThan(t3Box);
    const items = roundStrip(state, describeStandings(state));
    const group = items.find((item) => item.kind === 'group');
    // The leading finished boxes only: not the finished T3 box after the unfinished one.
    expect(group?.boxes).toEqual(Array.from({ length: firstUnfinished }, (_, index) => index));
    expect(group?.boxes).not.toContain(t3Box);
    const t3Item = items.find((item) => item.boxes.includes(t3Box));
    expect(t3Item?.kind).toBe('box');
    expect(t3Item?.done).toBe(true);
  });

  it('shows by default the box of the first round in play, the one curRound is in', () => {
    const state = fixtureAt('dependency-play-in-play');
    const labels = roundStripBoxLabels(state);
    expect(labels[defaultStripSelection(state)]).toBe('SemiA');
  });
});

describe('roundStrip items', () => {
  it('say which boxes they stand for, and the table none', () => {
    const state = fixtureAt('ffa37-quarters');
    const items = roundStrip(state, describeStandings(state));

    expect(items.map((item) => [item.kind, item.boxes])).toEqual([
      ['group', [0, 1, 2]],
      ['standings', []],
      ['box', [3]],
      ['box', [4]],
      ['box', [5]],
      ['box', [6]],
    ]);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });
});

describe('defaultStripSelection', () => {
  it('is the first box before the start', () => {
    expect(defaultStripSelection(fixtureAt('drawn-ffa-31'))).toBe(0);
  });

  it('follows the round in play', () => {
    expect(defaultStripSelection(fixtureAt('ffa37-quarters', 3))).toBe(3);
    expect(defaultStripSelection(fixtureAt('ffa37-quarters', 4))).toBe(4);
    expect(defaultStripSelection(fixtureAt('ffa37-quarters', 5))).toBe(5);
  });

  it('is the Final once the tournament is finished', () => {
    expect(defaultStripSelection(fixtureAt('ffa37-finished'))).toBe(6);
  });

  it('is the box holding the column in play: a waterfall column, a wave', () => {
    expect(defaultStripSelection(fixtureAt('waterfall-column-19', 3))).toBe(3);
    expect(defaultStripSelection(fixtureAt('waterfall-column-19', 5))).toBe(4);
    expect(defaultStripSelection(fixtureAt('double-elim-1v1-16', 5))).toBe(3);
  });
});

describe('pickedItemKey and roundStripBoxLabels', () => {
  const state = fixtureAt('ffa37-quarters');
  const items = roundStrip(state, describeStandings(state));

  it('maps a pick to the item that stands for it: a group for its boxes, the standings for itself', () => {
    expect(pickedItemKey(items, { kind: 'box', index: 1 })).toBe('group');
    expect(pickedItemKey(items, { kind: 'box', index: 3 })).toBe('box-3');
    expect(pickedItemKey(items, { kind: 'standings' })).toBe('standings');
    expect(
      pickedItemKey(
        items.filter((item) => item.kind !== 'standings'),
        { kind: 'standings' },
      ),
    ).toBeUndefined();
  });

  it('names every box by its own title', () => {
    expect(roundStripBoxLabels(state)).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Semis',
      'Final',
    ]);
    expect(roundStripBoxLabels(fixtureAt('double-elim-1v1-16'))).toEqual([
      'Round 1',
      'Round 2',
      'Round 3',
      'Round 4',
      'Round 5',
      'Round 6',
      'Grand Final',
    ]);
  });
});

describe('the phone strip of a column holding a ranking room', () => {
  it('names the column for its first round that is not a ranking room', () => {
    const state = fixtureAt('upper-lower-31');
    const labels = roundStripBoxLabels(state);
    expect(labels).toContain('Semi-Final A');
    expect(labels).toContain('Round 6 - Lower');
    expect(labels).not.toContain('Round 5 - Ranking');
    expect(labels).not.toContain('Round 6 - Ranking');
  });

  it('still finds the box of a ranking room by its round', () => {
    const state = fixtureAt('upper-lower-31');
    const boxes = bracketBoxes(state);
    const ranking = state.rounds.findIndex((round) => round.customLabel === 'Round 5 - Ranking');
    expect(roundStripBoxLabels(state)[boxHoldingRound(boxes, ranking)]).toBe('Semi-Final A');
  });
});
