import { describe, expect, it } from 'vitest';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { roundNoteNames } from '../../domain/tournament/round-notes';
import type { TournamentState } from '../../domain/tournament/types';
import { ROUND_COLUMN_WIDTH, roundColumnWidth } from './game-columns';

const widthOf = (state: TournamentState, name: string, editable = false) =>
  roundColumnWidth(state, [roundNoteNames(state).indexOf(name)], editable);

describe('roundColumnWidth', () => {
  /** FFA at 37: qualification rounds of 2 games, a Best of 3 Final in a room of 8 (up to 9 games), the Semis one game. */
  const state = generated(37, { qualAdv: '30', poolingGames: '2', finalsBestOf: '3' });

  it('keeps 330 px for a round of one game', () => {
    expect(widthOf(state, 'Semis')).toBe(ROUND_COLUMN_WIDTH);
    expect(widthOf(state, 'Round 4')).toBe(ROUND_COLUMN_WIDTH);
  });

  it('grows with the game columns: 9 games of the Final need more than 2 games of a qualification round', () => {
    expect(widthOf(state, 'Round 1')).toBeGreaterThan(ROUND_COLUMN_WIDTH);
    expect(widthOf(state, 'Final')).toBeGreaterThan(widthOf(state, 'Round 1'));
  });

  it('adds the same width for every game column', () => {
    const final = widthOf(state, 'Final');
    const two = widthOf(state, 'Round 1');
    expect(final - two).toBe(46 * (9 - 2));
  });

  it('keeps the width of a room whose rows take the score inputs (an admin at the round in play), but not of the Final', () => {
    expect(widthOf(state, 'Round 1', true)).toBe(ROUND_COLUMN_WIDTH);
    expect(widthOf(state, 'Final', true)).toBeGreaterThan(ROUND_COLUMN_WIDTH);
  });

  it('is the widest of the rounds played in one column', () => {
    const rounds = [roundNoteNames(state).indexOf('Semis'), roundNoteNames(state).indexOf('Final')];
    expect(roundColumnWidth(state, rounds, false)).toBe(widthOf(state, 'Final'));
  });
});
