import { describe, expect, it } from 'vitest';
import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import { describeStandings } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { defaultStripSelection, pickedItemKey, roundStrip, roundStripBoxLabels } from './round-strip';

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
