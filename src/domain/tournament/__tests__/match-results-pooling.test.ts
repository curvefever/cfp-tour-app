import { describe, expect, it } from 'vitest';
import { computeQualificationStandings, detectTieBreaks } from '../advancement';
import { generateTournament } from '../generation';
import { matchResultsAllowed } from '../match-results';
import { removeRosterUnit } from '../mutations';
import { createTournamentRuntime } from '../runtime';
import { scoreKeysForPosition } from '../scoring';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { buildState } from './play-through';

type Setup = Parameters<typeof createDefaultSetup>[0];

const POOLING: Setup = { gameFormat: 'team-4v4', oddCountStrategy: 'bye', scoring: 'match-results' };

function pooled(count: number, setup: Setup): TournamentState {
  const state = buildState({
    label: 'match-results-pooling',
    count,
    teams: true,
    setup: { ...POOLING, ...setup },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

/** Scores a room of two 4-player teams: each team's total is split over its four members. */
function scoreRoom(state: TournamentState, roundIndex: number, room: number, totals: [number, number]) {
  const scores = { ...state.scores };
  totals.forEach((total, position) => {
    for (const key of scoreKeysForPosition({ roundIndex, room, position, numGames: 1, teamSize: 4 })) {
      scores[key] = total / 4;
    }
  });
  return { ...state, scores };
}

const seated = (state: TournamentState, roundIndex: number, room: number) =>
  (state.assignments[roundIndex] ?? []).filter((entry) => entry.room === room).map((entry) => entry.name);

const pointsOf = (state: TournamentState, name: string) =>
  computeQualificationStandings(state).find((entry) => entry.name === name)?.totalFP;

describe('match results in a 4v4 qualification table, 13 teams', () => {
  const start = () => pooled(13, { poolingPhase: 'qual-table' });
  /** Room 1: won by 150 (a Win). Room 2: won by 100 (a Tie win). Room 3: equal scores (a Tie). Room 4: won by 500. */
  const played = () => {
    let state = start();
    state = scoreRoom(state, 0, 1, [1500, 1350]);
    state = scoreRoom(state, 0, 2, [1500, 1400]);
    state = scoreRoom(state, 0, 3, [1400, 1400]);
    return scoreRoom(state, 0, 4, [1500, 1000]);
  };

  it('reads the margin of the format and gives the group stage defaults', () => {
    expect(start().gamemodeConfig).toMatchObject({
      scoring: 'match-results',
      matchResultPoints: [3, 2, 1, 0],
      tieMargin: 100,
    });
  });

  it('gives each room the points of its match result, and the bye a win', () => {
    const state = played();
    const [one, two, three, four] = [1, 2, 3, 4].map((room) => seated(state, 0, room));
    expect([pointsOf(state, one[0]), pointsOf(state, one[1])]).toEqual([3, 0]);
    expect([pointsOf(state, two[0]), pointsOf(state, two[1])]).toEqual([2, 1]);
    expect([pointsOf(state, three[0]), pointsOf(state, three[1])]).toEqual([1.5, 1.5]);
    expect([pointsOf(state, four[0]), pointsOf(state, four[1])]).toEqual([3, 0]);
    expect(pointsOf(state, state.byes[0][0])).toBe(3);
  });

  it('gives no points for a room that is not fully scored', () => {
    const state = scoreRoom(start(), 0, 1, [1500, 1350]);
    const half = { ...state, scores: Object.fromEntries(Object.entries(state.scores).slice(0, 5)) };
    const [first] = seated(half, 0, 1);
    expect(pointsOf(half, first) ?? 0).toBe(0);
  });

  it('sorts the standings by these sums', () => {
    const totals = computeQualificationStandings(played()).map((entry) => entry.totalFP ?? 0);
    expect(totals).toEqual([...totals].sort((first, second) => second - first));
  });

  it('raises no room tie card on equal scores', () => {
    const state = played();
    expect(detectTieBreaks(0, state.rounds[0], state)).toEqual({});
  });

  it('leaves the tie card to the places without match results', () => {
    const plain = pooled(13, { poolingPhase: 'qual-table', scoring: 'fairpoints' });
    const tied = scoreRoom(plain, 0, 3, [1400, 1400]);
    expect(Object.keys(detectTieBreaks(0, tied.rounds[0], tied))).toHaveLength(1);
  });

  it('counts a room left with one present team as a win', () => {
    const state = played();
    const [present, gone] = seated(state, 0, 1);
    expect(pointsOf(removeRosterUnit(state, gone), present)).toBe(3);
  });
});

describe('match results in a 4v4 Swiss, 16 teams', () => {
  it('gives the same points, and the next round pairs by them', () => {
    let state = pooled(16, { poolingPhase: 'swiss' });
    for (let room = 1; room <= 8; room += 1) state = scoreRoom(state, 0, room, [1500, 1000 + room]);
    const winners = [1, 2, 3, 4, 5, 6, 7, 8].map((room) => seated(state, 0, room)[0]);
    for (const name of winners) expect(pointsOf(state, name)).toBe(3);
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error(`expected an advance, got ${result.status}`);
    for (let room = 1; room <= 8; room += 1) {
      const pair = seated(result.state, 1, room);
      // Swiss folds the standings: each of the 8 winners meets one of the 8 losers.
      expect(winners.includes(pair[0])).not.toBe(winners.includes(pair[1]));
    }
  });
});

describe('where match results are available', () => {
  const generate = (
    setup: Setup,
    gameFormat: 'team-4v4' | 'ffa-individual' | 'team-2v2v2v2' = 'team-4v4',
  ) => {
    const players =
      gameFormat === 'ffa-individual'
        ? Array.from({ length: 16 }, (_, index) => `P${index + 1}`)
        : Array.from({ length: 16 }, (_, index) => ({
            teamId: `t${index + 1}`,
            teamName: `Team ${index + 1}`,
            members: Array.from({ length: gameFormat === 'team-2v2v2v2' ? 2 : 4 }, (_, slot) => ({
              name: `${'abcd'[slot]}${index}`,
            })),
          }));
    return generateTournament(
      createDefaultTournamentState({ confirmedCount: 16, players }),
      createDefaultSetup({ gameFormat, qualAdv: '12', scoring: 'match-results', ...setup }),
      createTournamentRuntime(),
    );
  };

  it.each(['qual-table', 'swiss'] as const)('is accepted for 4v4 with %s', (poolingPhase) => {
    expect(generate({ poolingPhase, oddCountStrategy: 'bye' }).status).toBe('generated');
  });

  it('is refused for FFA, 2v2v2v2 and a Flex format, naming why', () => {
    for (const result of [
      generate({ poolingPhase: 'qual-table' }, 'ffa-individual'),
      generate({ poolingPhase: 'qual-table' }, 'team-2v2v2v2'),
      generate({ poolingPhase: 'qual-table', oddCountStrategy: 'flex' }),
    ]) {
      expect(result).toMatchObject({ status: 'invalid', message: expect.stringContaining('two units') });
    }
  });

  it('a Best of 5 is refused in a qualification round', () => {
    expect(generate({ poolingPhase: 'qual-table', poolingBestOf: '5' })).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('Best of 5 pooling round'),
    });
  });

  it('is the predicate Setup asks', () => {
    expect(matchResultsAllowed('group-stage')).toBe(true);
    expect(matchResultsAllowed('swiss', 'team-4v4', 'bye')).toBe(true);
    expect(matchResultsAllowed('qual-table', 'team-4v4', 'flex')).toBe(false);
    expect(matchResultsAllowed('qual-table', 'ffa-individual')).toBe(false);
    expect(matchResultsAllowed('qual-table', 'team-2v2v2v2')).toBe(false);
    expect(matchResultsAllowed('none', 'team-4v4')).toBe(false);
  });
});
