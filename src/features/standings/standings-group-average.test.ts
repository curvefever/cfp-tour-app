import { describe, expect, it } from 'vitest';
import { fixtureTournaments, loadedState } from '../../../e2e/screens/fixtures';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { swapIndividual } from '../../domain/tournament/mutations';
import {
  describeStandings,
  tableRoundIndexes,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { standingsDetailLines } from './standings-compact';
import { missedRoundOf, pointsCell, roundCells, standingsExplanation } from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

function fixtureState(id: string): TournamentState {
  const fixture = fixtureTournaments().find((entry) => entry.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  return loadedState(fixture);
}

function entriesOf(state: TournamentState): Entry[] {
  return (describeStandings(state)?.tables ?? []).flatMap((table) => table.entries);
}

function detailOf(state: TournamentState, entry: Entry): string[] {
  const table = describeStandings(state)?.tables.find((candidate) =>
    candidate.entries.some((other) => other.name === entry.name),
  );
  if (!table) throw new Error('no table');
  const roundIndexes = tableRoundIndexes(state, table);
  const labels = roundIndexes.map((index) => `Round ${state.rounds[index].roundNum}`);
  return standingsDetailLines(entry, roundIndexes, labels, false, state.rounds);
}

describe('pointsCell', () => {
  it('reads points per match to two decimals, with the total and the matches played under it', () => {
    expect(pointsCell({ totalFP: 7, matches: 4, averagePoints: 1.75 })).toEqual({
      main: '1.75',
      detail: '7 pts · 4 played',
    });
    expect(pointsCell({ totalFP: 1, matches: 1, averagePoints: 1 })).toEqual({
      main: '1.00',
      detail: '1 pt · 1 played',
    });
  });

  it('reads the total alone where there is no per-match standing, and a dash for a unit with no result', () => {
    expect(pointsCell({ totalFP: 6.5 })).toEqual({ main: '6.5', detail: null });
    expect(pointsCell({ totalFP: null, matches: 0 })).toEqual({ main: '—', detail: null });
  });
});

describe('roundCells: a round without a counted match', () => {
  it('reads Void or Bye with a dash for points, and a dash for a round not played', () => {
    expect(roundCells(undefined, false, undefined, 'void')).toEqual({
      score: 'Void',
      rank: '—',
      points: '—',
    });
    expect(roundCells(undefined, false, undefined, 'bye')).toEqual({ score: 'Bye', rank: '—', points: '—' });
    expect(roundCells(undefined)).toEqual({ score: '—', rank: '—', points: '—' });
  });

  it('keeps ABS with 0 points, and puts the result codes of a match-results round in the rank cell', () => {
    expect(roundCells(undefined, true, undefined, 'void')).toEqual({ score: 'ABS', rank: '—', points: '0' });
    expect(
      roundCells({ roundIndex: 0, score: 1400, rank: 1, points: 4, bye: false, results: ['W', 'TL'] }),
    ).toEqual({ score: '1400', rank: 'W · TL', points: '4' });
  });

  it('missedRoundOf reads the entry marks', () => {
    expect(missedRoundOf({ voidRounds: [2] }, 2)).toBe('void');
    expect(missedRoundOf({ byeRounds: [1] }, 1)).toBe('bye');
    expect(missedRoundOf({ byeRounds: [1] }, 2)).toBeUndefined();
  });
});

describe('a group stage with per-match standings (13 players, byes)', () => {
  const state = fixtureState('groups-1v1-13');

  it('a bye is no match: the unit reads Bye with no points and no played match', () => {
    const bye = entriesOf(state).find((entry) => entry.byeRounds?.includes(0));
    expect(bye).toBeDefined();
    if (!bye) return;
    expect(bye).toMatchObject({ totalFP: null, matches: 0 });
    expect(roundCells(undefined, false, undefined, missedRoundOf(bye, 0))).toMatchObject({
      score: 'Bye',
      points: '—',
    });
    expect(detailOf(state, bye)[0]).toBe('Round 1 · Bye');
  });

  it('a played unit shows points per match with its total and matches under it', () => {
    const played = entriesOf(state).find((entry) => entry.matches === 1);
    expect(played).toBeDefined();
    if (!played) return;
    const cell = pointsCell(played);
    expect(cell.main).toMatch(/^\d\.\d\d$/);
    expect(cell.detail).toMatch(/^\d(\.\d)? pts? · 1 played$/);
    expect(detailOf(state, played)).toContain(cell.detail);
  });

  it('the explanation says how groups are ranked and the new tie-break order', () => {
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    const text = standingsExplanation(state, display).join(' ');
    expect(text).toContain('Groups are ranked by points per match played. A bye is not a match.');
    expect(text).toContain('void for the one that turned up; a no-show gets 0 for it');
    expect(text).toContain('Most points per match ranks first.');
    expect(text).toContain('the tie-break is your results against each other, then');
    expect(text).not.toContain('A bye counts as a win');
  });
});

describe('a group stage scored by match results (10 teams 4v4, one match void)', () => {
  const state = fixtureState('groups-4v4-match-results');

  it('a scored round shows the result code of the game in the rank cell, and the points it earned', () => {
    const scored = entriesOf(state).filter((entry) => entry.rounds?.some((round) => round.results));
    expect(scored.length).toBeGreaterThanOrEqual(2);
    for (const entry of scored) {
      const result = entry.rounds?.find((round) => round.results);
      const cells = roundCells(result, false, undefined);
      expect(cells.rank).toMatch(/^(W|TW|TL|L|T)$/);
      expect(detailOf(state, entry)[0]).toMatch(/^Round 1 · \d+ · (W|TW|TL|L|T) · [\d.]+ pts?$/);
    }
  });

  it('the unit whose opponent was removed reads Void', () => {
    const voided = entriesOf(state).find((entry) => entry.voidRounds?.includes(0));
    expect(voided).toBeDefined();
    if (!voided) return;
    expect(voided).toMatchObject({ totalFP: null, matches: 0 });
    expect(detailOf(state, voided)[0]).toBe('Round 1 · Void');
  });

  it('the explanation words the table, the margin and the Best-of-3 mapping from its own settings', () => {
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    const text = standingsExplanation(state, display).join(' ');
    expect(text).toContain(
      'Each game: a win by more than 100 points earns 3, by 100 or less 2; a loss by 100 or less 1, by more 0; a tie 1.5.',
    );
  });
});

describe('a reserve swapped into a seat that missed a round', () => {
  it('reads ABS for that round, and the opponent reads Void', () => {
    const base = buildState({
      label: 'swap-abs',
      count: 13,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '8',
        oddCountStrategy: 'bye',
      },
    });
    if (!base) throw new Error('generation failed');
    const scored = scoreCurrentRound(base, 0);
    const [first, second] = scored.assignments[0].filter((entry) => entry.room === 1);
    const absent: TournamentState = {
      ...scored,
      scores: { ...scored.scores, 'r0-rm1-p1': 0 },
      absences: { 'r0-rm1-p1': 'absent' },
    };
    const advanced = advanceTournamentRound(absent);
    if (advanced.status !== 'advanced') throw new Error(`stuck: ${advanced.status}`);
    const swapped = swapIndividual(advanced.state, second.name, 'Newbie');
    expect(swapped).not.toBe(advanced.state);
    const entries = entriesOf(swapped);
    const newbie = entries.find((entry) => entry.name === 'Newbie');
    expect(newbie?.absentRounds).toEqual([0]);
    expect(newbie).toMatchObject({ totalFP: 0, matches: 1 });
    if (!newbie) return;
    expect(detailOf(swapped, newbie)[0]).toBe('Round 1 · ABS · 0 pts');
    expect(entries.find((entry) => entry.name === first.name)?.voidRounds).toEqual([0]);
  });
});
