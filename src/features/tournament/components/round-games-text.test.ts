import { describe, expect, it } from 'vitest';
import { roundGamesText } from './round-games-text';

describe('roundGamesText', () => {
  it('words each kind of round', () => {
    expect(roundGamesText({ games: 3, upTo: false })).toBe('3 games');
    expect(roundGamesText({ games: 1, upTo: false })).toBe('1 game');
    expect(roundGamesText({ games: 3, upTo: true })).toBe('up to 3 games');
    expect(roundGamesText({ games: 3, upTo: false, bestOf: true })).toBe('best of 3');
    expect(roundGamesText({ games: 5, upTo: false, wins: [3, 2] })).toBe('uneven wins 3 · 2');
  });
});
