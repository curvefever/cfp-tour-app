import { describe, expect, it } from 'vitest';
import { projectFutureRoundSlots, projectedSlotLabelText } from '../bracket';
import { expectedRounds } from '../expected-draw';
import type { TournamentState } from '../types';
import {
  SEED_LINES_GRAPH,
  atSwissExit,
  exitOrder,
  favouritesWin,
  indexOfLabel,
  pressed,
  roomNames,
} from './seed-lines-fixtures';
import { swiss } from './swiss-source-fixtures';

/**
 * The Bracket's preview and the expected draw of the organiser's 13-unit example (`seed-lines-fixtures.ts`): the lines
 * are fixed, so every slot of a round drawn by seed lines names the room it comes from.
 */

/** The preview of a round as rooms of label texts, drawn before the tournament starts. */
function previewOf(state: TournamentState, label: string): string[][] {
  const slots = projectFutureRoundSlots(state)[indexOfLabel(state, label)];
  return (slots ?? []).map((room) => room.map(projectedSlotLabelText));
}

describe('the preview before the start', () => {
  const unstarted = swiss(13, { swissRoundsOverride: '5' }, SEED_LINES_GRAPH);

  it('the Quarter-finals pair Qual 1 with Round 6 room B (the room of Qual 8) and Qual 2 with room A', () => {
    expect(previewOf(unstarted, 'QF')).toEqual([
      ['Qualification #1', 'R6 · Room B, Rank 1'],
      ['Qualification #2', 'R6 · Room A, Rank 1'],
      ['Qualification #3', 'Qualification #6'],
      ['Qualification #4', 'Qualification #5'],
    ]);
  });

  it('the Semi-finals and the ranking round follow the lines: room A with room D, room B with room C', () => {
    expect(previewOf(unstarted, 'SF')).toEqual([
      ['QF · Room A, Rank 1', 'QF · Room D, Rank 1'],
      ['QF · Room B, Rank 1', 'QF · Room C, Rank 1'],
    ]);
    expect(previewOf(unstarted, 'R58')).toEqual([
      ['QF · Room A, Rank 2', 'QF · Room D, Rank 2'],
      ['QF · Room B, Rank 2', 'QF · Room C, Rank 2'],
    ]);
  });

  it('Round 6 keeps its standings places, drawn as the exit draws them', () => {
    expect(previewOf(unstarted, 'R6')).toEqual([
      ['Qualification #7', 'Qualification #10'],
      ['Qualification #8', 'Qualification #9'],
    ]);
  });
});

describe('the expected draw after Round 6 is scored', () => {
  it('the Quarter-finals expected are Qual 1 v the winner of the room of Qual 8, as the press then draws them', () => {
    const entered = pressed(atSwissExit());
    const order = exitOrder(entered);
    const scored = favouritesWin(entered, 'R6');
    const expected = expectedRounds(scored)?.get(indexOfLabel(scored, 'QF'));
    const place = (name: string) => order.indexOf(name) + 1;
    const rooms = [1, 2, 3, 4].map((room) =>
      (expected?.assignments ?? []).filter((entry) => entry.room === room).map((entry) => place(entry.name)),
    );
    expect(rooms).toEqual([
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5],
    ]);
    const drawn = pressed(scored);
    expect(roomNames(drawn, 'QF', 1)).toEqual(
      (expected?.assignments ?? []).filter((entry) => entry.room === 1).map((entry) => entry.name),
    );
  });
});
