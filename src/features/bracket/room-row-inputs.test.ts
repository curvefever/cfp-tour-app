import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { luckyLoserNames } from './room-row-inputs';

describe('luckyLoserNames', () => {
  const state = createDefaultTournamentState({
    rounds: [
      buildRound({ roundNum: 1, rooms: [4], players: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4 }),
      buildRound({ roundNum: 3, rooms: [4], players: 4, winnersTo: 0 }),
    ],
    luckyLosers: [['P9'], ['P1', 'P2']],
  });

  it('reads the lucky losers of the next round', () => {
    expect(luckyLoserNames(state, 0)).toEqual(['P1', 'P2']);
  });

  it('follows the round the winners go to when it is not the next one', () => {
    expect(luckyLoserNames(state, 2)).toEqual(['P9']);
  });

  it('is empty when none are named', () => {
    expect(luckyLoserNames(state, 1)).toEqual([]);
  });
});
