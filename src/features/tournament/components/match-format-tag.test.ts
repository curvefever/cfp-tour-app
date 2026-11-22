import { describe, expect, it } from 'vitest';
import { gameCountText, isMatchFormatCount, roundMatchTag } from './match-format-tag';
import { buildRound } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../../domain/tournament/state-defaults';

describe('the match format tag', () => {
  it('reads "BEST OF 3", "UNEVEN WINS 1 · 2", "2 GAMES", "1 GAME" and "UP TO 4 GAMES"', () => {
    expect(gameCountText({ games: 3, upTo: false, bestOf: true })).toBe('BEST OF 3');
    expect(gameCountText({ games: 2, upTo: false, wins: [1, 2] })).toBe('UNEVEN WINS 1 · 2');
    expect(gameCountText({ games: 2, upTo: false })).toBe('2 GAMES');
    expect(gameCountText({ games: 1, upTo: false })).toBe('1 GAME');
    expect(gameCountText({ games: 4, upTo: true })).toBe('UP TO 4 GAMES');
  });

  it('marks a Best of N, uneven wins and summed games as a match format, and one game or the race Grand Final not', () => {
    expect(isMatchFormatCount({ games: 3, upTo: false, bestOf: true })).toBe(true);
    expect(isMatchFormatCount({ games: 2, upTo: false, wins: [1, 2] })).toBe(true);
    expect(isMatchFormatCount({ games: 2, upTo: false })).toBe(true);
    expect(isMatchFormatCount({ games: 1, upTo: false })).toBe(false);
    expect(isMatchFormatCount({ games: 4, upTo: true })).toBe(false);
  });

  it('gives a round its tag, and a round of one game none', () => {
    const state = createDefaultTournamentState({
      rounds: [
        buildRound({ roundNum: 1, bestOf: 3, numGames: 3 }),
        buildRound({ roundNum: 2, numGames: 2 }),
        buildRound({ roundNum: 3, isFinal: true, numGames: 1 }),
        buildRound({ roundNum: 4 }),
      ],
    });
    expect([0, 1, 2, 3].map((index) => roundMatchTag(state, index))).toEqual([
      'BEST OF 3',
      '2 GAMES',
      undefined,
      undefined,
    ]);
  });
});
