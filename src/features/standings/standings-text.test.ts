import { describe, expect, it } from 'vitest';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { formatTieBreak, roundCells, standingsContextLine, standingsExplanation } from './standings-text';

function display(overrides: Partial<StandingsDisplay>, cut: number | null): StandingsDisplay {
  return {
    phase: 'live',
    roundsDone: 2,
    roundsTotal: 3,
    firstCountedRoundNum: 2,
    lastStandingsRoundIndex: 2,
    perGroup: false,
    tables: [{ key: 'qual-cutoff', label: 'Qualification Table', entries: [], cut }],
    ...overrides,
  };
}

describe('standingsContextLine', () => {
  it('says when the standings start before any counted round', () => {
    expect(standingsContextLine(display({ phase: 'upcoming' }, 24))).toBe('Standings start after Round 2.');
  });

  it('shows progress and the cut while live', () => {
    expect(standingsContextLine(display({}, 24))).toBe('After 2 of 3 rounds · top 24 go through');
    expect(standingsContextLine(display({ perGroup: true }, 2))).toBe(
      'After 2 of 3 rounds · top 2 per group go through',
    );
    expect(standingsContextLine(display({}, null))).toBe('After 2 of 3 rounds · everyone goes through');
  });

  it('reports who qualified once final', () => {
    expect(standingsContextLine(display({ phase: 'final' }, 16))).toBe('Final standings · top 16 qualified');
    expect(standingsContextLine(display({ phase: 'final', perGroup: true }, 2))).toBe(
      'Final standings · top 2 per group qualified',
    );
    expect(standingsContextLine(display({ phase: 'final' }, null))).toBe(
      'Final standings · everyone qualified',
    );
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

  it('Standard points, 2v2v2v2: 4, 3, 2, 1 whatever the room size', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[0]).toBe(
      'Each counted round, your place in your room earns points: 1st = 4, 2nd = 3, 3rd = 2, 4th = 1, whatever the size of your room.',
    );
  });

  it('Standard points, FFA: 8 down to 1', () => {
    const sentence = standingsExplanation(
      stateWith({ roomSize: { min: 6, max: 8, ideal: 8 } }),
      display({}, 24),
    )[0];
    expect(sentence).toContain('1st = 8, 2nd = 7, 3rd = 6, 4th = 5, 5th = 4, 6th = 3, 7th = 2, 8th = 1,');
  });

  it("Custom points list the organiser's own table, so two tables give two texts", () => {
    const long = standingsExplanation(
      stateWith({ scoring: 'positional-points', positionalPointsTable: [10, 8, 6, 5, 4, 3, 2, 1] }),
      display({}, 24),
    )[0];
    const short = standingsExplanation(
      stateWith({ scoring: 'positional-points', positionalPointsTable: [5, 3, 1] }),
      display({}, 24),
    )[0];
    expect(long).toBe(
      "Each counted round, your place in your room earns points from the organiser's table: 1st = 10, 2nd = 8, 3rd = 6, 4th = 5, 5th = 4, 6th = 3, 7th = 2, 8th = 1.",
    );
    expect(short).toBe(
      "Each counted round, your place in your room earns points from the organiser's table: 1st = 5, 2nd = 3, 3rd = 1.",
    );
  });

  it('takes the cut from the display: top 16 versus top 24', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[2]).toContain('The top 16 go through.');
    expect(standingsExplanation(stateWith(FOUR), display({}, 24))[2]).toContain('The top 24 go through.');
  });

  it('says so when a round or two do not count, and nothing when all count', () => {
    const one = standingsExplanation(
      stateWith(FOUR, [{ excludeFromStandings: true }, {}, {}]),
      display({}, 16),
    );
    expect(one[1]).toBe("A bye counts as a win; a missed round earns 0. Round 1 doesn't count.");
    const two = standingsExplanation(
      stateWith(FOUR, [{ excludeFromStandings: true }, { excludeFromStandings: true }, {}]),
      display({}, 16),
    );
    expect(two[1]).toBe("A bye counts as a win; a missed round earns 0. Rounds 1–2 don't count.");
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[1]).toBe(
      'A bye counts as a win; a missed round earns 0.',
    );
  });

  it('group stage: the cut is per group', () => {
    expect(standingsExplanation(stateWith(FOUR), display({ perGroup: true }, 2))[2]).toBe(
      'Points are added up; most points ranks first. The top 2 of each group go through.',
    );
  });

  it('everyone goes through when there is no cut', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, null))[2]).toBe(
      'Points are added up; most points ranks first. Everyone goes through.',
    );
  });

  it('uses "qualified" wording once the phase is final', () => {
    expect(standingsExplanation(stateWith(FOUR), display({ phase: 'final' }, 16))[2]).toContain(
      'The top 16 qualified.',
    );
    expect(
      standingsExplanation(stateWith(FOUR), display({ phase: 'final', perGroup: true }, 2))[2],
    ).toContain('The top 2 of each group qualified.');
    expect(standingsExplanation(stateWith(FOUR), display({ phase: 'final' }, null))[2]).toContain(
      'Everyone qualified.',
    );
  });

  it('explains the tie-break as a share of the room average', () => {
    expect(standingsExplanation(stateWith(FOUR), display({}, 16))[3]).toContain('100% = an average score');
  });
});

describe('roundCells', () => {
  it('shows score, place and points of a played round', () => {
    expect(roundCells({ roundIndex: 1, score: 1250, rank: 2, points: 3, bye: false }, true)).toEqual({
      score: '1250',
      rank: '2nd',
      points: '3',
    });
  });

  it('shows a bye as "Bye" with its points', () => {
    expect(roundCells({ roundIndex: 1, score: null, rank: null, points: 2, bye: true }, true)).toEqual({
      score: 'Bye',
      rank: '—',
      points: '2',
    });
  });

  it('shows 0 points for a round missed, and nothing for a round not over yet', () => {
    expect(roundCells(undefined, true)).toEqual({ score: '—', rank: '—', points: '0' });
    expect(roundCells(undefined, false)).toEqual({ score: '—', rank: '—', points: '—' });
  });
});

describe('formatTieBreak', () => {
  it('is a whole percent of the room average, or a dash without a played round', () => {
    expect(formatTieBreak(1.4666)).toBe('147%');
    expect(formatTieBreak(null)).toBe('—');
    expect(formatTieBreak(undefined)).toBe('—');
  });
});
