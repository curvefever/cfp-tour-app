import { describe, expect, it } from 'vitest';
import {
  matchFormatFields,
  matchFormatToken,
  parseMatchFormatToken,
  sameMatchFormat,
  sameRoundFormat,
} from '../match-format';
import { storesGames } from '../round-match-formats';
import { parseWaterfallGraph } from '../waterfall-graph-text';

describe('parseMatchFormatToken and matchFormatToken', () => {
  it('reads a Best of N or summed games, either word in any case, and nothing else', () => {
    expect(parseMatchFormatToken('BO3')).toEqual({ games: 1, bestOf: 3 });
    expect(parseMatchFormatToken('bo9')).toEqual({ games: 1, bestOf: 9 });
    expect(parseMatchFormatToken('  Games   4 ')).toEqual({ games: 4 });
    for (const text of ['', 'BO', 'BO4', 'BO11', 'GAMES', 'GAMES 0', 'GAMES 5', 'GAMES two', 'GAMES2']) {
      expect(parseMatchFormatToken(text)).toBeNull();
    }
    for (const text of ['BO3 BO5', 'BO3 GAMES 2', 'GAMES 2 3', 'BO3 FINAL', 'FINAL', 'RANKING', 'COLUMN 2']) {
      expect(parseMatchFormatToken(text)).toBeNull();
    }
  });

  it('is read back from what it writes', () => {
    const formats = [3, 5, 7, 9]
      .map((bestOf) => ({ games: 1, bestOf }))
      .concat([1, 2, 3, 4].map((games) => ({ games }) as { games: number; bestOf: number }));
    for (const format of formats) {
      expect(parseMatchFormatToken(matchFormatToken(format))).toEqual(format);
    }
    expect(matchFormatToken({ games: 2 })).toBe('GAMES 2');
    expect(matchFormatToken({ games: 1, bestOf: 5 })).toBe('BO5');
  });

  it('accepts exactly what a ROUNDS line takes as its one match format', () => {
    const tokens = [
      'BO3',
      'bo7',
      'BO2',
      'BO',
      'GAMES 1',
      'games 4',
      'GAMES 5',
      'GAMES',
      'BO3 BO5',
      'GAMES 2 BO3',
    ];
    for (const token of tokens) {
      const line = parseWaterfallGraph(`ROUNDS:\nR1 = 4 ${token}\nROUTES:`, { allowIncomplete: true });
      const onLine =
        line.ok &&
        (line.value.roundLines[0].bestOf !== undefined || line.value.roundLines[0].games !== undefined);
      expect(parseMatchFormatToken(token) !== null, token).toBe(onLine);
    }
  });
});

describe('the two comparisons of a match format', () => {
  it('compares settings by the N, or by the games when they are summed', () => {
    expect(sameMatchFormat({ games: 1, bestOf: 3 }, { games: 5, bestOf: 3 })).toBe(true);
    expect(sameMatchFormat({ games: 1, bestOf: 3 }, { games: 1, bestOf: 5 })).toBe(false);
    expect(sameMatchFormat({ games: 2 }, { games: 2 })).toBe(true);
    expect(sameMatchFormat({ games: 2 }, { games: 3 })).toBe(false);
  });

  it('compares drawn rounds by the N and the game count, a missing count being one game', () => {
    expect(sameRoundFormat({}, { numGames: 1 })).toBe(true);
    expect(sameRoundFormat({ bestOf: 3, numGames: 3 }, { bestOf: 3, numGames: 5 })).toBe(false);
    expect(sameRoundFormat({ bestOf: 3, numGames: 5 }, { bestOf: 3, numGames: 5 })).toBe(true);
    expect(sameRoundFormat({ numGames: 2 }, { bestOf: 3, numGames: 2 })).toBe(false);
  });
});

describe('matchFormatFields', () => {
  const spec = (extra: object) => ({ label: 'R', roomSizes: [4, 2], isFinal: false, ...extra });

  it('gives a round its own format, and a Final with none the Finals format', () => {
    expect(matchFormatFields(spec({ bestOf: 3 }), 3)).toEqual({ bestOf: 3, numGames: 5 });
    expect(matchFormatFields(spec({ games: 2 }), 3)).toEqual({ numGames: 2 });
    expect(matchFormatFields(spec({ games: 1 }), 3)).toEqual({});
    expect(matchFormatFields(spec({}), 3)).toEqual({});
    expect(matchFormatFields(spec({ isFinal: true }), 3)).toEqual({ numGames: 3 });
    expect(matchFormatFields(spec({ isFinal: true }), 1, 5)).toEqual({ bestOf: 5, numGames: 9 });
    expect(matchFormatFields(spec({ isFinal: true, games: 1 }), 3)).toEqual({ numGames: 1 });
  });
});

describe('storesGames', () => {
  it('always for the Semis and the Final, else only when not one game', () => {
    expect(storesGames('semis', 1)).toBe(true);
    expect(storesGames('finals', 1)).toBe(true);
    for (const stage of ['pooling', 'bracket', 'losers'] as const) {
      expect(storesGames(stage, 1)).toBe(false);
      expect(storesGames(stage, 2)).toBe(true);
    }
  });
});
