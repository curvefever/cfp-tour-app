import { describe, expect, it } from 'vitest';
import { computeGroupStandings, detectTieBreaks, hasPendingTies } from '../advancement';
import { generateTournament } from '../generation';
import {
  type MatchResultPoints,
  defaultTieMargin,
  matchResultsOfRoom,
  parseMatchResultPoints,
  pointsOfResult,
  resolveTieMargin,
  resultOfGap,
  scoringForPooling,
  tieMarginAfterFormatChange,
} from '../match-results';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState } from './play-through';
import { buildRound } from './test-fixtures';

const DEFAULT_POINTS: MatchResultPoints = [3, 2, 1, 0];

interface RoomOptions {
  points?: MatchResultPoints;
  tieMargin?: number;
  /** The scores of each game, first unit then second. */
  games?: Array<[number, number]>;
  /** A Best of 3 instead: the game scores in order. */
  bestOf?: boolean;
}

/** One head-to-head room of group A with its game scores, scored by match results with a margin of 100. */
function roomState(options: RoomOptions): TournamentState {
  const games = options.games ?? [[0, 0]];
  const many = games.length > 1;
  return createDefaultTournamentState({
    gameFormat: 'individual-1v1',
    started: true,
    groups: [{ label: 'A', members: ['X', 'Y'] }],
    gamemodeConfig: {
      roomSize: { min: 2, max: 2, ideal: 2 },
      pointsVersion: 2,
      groupAverageVersion: 2,
      scoring: 'match-results',
      matchResultPoints: options.points ?? DEFAULT_POINTS,
      tieMargin: options.tieMargin ?? 100,
    },
    rounds: [
      buildRound({
        roundNum: 1,
        isGroupStage: true,
        rooms: [2],
        roomGroups: ['A'],
        players: 2,
        matches: [{ group: 'A', pair: ['X', 'Y'] }],
        ...(many ? { numGames: games.length } : {}),
        ...(options.bestOf ? { bestOf: 3, numGames: 3 } : {}),
      }),
    ],
    assignments: [
      [
        { name: 'X', room: 1, isLucky: false },
        { name: 'Y', room: 1, isLucky: false },
      ],
    ],
    scores: Object.fromEntries(
      games.flatMap(([first, second], index) => {
        const part = many || options.bestOf ? `-g${index + 1}` : '';
        return [
          [`r0-rm1-p0${part}`, first],
          [`r0-rm1-p1${part}`, second],
        ];
      }),
    ),
  });
}

function sidesOf(options: RoomOptions) {
  const state = roomState(options);
  const sides = matchResultsOfRoom(state, 0, 1, {
    points: options.points ?? DEFAULT_POINTS,
    tieMargin: options.tieMargin ?? 100,
  });
  return sides?.map((side) => ({ results: side.results, points: side.points }));
}

describe('match results of a room (margin 100, points 3 / 2 / 1 / 0)', () => {
  it.each<[string, Array<[number, number]>, [string[], number], [string[], number]]>([
    ['1400-1350', [[1400, 1350]], [['TW'], 2], [['TL'], 1]],
    ['1400-1300, a gap of exactly the margin', [[1400, 1300]], [['TW'], 2], [['TL'], 1]],
    ['1400-1299', [[1400, 1299]], [['W'], 3], [['L'], 0]],
    ['1400-1400', [[1400, 1400]], [['T'], 1.5], [['T'], 1.5]],
    [
      'two games summed, 1400-1250 then 1330-1400',
      [
        [1400, 1250],
        [1330, 1400],
      ],
      [['W', 'TL'], 4],
      [['L', 'TW'], 2],
    ],
  ])('%s', (_label, games, [firstResults, firstPoints], [secondResults, secondPoints]) => {
    expect(sidesOf({ games })).toEqual([
      { results: firstResults, points: firstPoints },
      { results: secondResults, points: secondPoints },
    ]);
  });

  it('a Best of 3: 2-0 is a Win / Loss, 2-1 a Tie Win / Tie Loss', () => {
    expect(
      sidesOf({
        bestOf: true,
        games: [
          [1400, 1000],
          [1400, 1000],
        ],
      }),
    ).toEqual([
      { results: ['W'], points: 3 },
      { results: ['L'], points: 0 },
    ]);
    expect(
      sidesOf({
        bestOf: true,
        games: [
          [1400, 1000],
          [1000, 1400],
          [1400, 1000],
        ],
      }),
    ).toEqual([
      { results: ['TW'], points: 2 },
      { results: ['TL'], points: 1 },
    ]);
  });

  it('keeps the margin when a team plays one player short: 3 players against 4, 1150-1240 is a Tie Loss / Tie Win', () => {
    expect(resultOfGap(1150 - 1240, 100)).toBe('TL');
    expect(resultOfGap(1240 - 1150, 100)).toBe('TW');
  });

  it('is not a result until every game has a score', () => {
    const state = roomState({
      games: [
        [1400, 1300],
        [1400, 1300],
      ],
    });
    delete state.scores['r0-rm1-p1-g2'];
    expect(matchResultsOfRoom(state, 0, 1, { points: DEFAULT_POINTS, tieMargin: 100 })).toBeNull();
  });

  it('works with a custom table: 5 / 3 / 2 / 0, a Tie worth 2.5', () => {
    const points: MatchResultPoints = [5, 3, 2, 0];
    expect([pointsOfResult('W', points), pointsOfResult('TW', points), pointsOfResult('T', points)]).toEqual([
      5, 3, 2.5,
    ]);
    expect(sidesOf({ points, games: [[1400, 1400]] })).toEqual([
      { results: ['T'], points: 2.5 },
      { results: ['T'], points: 2.5 },
    ]);
  });
});

describe('the settings', () => {
  it('reads four numbers that never increase', () => {
    expect(parseMatchResultPoints('3, 2, 1, 0')).toEqual({ ok: true, value: [3, 2, 1, 0] });
    expect(parseMatchResultPoints('5,3,2.5,0')).toEqual({ ok: true, value: [5, 3, 2.5, 0] });
    expect(parseMatchResultPoints('3, 3, 1, 1')).toMatchObject({ ok: true });
  });

  it.each(['3, 2, 3, 0', '3, 2, 1', '3, 2, -1, -2', '3, 2, x, 0', '3, 2, , 0'])('refuses "%s"', (text) => {
    expect(parseMatchResultPoints(text)).toMatchObject({ ok: false });
  });

  it('names the rule it broke', () => {
    expect(parseMatchResultPoints('3, 2, 3, 0')).toMatchObject({
      message: expect.stringContaining('increase'),
    });
    expect(parseMatchResultPoints('3, 2, -1, -2')).toMatchObject({
      message: expect.stringContaining('0 or more'),
    });
  });

  it('prefills the tie margin for 4v4 only, and asks for one anywhere else', () => {
    expect(defaultTieMargin('team-4v4')).toBe(100);
    expect(defaultTieMargin('individual-1v1')).toBeUndefined();
    expect(resolveTieMargin('', 'team-4v4', 'Team 4v4')).toEqual({ ok: true, value: 100 });
    expect(resolveTieMargin('', 'individual-1v1', '1v1')).toMatchObject({
      ok: false,
      message: expect.stringContaining('tie margin'),
    });
    expect(resolveTieMargin('80', 'individual-1v1', '1v1')).toEqual({ ok: true, value: 80 });
    expect(resolveTieMargin('0', 'individual-1v1', '1v1')).toEqual({ ok: true, value: 0 });
    expect(resolveTieMargin('-5', 'individual-1v1', '1v1')).toMatchObject({ ok: false });
    expect(resolveTieMargin('2.5', 'individual-1v1', '1v1')).toMatchObject({ ok: false });
  });
});

describe('generating with match results', () => {
  const group = {
    poolingPhase: 'group-stage' as const,
    groupSize: '5',
    qualifiersPerGroup: '2',
    qualAdv: '4',
    scoring: 'match-results' as const,
  };

  function teams(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      teamId: `t${index + 1}`,
      teamName: `Team ${index + 1}`,
      members: Array.from({ length: 4 }, (_, slot) => ({ name: `${'abcd'[slot]}${index}` })),
    }));
  }

  function generate(
    setup: Parameters<typeof createDefaultSetup>[0],
    gameFormat: 'team-4v4' | 'individual-1v1',
  ) {
    const count = 10;
    const players =
      gameFormat === 'team-4v4' ? teams(count) : Array.from({ length: count }, (_, index) => `P${index + 1}`);
    return generateTournament(
      createDefaultTournamentState({ confirmedCount: count, players }),
      createDefaultSetup({ gameFormat, ...setup }),
      createTournamentRuntime(),
    );
  }

  it('stores the points and the 4v4 default margin', () => {
    const result = generate(group, 'team-4v4');
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig).toMatchObject({
      scoring: 'match-results',
      matchResultPoints: [3, 2, 1, 0],
      tieMargin: 100,
      groupAverageVersion: 2,
    });
    expect(result.state.settings).toMatchObject({ matchResultPoints: '3, 2, 1, 0', tieMargin: '' });
  });

  it('refuses an empty margin for a format with no default', () => {
    expect(generate(group, 'individual-1v1')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('tie margin'),
    });
    expect(generate({ ...group, tieMargin: '50' }, 'individual-1v1').status).toBe('generated');
  });

  it('refuses points that increase or are negative, naming the rule', () => {
    expect(generate({ ...group, matchResultPoints: '3, 2, 3, 0' }, 'team-4v4')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('increase'),
    });
    expect(generate({ ...group, matchResultPoints: '3, 2, 1, -1' }, 'team-4v4')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('0 or more'),
    });
  });

  it.each(['swiss', 'qual-table'] as const)('refuses %s', (poolingPhase) => {
    expect(generate({ ...group, poolingPhase }, 'team-4v4')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('Group Stage'),
    });
  });

  it('refuses a Best of 5 group round, from the stage or from an override, and takes a Best of 3', () => {
    expect(generate({ ...group, poolingBestOf: '5' }, 'team-4v4')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('Best of 5'),
    });
    expect(generate({ ...group, matchOverrides: 'Round 2: BO7' }, 'team-4v4')).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('Best of 7'),
    });
    expect(generate({ ...group, poolingBestOf: '3' }, 'team-4v4').status).toBe('generated');
  });
});

describe('a no-show under a table whose Loss is worth 1', () => {
  it('still gets 0: below a loss', () => {
    const state = roomState({ points: [3, 2, 1, 1], games: [[1400, 0]] });
    state.absences = { 'r0-rm1-p1': 'absent' };
    state.gamemodeConfig = { ...state.gamemodeConfig, absenceVersion: 1 };
    const table = computeGroupStandings(state).A;
    expect(table.find((entry) => entry.name === 'Y')).toMatchObject({ totalFP: 0, matches: 1 });
    expect(table.find((entry) => entry.name === 'X')).toMatchObject({ totalFP: null, matches: 0 });
  });
});

describe('37 teams of 4v4, group size 4, match results', () => {
  /** The first member of each group beats the rest by 40 points a rank; a team's score is split over its four members. */
  function playedGroupStage(): TournamentState {
    let state = buildState({
      label: 'match-results-37',
      count: 37,
      teams: true,
      setup: {
        gameFormat: 'team-4v4',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        qualAdv: '8',
        oddCountStrategy: 'bye',
        scoring: 'match-results',
      },
    }) as TournamentState;
    const lastRound = state.rounds.filter((round) => round.isGroupStage).length - 1;
    for (let roundIndex = 0; roundIndex <= lastRound; roundIndex += 1) {
      const scores = { ...state.scores };
      const seen = new Map<number, number>();
      for (const entry of state.assignments[roundIndex] ?? []) {
        if (entry.room === null) continue;
        const position = seen.get(entry.room) ?? 0;
        seen.set(entry.room, position + 1);
        const rank =
          state.groups.find((group) => group.members.includes(entry.name))?.members.indexOf(entry.name) ?? 0;
        const keys = scoreKeysForPosition({
          roundIndex,
          room: entry.room,
          position,
          numGames: 1,
          teamSize: 4,
        });
        for (const key of keys) scores[key] = (1200 - 40 * rank) / 4;
      }
      state = { ...state, scores };
      if (roundIndex < lastRound) {
        const result = advanceTournamentRound(state);
        if (result.status !== 'advanced') throw new Error(`stuck at round ${roundIndex}`);
        state = result.state;
      }
    }
    return state;
  }

  it('averages over the matches played; the bye of the group of 5 is worth nothing', () => {
    const state = playedGroupStage();
    const standings = computeGroupStandings(state);
    const five = state.groups.find((group) => group.members.length === 5);
    const four = state.groups.find((group) => group.members.length === 4);
    expect(five).toBeDefined();
    if (!five || !four) return;
    // Gaps of 40, 80, 120, 160 against a margin of 100: Tie Win, Tie Win, Win, Win.
    expect(standings[five.label][0]).toMatchObject({ totalFP: 10, matches: 4, averagePoints: 2.5 });
    expect(standings[four.label][0]).toMatchObject({ totalFP: 7, matches: 3 });
    expect(standings[four.label][0].averagePoints).toBeCloseTo(7 / 3);
    for (const table of Object.values(standings)) {
      expect(table.some((entry) => entry.rounds?.some((round) => round.bye))).toBe(false);
      for (const entry of table) expect(entry.matches).toBe(entry.rounds?.length);
    }
    expect(standings[five.label].map((entry) => entry.name)).toEqual(five.members);
    expect(standings[four.label].map((entry) => entry.name)).toEqual(four.members);
    const codes = standings[four.label][0].rounds?.flatMap((round) => round.results ?? []);
    expect(codes?.sort()).toEqual(['TW', 'TW', 'W']);
  });
});

describe('the Setup fields around match results', () => {
  it('fills the tie margin from the new format while it is empty or still the old default', () => {
    expect(tieMarginAfterFormatChange('', 'ffa-individual', 'team-4v4')).toBe('100');
    expect(tieMarginAfterFormatChange('100', 'team-4v4', 'individual-1v1')).toBe('');
    expect(tieMarginAfterFormatChange('100', 'team-4v4', 'team-4v4')).toBe('100');
  });

  it('keeps a margin the organiser typed', () => {
    expect(tieMarginAfterFormatChange('150', 'team-4v4', 'individual-1v1')).toBe('150');
    expect(tieMarginAfterFormatChange('80', 'individual-1v1', 'team-4v4')).toBe('80');
  });

  it('falls back to Standard points outside a group stage', () => {
    expect(scoringForPooling('match-results', 'group-stage')).toBe('match-results');
    expect(scoringForPooling('match-results', 'swiss')).toBe('fairpoints');
    expect(scoringForPooling('match-results', 'none')).toBe('fairpoints');
    expect(scoringForPooling('positional-points', 'none')).toBe('positional-points');
  });
});

describe('a tied game in a group room', () => {
  it('raises no room tie under match results, and still raises one under Standard points', () => {
    const state = roomState({ games: [[1400, 1400]] });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
    expect(hasPendingTies(state, 0)).toBe(false);
    const standard = {
      ...state,
      gamemodeConfig: { ...state.gamemodeConfig, scoring: 'fairpoints' as const },
    };
    expect(Object.keys(detectTieBreaks(0, standard.rounds[0], standard))).toHaveLength(1);
    expect(hasPendingTies(standard, 0)).toBe(true);
  });

  it('raises none when two games have equal totals but different results', () => {
    const state = roomState({
      games: [
        [1400, 1000],
        [1000, 1400],
      ],
    });
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });
});
