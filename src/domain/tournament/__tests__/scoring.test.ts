import { describe, expect, it } from 'vitest';
import { currentColumn } from '../round-columns';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState, scoreCurrentRound as scoreRound } from './play-through';
import { liveTournament } from './qual-waterfall';
import {
  formatStandingValue,
  getDefenderIndex,
  getFinalUnitScore,
  getUnitScore,
  groupByScore,
  orderRoomByScore,
  orderRoomWithPlaces,
  positionalPoints,
  readTieResolution,
  SHARED_TIE_MARK,
  unscoredRooms,
  SCORING_SYSTEM_OPTION_LABELS,
  scaledRoomPoints,
  scoredTeamSize,
  scoringSystemLabel,
  scoreKeysForPosition,
  standardPoints,
  standardPointsTable,
  tieResolutionList,
} from '../scoring';
import { createDefaultTournamentState } from '../state-defaults';
import { buildRound } from './test-fixtures';
import { ONE_SCORE_PER_TEAM } from '../formats';

describe('getDefenderIndex', () => {
  it('returns 0 by default with no defenderChanges', () => {
    expect(getDefenderIndex({ defenderChanges: {} }, 'team1', 5)).toBe(0);
  });

  it('returns the most recent change at or before the given round', () => {
    const state = {
      defenderChanges: {
        team1: [
          { round: 0, memberIdx: 1 },
          { round: 3, memberIdx: 2 },
        ],
      },
    };
    expect(getDefenderIndex(state, 'team1', 3)).toBe(2);
    expect(getDefenderIndex(state, 'team1', 2)).toBe(1);
    expect(getDefenderIndex(state, 'team1', 5)).toBe(2);
  });
});

describe('getUnitScore', () => {
  it('reads a single-game individual score from the r{ri}-rm{room}-p{position} key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0': 500 },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(500);
  });

  it('applies the fallback when the key is missing', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: {},
    });
    expect(getUnitScore(state, 0, 1, 5, 42)).toBe(42);
  });

  it('sums team member scores across -m{memberIdx} keys under sum-members', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300, 'r0-rm1-p0-m1': 200 },
      gamemodeConfig: { teamScoringRule: 'sum-members' },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(500);
  });

  it("picks only the defender's score under designated-player", () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300, 'r0-rm1-p0-m1': 200 },
      gamemodeConfig: { teamScoringRule: 'designated-player' },
      defenderChanges: { t1: [{ round: 0, memberIdx: 1 }] },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(200);
  });

  it('returns null (not the fallback) when a team score is partially missing and fallback is null', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [{ teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] }],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0-m0': 300 },
      gamemodeConfig: { teamScoringRule: 'sum-members' },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBeNull();
  });

  it('sums across numGames > 1 games, returning null only under the null fallback', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1], numGames: 3 })],
      scores: { 'r0-rm1-p0-g1': 100, 'r0-rm1-p0-g2': 200 },
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBeNull();
    // A zero fallback surfaces the live partial total instead of blocking.
    expect(getUnitScore(state, 0, 1, 0, 0)).toBe(300);
  });
});

describe('getFinalUnitScore', () => {
  it('reads only from the separate finalScores namespace, ignoring a colliding-looking scores key', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      rounds: [buildRound({ roundNum: 1, isFinal: true, players: 1, rooms: [1] })],
      scores: { 'game1-P1': 999 },
      finalScores: { 'game1-P1': 555 },
    });
    expect(getFinalUnitScore(state, 'P1', 1, null)).toBe(555);
  });
});

describe('One score per team scoring', () => {
  const team = { teamId: 't1', teamName: 'Team One', members: [{ name: 'A' }, { name: 'B' }] };
  const oneScorePerTeam = { teamScoringRule: ONE_SCORE_PER_TEAM };

  it('reads the plain position key and ignores -m{n} keys', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [team],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1] })],
      scores: { 'r0-rm1-p0': 700, 'r0-rm1-p0-m0': 300, 'r0-rm1-p0-m1': 200 },
      gamemodeConfig: oneScorePerTeam,
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(700);
  });

  it('sums plain -g{n} keys over multiple games, null when a game is missing', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [team],
      assignments: [[{ name: 't1', room: 1, isLucky: false }]],
      rounds: [buildRound({ roundNum: 1, players: 1, rooms: [1], numGames: 3 })],
      scores: { 'r0-rm1-p0-g1': 100, 'r0-rm1-p0-g2': 200, 'r0-rm1-p0-g3': 300 },
      gamemodeConfig: oneScorePerTeam,
    });
    expect(getUnitScore(state, 0, 1, 0, null)).toBe(600);
    const partial = { ...state, scores: { 'r0-rm1-p0-g1': 100, 'r0-rm1-p0-g2': 200 } };
    expect(getUnitScore(partial, 0, 1, 0, null)).toBeNull();
  });

  it('reads game{n}-{teamName} final scores, null when missing', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'team-2v2v2v2',
      players: [team],
      rounds: [buildRound({ roundNum: 1, isFinal: true, players: 1, rooms: [1] })],
      finalScores: { 'game1-t1': 450, 'game1-t1-m0': 10 },
      gamemodeConfig: oneScorePerTeam,
    });
    expect(getFinalUnitScore(state, 't1', 1, null)).toBe(450);
    expect(getFinalUnitScore(state, 't1', 2, null)).toBeNull();
  });
});

describe('scoredTeamSize', () => {
  it('is undefined for an individual format', () => {
    expect(
      scoredTeamSize({ gameFormat: 'ffa-individual', gamemodeConfig: { teamScoringRule: 'sum-members' } }),
    ).toBeUndefined();
  });

  it('is the team size under sum-members and designated-player', () => {
    for (const teamScoringRule of ['sum-members', 'designated-player'] as const) {
      expect(scoredTeamSize({ gameFormat: 'team-2v2v2v2', gamemodeConfig: { teamScoringRule } })).toBe(2);
      expect(scoredTeamSize({ gameFormat: 'team-3v3v3', gamemodeConfig: { teamScoringRule } })).toBe(3);
    }
  });

  it('is undefined for a team format under One score per team', () => {
    expect(
      scoredTeamSize({ gameFormat: 'team-2v2v2v2', gamemodeConfig: { teamScoringRule: ONE_SCORE_PER_TEAM } }),
    ).toBeUndefined();
  });
});

describe('scoreKeysForPosition', () => {
  it('enumerates a single key for a single-game individual position', () => {
    expect(scoreKeysForPosition({ roundIndex: 0, room: 1, position: 0 })).toEqual(['r0-rm1-p0']);
  });

  it('enumerates the full game x member cross-product for a multi-game team position', () => {
    const keys = scoreKeysForPosition({ roundIndex: 1, room: 2, position: 0, numGames: 2, teamSize: 3 });
    expect(keys).toEqual([
      'r1-rm2-p0-g1-m0',
      'r1-rm2-p0-g1-m1',
      'r1-rm2-p0-g1-m2',
      'r1-rm2-p0-g2-m0',
      'r1-rm2-p0-g2-m1',
      'r1-rm2-p0-g2-m2',
    ]);
  });
});

describe('standardPoints', () => {
  it('gives 1st place the largest room size and one point less per place', () => {
    expect([1, 2, 3, 4].map((place) => standardPoints(place, 4))).toEqual([4, 3, 2, 1]);
    expect([1, 2, 3].map((place) => standardPoints(place, 8))).toEqual([8, 7, 6]);
  });

  it('floors at 0 for a place beyond the largest room size', () => {
    expect(standardPoints(5, 4)).toBe(0);
  });
});

describe('standardPointsTable', () => {
  it.each([
    [10, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]],
    [9, [10, 8, 7, 6, 5, 4, 3, 2, 1]],
    [8, [10, 8, 6, 5, 4, 3, 2, 1]],
    [7, [7, 6, 5, 4, 3, 2, 1]],
    [6, [6, 5, 4, 3, 2, 1]],
    [4, [4, 3, 2, 1]],
    [3, [3, 2, 1]],
    [2, [2, 1]],
  ])('for a largest room of %i', (largestRoom, expected) => {
    expect(standardPointsTable(largestRoom)).toEqual(expected);
  });

  it('hands out a copy, so the shared table cannot be changed by a caller', () => {
    standardPointsTable(8).fill(0);
    expect(standardPointsTable(8)[0]).toBe(10);
  });
});

describe('scaledRoomPoints', () => {
  const custom = [6, 4, 2, 0];
  const longCustom = [10, 8, 6, 5, 4, 3, 2, 1, 0];

  it.each([
    ['FFA 8 in a room of 8', 8, 8, [10, 8, 6, 5, 4, 3, 2, 1]],
    ['FFA 8 in a room of 7', 8, 7, [10, 7.5, 5.5, 4.5, 3.5, 2, 1]],
    ['FFA 8 in a room of 6', 8, 6, [10, 7, 5, 4, 2.5, 1]],
    ['FFA 7 in a room of 7', 7, 7, [7, 6, 5, 4, 3, 2, 1]],
    ['FFA 7 in a room of 6', 7, 6, [7, 6, 4.5, 3.5, 2, 1]],
    ['FFA 6 in a room of 5', 6, 5, [6, 5, 3.5, 2.5, 1]],
    ['largest room 9 in a room of 8', 9, 8, [10, 8, 6.5, 5.5, 4.5, 3.5, 2, 1]],
    ['largest room 10 in a room of 9', 10, 9, [10, 9, 8, 6.5, 5.5, 4.5, 3.5, 2, 1]],
    ['2v2v2v2 in a room of 4', 4, 4, [4, 3, 2, 1]],
    ['2v2v2v2 in a room of 3', 4, 3, [4, 2.5, 1]],
    ['3v3v3 in a room of 2', 3, 2, [3, 1]],
  ])('Standard points, %s', (_label, largestRoom, roomSize, expected) => {
    expect(scaledRoomPoints(standardPointsTable(largestRoom), largestRoom, roomSize)).toEqual(expected);
  });

  it('scales a Custom table the same way', () => {
    expect(scaledRoomPoints(custom, 4, 3)).toEqual([6, 3, 0]);
  });

  it('uses only the first largest-room-size entries of a longer Custom table', () => {
    expect(scaledRoomPoints(longCustom, 8, 8)).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
    expect(scaledRoomPoints(longCustom, 8, 7)).toEqual([10, 7.5, 5.5, 4.5, 3.5, 2, 1]);
  });

  it('gives a lone unit the first entry and an empty room nothing', () => {
    expect(scaledRoomPoints(standardPointsTable(8), 8, 1)).toEqual([10]);
    expect(scaledRoomPoints(standardPointsTable(8), 8, 0)).toEqual([]);
  });

  it('rounds half points up, exactly', () => {
    // Standard 8, room of 3: 2nd reads table position 4.5, halfway between 5 and 4 points: 4.5.
    expect(scaledRoomPoints(standardPointsTable(8), 8, 3)).toEqual([10, 4.5, 1]);
    // Room of 5: 4th reads position 6.25, between 3 and 2 points: 2.75, which is nearer 3 than 2.5.
    expect(scaledRoomPoints(standardPointsTable(8), 8, 5)).toEqual([10, 6.5, 4.5, 3, 1]);
    // Custom 4 entries, room of 2: first and last only.
    expect(scaledRoomPoints([6, 4, 2, 1], 4, 2)).toEqual([6, 1]);
    // Room of 4: 2nd reads position 3.33 (5.67 points, rounds to 5.5), 3rd position 5.67 (3.33 points, rounds to 3.5).
    expect(scaledRoomPoints(standardPointsTable(8), 8, 4)).toEqual([10, 5.5, 3.5, 1]);
  });
});

describe('positionalPoints', () => {
  const table = [10, 8, 6, 5, 4, 3, 2, 1];

  it('looks up the table by 1-indexed rank', () => {
    expect(positionalPoints(1, table)).toBe(10);
    expect(positionalPoints(8, table)).toBe(1);
  });

  it('returns the last table entry correctly at the table-length edge', () => {
    expect(positionalPoints(table.length, table)).toBe(table[table.length - 1]);
  });

  it('falls back to 0 for a rank beyond the table length', () => {
    expect(positionalPoints(9, table)).toBe(0);
  });
});

describe('SCORING_SYSTEM_OPTION_LABELS', () => {
  it('names the two systems for Setup without the old Fair Points / Positional Points wording', () => {
    expect(SCORING_SYSTEM_OPTION_LABELS).toEqual({
      fairpoints:
        'Standard points (FFA: 10, 8, 6, 5, 4, 3, 2, 1; other formats: 1st = largest room size, −1 per place; smaller rooms scaled)',
      'positional-points': 'Custom points table',
    });
  });
});

describe('scoringSystemLabel', () => {
  it('names Standard points as Setup does for a tournament with pointsVersion 2', () => {
    expect(scoringSystemLabel('fairpoints', 2)).toBe(SCORING_SYSTEM_OPTION_LABELS.fairpoints);
  });

  it('keeps the earlier Standard label for a tournament without pointsVersion', () => {
    expect(scoringSystemLabel('fairpoints', undefined)).toBe(
      'Standard points (1st = largest room size, −1 per place)',
    );
  });

  it('names the Custom table the same in both', () => {
    expect(scoringSystemLabel('positional-points', 2)).toBe('Custom points table');
    expect(scoringSystemLabel('positional-points', undefined)).toBe('Custom points table');
  });
});

describe('formatStandingValue', () => {
  it('formats a points total as a rounded whole number', () => {
    expect(formatStandingValue(24)).toBe('24');
    expect(formatStandingValue(23.999999)).toBe('24');
    expect(formatStandingValue(19.0000000001)).toBe('19');
    expect(formatStandingValue(7)).toBe('7');
  });

  it('shows one decimal when a shared place makes the value fractional', () => {
    expect(formatStandingValue(6.5)).toBe('6.5');
    expect(formatStandingValue(19 / 3)).toBe('6.3');
    expect(formatStandingValue(6.25)).toBe('6.3');
  });
});

describe('groupByScore', () => {
  it('clusters adjacent equal-score entries in a descending-sorted array', () => {
    const scored = [{ score: 10 }, { score: 10 }, { score: 8 }, { score: 8 }, { score: 8 }, { score: 5 }];
    expect(groupByScore(scored).map((cluster) => cluster.map((entry) => entry.score))).toEqual([
      [10, 10],
      [8, 8, 8],
      [5],
    ]);
  });

  it('does not retroactively merge non-adjacent equal scores', () => {
    const scored = [{ score: 10 }, { score: 8 }, { score: 10 }, { score: 5 }];
    expect(groupByScore(scored)).toHaveLength(4);
  });
});

describe('tieResolutionList', () => {
  it('normalizes a string entry to a single-element array', () => {
    expect(tieResolutionList({ tieResolutions: { key1: 'P1' } }, 'key1')).toEqual(['P1']);
  });

  it('returns an array entry unchanged', () => {
    expect(tieResolutionList({ tieResolutions: { key1: ['P1', 'P2'] } }, 'key1')).toEqual(['P1', 'P2']);
  });

  it('returns [] when the key is absent', () => {
    expect(tieResolutionList({ tieResolutions: {} }, 'missing')).toEqual([]);
  });
});

describe('orderRoomByScore', () => {
  const noResolutions = { tieResolutions: {} };

  it('sorts strictly by score when no ties exist', () => {
    const scored = [
      { name: 'A', score: 5 },
      { name: 'B', score: 10 },
      { name: 'C', score: 1 },
    ];
    expect(orderRoomByScore(scored, 0, 1, noResolutions).map((entry) => entry.name)).toEqual(['B', 'A', 'C']);
  });

  it('orders a tied cluster by tieResolutionList, resolved names first in resolution order', () => {
    const scored = [
      { name: 'A', score: 10 },
      { name: 'B', score: 10 },
      { name: 'C', score: 10 },
    ];
    const state = { tieResolutions: { 'r0-rm1-s10': ['C', 'A'] } };
    expect(orderRoomByScore(scored, 0, 1, state).map((entry) => entry.name)).toEqual(['C', 'A', 'B']);
  });

  it('places unresolved names within a tied cluster after resolved ones, preserving relative order', () => {
    const scored = [
      { name: 'A', score: 10 },
      { name: 'B', score: 10 },
      { name: 'C', score: 10 },
      { name: 'D', score: 10 },
    ];
    const state = { tieResolutions: { 'r0-rm1-s10': ['B'] } };
    expect(orderRoomByScore(scored, 0, 1, state).map((entry) => entry.name)).toEqual(['B', 'A', 'C', 'D']);
  });
});

describe('readTieResolution', () => {
  const read = (value: string | string[] | undefined) =>
    readTieResolution({ tieResolutions: value === undefined ? {} : { k: value } }, 'k');

  it('reads a missing key, a string and a ranked-only list as ranked picks', () => {
    expect(read(undefined)).toEqual({ ranked: [], shared: [] });
    expect(read('A')).toEqual({ ranked: ['A'], shared: [] });
    expect(read(['A', 'B'])).toEqual({ ranked: ['A', 'B'], shared: [] });
  });

  it('splits a shared list at the mark, with or without ranked picks before it', () => {
    expect(read([SHARED_TIE_MARK, 'A', 'B'])).toEqual({ ranked: [], shared: ['A', 'B'] });
    expect(read(['A', SHARED_TIE_MARK, 'B', 'C'])).toEqual({ ranked: ['A'], shared: ['B', 'C'] });
  });

  it('tieResolutionList returns the ranked part only', () => {
    expect(tieResolutionList({ tieResolutions: { k: ['A', SHARED_TIE_MARK, 'B', 'C'] } }, 'k')).toEqual([
      'A',
    ]);
  });
});

describe('orderRoomWithPlaces', () => {
  const room = (...scores: number[]) => scores.map((score, index) => ({ name: `P${index + 1}`, score }));
  const places = (scored: ReturnType<typeof room>, list?: string[]) =>
    orderRoomWithPlaces(scored, 0, 1, { tieResolutions: list ? { 'r0-rm1-s10': list } : {} }).map(
      (item) => `${item.entry.name}:${item.place}/${item.sharedBy}`,
    );

  it('numbers a room without ties 1..n, alone in each place', () => {
    expect(places(room(5, 10, 1))).toEqual(['P2:1/1', 'P1:2/1', 'P3:3/1']);
  });

  it('keeps the places of a tie without a share distinct, in order', () => {
    expect(places(room(10, 10, 4), ['P2'])).toEqual(['P2:1/1', 'P1:2/1', 'P3:3/1']);
  });

  it('gives a 2-way share the same place and the next unit the place after both', () => {
    expect(places(room(30, 10, 10, 4), [SHARED_TIE_MARK, 'P2', 'P3'])).toEqual([
      'P1:1/1',
      'P2:2/2',
      'P3:2/2',
      'P4:4/1',
    ]);
  });

  it('gives a 3-way share the same place', () => {
    expect(places(room(10, 10, 10, 4), [SHARED_TIE_MARK, 'P1', 'P2', 'P3'])).toEqual([
      'P1:1/3',
      'P2:1/3',
      'P3:1/3',
      'P4:4/1',
    ]);
  });

  it('ranks the picks first, then shares the rest', () => {
    expect(places(room(30, 10, 10, 10), ['P3', SHARED_TIE_MARK, 'P2', 'P4'])).toEqual([
      'P1:1/1',
      'P3:2/1',
      'P2:3/2',
      'P4:3/2',
    ]);
  });

  it('ignores a share that no longer matches two units of the tie', () => {
    expect(places(room(10, 10), [SHARED_TIE_MARK, 'P1', 'GONE'])).toEqual(['P1:1/1', 'P2:2/1']);
  });
});

describe('unscoredRooms', () => {
  const entered = () => {
    let state = liveTournament(19);
    for (let guard = 0; guard < 20 && !state.rounds[state.curRound].isWaterfall; guard += 1) {
      const result = advanceTournamentRound(scoreRound(state, 2));
      if (result.status !== 'advanced') throw new Error('could not advance');
      state = result.state;
    }
    return state;
  };
  const indexOf = (state: TournamentState, label: string) =>
    state.rounds.findIndex((round) => round.customLabel === label);
  const scoreAll = (state: TournamentState) => {
    let scored = state;
    for (let index = state.curRound; index <= currentColumn(state).end; index += 1) {
      scored = { ...scoreRound({ ...scored, curRound: index }, 2), curRound: state.curRound };
    }
    return scored;
  };
  const withoutRoom = (state: TournamentState, roundIndex: number, room: number): TournamentState => ({
    ...state,
    scores: Object.fromEntries(
      Object.entries(state.scores).filter(([key]) => !key.startsWith(`r${roundIndex}-rm${room}-`)),
    ),
  });

  it('is empty for a fully scored column', () => {
    expect(unscoredRooms(scoreAll(entered()))).toEqual([]);
  });

  it('lists every room of a column of two rounds when nothing is scored', () => {
    const start = entered();
    const upper = indexOf(start, 'Round 5 Upper');
    const lower = indexOf(start, 'Round 5 Lower');
    expect(unscoredRooms(start)).toEqual([
      { roundIndex: upper, room: 1 },
      { roundIndex: upper, room: 2 },
      { roundIndex: lower, room: 1 },
      { roundIndex: lower, room: 2 },
    ]);
  });

  it('finds the one room of the column with no score: Round 5 Lower room B', () => {
    const start = entered();
    const lower = indexOf(start, 'Round 5 Lower');
    expect(unscoredRooms(withoutRoom(scoreAll(start), lower, 2))).toEqual([{ roundIndex: lower, room: 2 }]);
  });

  it('counts a room as scored once any one score is in', () => {
    const start = entered();
    const lower = indexOf(start, 'Round 5 Lower');
    const full = scoreAll(start);
    const oneKey = Object.keys(full.scores).find((key) => key.startsWith(`r${lower}-rm2-`)) as string;
    const oneScore = {
      ...withoutRoom(full, lower, 2),
      scores: { ...withoutRoom(full, lower, 2).scores, [oneKey]: full.scores[oneKey] },
    };
    expect(unscoredRooms(oneScore)).toEqual([]);
  });

  it('ignores a room of one unit', () => {
    const start = entered();
    const lower = indexOf(start, 'Round 5 Lower');
    const keepFirstOfRoom2 = start.assignments[lower].filter(
      (entry, index, all) => entry.room !== 2 || all.findIndex((other) => other.room === 2) === index,
    );
    const lone = {
      ...start,
      assignments: start.assignments.map((entries, index) => (index === lower ? keepFirstOfRoom2 : entries)),
    };
    expect(unscoredRooms(withoutRoom(scoreAll(lone), lower, 2))).toEqual([]);
  });

  it('asks about one unscored room of a single-round pooling round (37 FFA players)', () => {
    const start = buildState({
      label: 'ffa 37',
      count: 37,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '24',
      },
    });
    if (!start) throw new Error('generation failed');
    const scored = scoreRound(start, 0);
    expect(unscoredRooms(scored)).toEqual([]);
    expect(unscoredRooms(withoutRoom(scored, 0, 5))).toEqual([{ roundIndex: 0, room: 5 }]);
  });

  it('leaves the Final out: it ends with Finish, not Next Round', () => {
    const start = entered();
    const final = start.rounds.findIndex((round) => round.isFinal);
    expect(unscoredRooms({ ...start, curRound: final })).toEqual([]);
  });
});
