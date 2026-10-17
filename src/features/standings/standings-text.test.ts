import { describe, expect, it } from 'vitest';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import {
  formatTieBreak,
  formatTieBreakPrecise,
  roundCells,
  standingsExplanation,
  standingsProgressSentence,
  sharesWholePercent,
} from './standings-text';

function display(overrides: Partial<StandingsDisplay>, cut: number | null): StandingsDisplay {
  return {
    phase: 'live',
    roundsDone: 2,
    roundsTotal: 3,
    firstCountedRoundNum: 2,
    lastStandingsRoundIndex: 2,
    kind: 'qualification',
    perGroup: false,
    tables: [{ key: 'qual-cutoff', label: 'Qualification Table', entries: [], cut }],
    ...overrides,
  };
}

describe('standingsProgressSentence', () => {
  it('says when the standings start before any counted round', () => {
    expect(standingsProgressSentence(display({ phase: 'upcoming' }, 24))).toBe(
      'Standings start after Round 2.',
    );
  });

  it('shows how many rounds are in while live, whatever the cut', () => {
    expect(standingsProgressSentence(display({}, 24))).toBe('After 2 of 3 rounds.');
    expect(standingsProgressSentence(display({ perGroup: true }, 2))).toBe('After 2 of 3 rounds.');
    expect(standingsProgressSentence(display({}, null))).toBe('After 2 of 3 rounds.');
  });

  it('says they are final once the last round is in', () => {
    expect(standingsProgressSentence(display({ phase: 'final' }, 16))).toBe('These are the final standings.');
  });
});

describe('standingsExplanation', () => {
  function stateWith(
    gamemodeConfig: Partial<TournamentState['gamemodeConfig']>,
    roundOverrides: Array<Partial<TournamentState['rounds'][number]>> = [{}, {}, {}],
  ): TournamentState {
    return createDefaultTournamentState({
      gamemodeConfig,
      rounds: roundOverrides.map((overrides, index) =>
        buildRound({ roundNum: index + 1, isQual: true, rooms: [4], players: 4, ...overrides }),
      ),
    });
  }
  const FOUR = { roomSize: { min: 3, max: 4, ideal: 4 } };

  it('starts with where the standings are, so the old context line loses no fact', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[0]).toBe('After 2 of 3 rounds.');
    expect(standingsExplanation(stateWith(FOUR), display({ phase: 'final' }, 16))[0]).toBe(
      'These are the final standings.',
    );
  });

  it('Standard points, 2v2v2v2: 4, 3, 2, 1 whatever the room size', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[1]).toBe(
      'Each counted round, your place in your room earns points: 1st = 4, 2nd = 3, 3rd = 2, 4th = 1, whatever the size of your room.',
    );
  });

  it('drops "whatever the size of your room" when every room has the same size', () => {
    expect(
      standingsExplanation(stateWith({ roomSize: { min: 4, max: 4, ideal: 4 } }), display({}, 16))[1],
    ).toBe('Each counted round, your place in your room earns points: 1st = 4, 2nd = 3, 3rd = 2, 4th = 1.');
  });

  it('head-to-head: a win and a loss, from the settings', () => {
    const h2h = { roomSize: { min: 2, max: 2, ideal: 2 } };
    expect(standingsExplanation(stateWith(h2h), display({}, 16))[1]).toBe(
      'Each counted round, a win earns 2 points and a loss 1.',
    );
    expect(
      standingsExplanation(
        stateWith({ ...h2h, scoring: 'positional-points', positionalPointsTable: [10, 8] }),
        display({}, 16),
      )[1],
    ).toBe('Each counted round, a win earns 10 points and a loss 8.');
  });

  it('Standard points, FFA: 8 down to 1', () => {
    const sentence = standingsExplanation(
      stateWith({ roomSize: { min: 6, max: 8, ideal: 8 } }),
      display({}, 24),
    )[1];
    expect(sentence).toContain('1st = 8, 2nd = 7, 3rd = 6, 4th = 5, 5th = 4, 6th = 3, 7th = 2, 8th = 1,');
  });

  it("Custom points list the organiser's own table, so two tables give two texts", () => {
    const long = standingsExplanation(
      stateWith({ scoring: 'positional-points', positionalPointsTable: [10, 8, 6, 5, 4, 3, 2, 1] }),
      display({}, 24),
    )[1];
    const short = standingsExplanation(
      stateWith({ scoring: 'positional-points', positionalPointsTable: [5, 3, 1] }),
      display({}, 24),
    )[1];
    expect(long).toBe(
      "Each counted round, your place in your room earns points from the organiser's table: 1st = 10, 2nd = 8, 3rd = 6, 4th = 5, 5th = 4, 6th = 3, 7th = 2, 8th = 1.",
    );
    expect(short).toBe(
      "Each counted round, your place in your room earns points from the organiser's table: 1st = 5, 2nd = 3, 3rd = 1.",
    );
  });

  it('takes the cut from the display: top 16 versus top 24', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[3]).toContain('The top 16 go through.');
    expect(standingsExplanation(stateWith(FOUR), display({}, 24))[3]).toContain('The top 24 go through.');
  });

  it('says so when a round or two do not count, and nothing when all count', () => {
    const one = standingsExplanation(
      stateWith(FOUR, [{ excludeFromStandings: true }, {}, {}]),
      display({}, 16),
    );
    expect(one[2]).toBe("A bye counts as a win; a missed round earns 0. Round 1 doesn't count.");
    const two = standingsExplanation(
      stateWith(FOUR, [{ excludeFromStandings: true }, { excludeFromStandings: true }, {}]),
      display({}, 16),
    );
    expect(two[2]).toBe("A bye counts as a win; a missed round earns 0. Rounds 1–2 don't count.");
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[2]).toBe(
      'A bye counts as a win; a missed round earns 0.',
    );
  });

  it('group stage: the cut is per group', () => {
    expect(standingsExplanation(stateWith(FOUR), display({ perGroup: true }, 2))[3]).toBe(
      'Points are added up; most points ranks first. The top 2 of each group go through.',
    );
  });

  it('everyone goes through when there is no cut', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, null))[3]).toBe(
      'Points are added up; most points ranks first. Everyone goes through.',
    );
  });

  it('uses "qualified" wording once the phase is final', () => {
    expect(standingsExplanation(stateWith(FOUR), display({ phase: 'final' }, 16))[3]).toContain(
      'The top 16 qualified.',
    );
    expect(
      standingsExplanation(stateWith(FOUR), display({ phase: 'final', perGroup: true }, 2))[3],
    ).toContain('The top 2 of each group qualified.');
    expect(standingsExplanation(stateWith(FOUR), display({ phase: 'final' }, null))[3]).toContain(
      'Everyone qualified.',
    );
  });

  it('explains the tie-break as a share of the room average', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[4]).toContain('100% = an average score');
  });
});

describe('roundCells', () => {
  it('shows score, place and points of a played round', () => {
    expect(roundCells({ roundIndex: 1, score: 1250, rank: 2, points: 3, bye: false })).toEqual({
      score: '1250',
      rank: '2nd',
      points: '3',
    });
  });

  it('shows a shared place as "=2nd" and fractional points with one decimal', () => {
    expect(roundCells({ roundIndex: 1, score: 500, rank: 2, points: 6.5, bye: false, shared: true })).toEqual(
      {
        score: '500',
        rank: '=2nd',
        points: '6.5',
      },
    );
    expect(
      roundCells({ roundIndex: 1, score: 500, rank: 2, points: 19 / 3, bye: false, shared: true }).points,
    ).toBe('6.3');
  });

  it('shows a bye as "Bye" with its points', () => {
    expect(roundCells({ roundIndex: 1, score: null, rank: null, points: 2, bye: true })).toEqual({
      score: 'Bye',
      rank: '—',
      points: '2',
    });
  });

  it('shows "—" in score, place and points for a round the unit missed, whether or not the round is over', () => {
    expect(roundCells(undefined)).toEqual({ score: '—', rank: '—', points: '—' });
  });
});

describe('formatTieBreak', () => {
  it('is a whole percent of the room average, or a dash without a played round', () => {
    expect(formatTieBreak(1.4666)).toBe('147%');
    expect(formatTieBreak(null)).toBe('—');
    expect(formatTieBreak(undefined)).toBe('—');
  });
});

describe('formatTieBreakPrecise', () => {
  it('is the tie-break to two decimals, or a dash without a played round', () => {
    expect(formatTieBreakPrecise(0.0137)).toBe('1.37%');
    expect(formatTieBreakPrecise(1.4725)).toBe('147.25%');
    expect(formatTieBreakPrecise(0)).toBe('0.00%');
    expect(formatTieBreakPrecise(null)).toBe('—');
    expect(formatTieBreakPrecise(undefined)).toBe('—');
  });
});

describe('sharesWholePercent', () => {
  it('flags the units on equal points that show the same whole percent', () => {
    const shares = [0.0112, 0.0137, 0.0149, 0.0051, 0.004];
    const flags = sharesWholePercent(shares.map((share) => ({ points: 3, share })));
    expect(flags).toEqual([true, true, true, true, false]);
  });

  it('treats totals that show the same points as equal, whatever the order they were summed in', () => {
    const flags = sharesWholePercent([
      { points: 19 / 3 + 8 + 5, share: 1.2 },
      { points: 5 + 19 / 3 + 8, share: 1.2 },
    ]);
    expect(flags).toEqual([true, true]);
  });

  it('does not flag an equal whole percent on different points', () => {
    expect(
      sharesWholePercent([
        { points: 4, share: 1.01 },
        { points: 3, share: 1.012 },
      ]),
    ).toEqual([false, false]);
  });

  it('does not flag units without a tie-break', () => {
    expect(
      sharesWholePercent([
        { points: 0, share: null },
        { points: 0, share: undefined },
      ]),
    ).toEqual([false, false]);
  });
});
