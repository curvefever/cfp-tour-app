import { describe, expect, it } from 'vitest';
import { computeGroupStandings, computeQualificationStandings } from '../advancement';
import { removeRosterUnit } from '../unit-removal';
import { createDefaultSetup } from '../state-defaults';
import type { TournamentState } from '../types';
import { buildState, pressNextRound, scoreCurrentRound } from './play-through';

type Setup = Parameters<typeof createDefaultSetup>[0];

/** A 1v1 tournament scored by match results with a margin of 5: the played rooms are clean Wins and Losses (gaps of 10). */
function matchResultsState(count: number, setup: Setup): TournamentState {
  const state = buildState({
    label: 'bye-tie-win',
    count,
    teams: false,
    setup: {
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      oddCountStrategy: 'bye',
      scoring: 'match-results',
      tieMargin: '5',
      qualAdv: '12',
      ...setup,
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

const standingOf = (state: TournamentState, name: string) =>
  computeQualificationStandings(state).find((entry) => entry.name === name);

describe('a bye under match results is a Tie Win', () => {
  it('15-unit Swiss, 3 rounds: each bye earns 2 with result TW, no score or place; played rooms keep their points', () => {
    let state = scoreCurrentRound(matchResultsState(15, {}), 0);
    const byeRounds: Array<[number, string]> = [];
    for (let round = 0; round < 3; round += 1) {
      byeRounds.push([round, state.byes[round][0]]);
      if (round < 2) state = scoreCurrentRound(pressNextRound(state), 0);
    }
    const standings = computeQualificationStandings(state);
    for (const [roundIndex, name] of byeRounds) {
      const outcome = standings
        .find((entry) => entry.name === name)
        ?.rounds?.find((result) => result.roundIndex === roundIndex);
      expect(outcome).toMatchObject({ bye: true, points: 2, results: ['TW'], score: null, rank: null });
    }
    const played = standings.flatMap((entry) => entry.rounds ?? []).filter((result) => !result.bye);
    expect(played.every((result) => result.points === 3 || result.points === 0)).toBe(true);
  });

  it('two games a round earn 4 (two TW); a Best of 3 earns 2 (one TW)', () => {
    const twoGames = scoreCurrentRound(matchResultsState(15, { poolingGames: '2' }), 0);
    const twoOutcome = standingOf(twoGames, twoGames.byes[0][0])?.rounds?.[0];
    expect(twoOutcome).toMatchObject({ points: 4, results: ['TW', 'TW'] });

    const bestOf = matchResultsState(15, { poolingBestOf: '3' });
    const bestOutcome = standingOf(bestOf, bestOf.byes[0][0])?.rounds?.[0];
    expect(bestOutcome).toMatchObject({ points: 2, results: ['TW'] });
  });

  it('custom points 5, 3, 1, 0: a bye earns 3', () => {
    const state = scoreCurrentRound(matchResultsState(15, { matchResultPoints: '5, 3, 1, 0' }), 0);
    expect(standingOf(state, state.byes[0][0])?.totalFP).toBe(3);
  });

  it('a qualification table gives its bye the Tie Win too', () => {
    const state = scoreCurrentRound(matchResultsState(15, { poolingPhase: 'qual-table' }), 0);
    expect(standingOf(state, state.byes[0][0])?.rounds?.[0]).toMatchObject({ points: 2, results: ['TW'] });
  });

  it('a unit left alone because its opponent was removed still earns a full Win', () => {
    const state = scoreCurrentRound(matchResultsState(15, {}), 0);
    const [first, second] = state.assignments[0]
      .filter((entry) => entry.room === 1)
      .map((entry) => entry.name);
    const lone = standingOf(removeRosterUnit(state, second), first)?.rounds?.[0];
    expect(lone).toMatchObject({ points: 3, results: ['W'] });
  });

  it("a unit on a bye under Standard points still earns the winner's points", () => {
    const state = scoreCurrentRound(matchResultsState(15, { scoring: 'fairpoints', tieMargin: '' }), 0);
    expect(standingOf(state, state.byes[0][0])?.rounds?.[0]).toMatchObject({ points: 2, bye: true });
  });
});

describe('a group stage without per-match standings keeps its bye as a Win', () => {
  it('earlier group rule, 31 units: the bye of a group of 3 earns a Win', () => {
    const state = matchResultsState(31, {
      poolingPhase: 'group-stage',
      groupSize: '4',
      qualifiersPerGroup: '2',
      qualAdv: '8',
    });
    const earlier: TournamentState = {
      ...scoreCurrentRound(state, 0),
      gamemodeConfig: { ...state.gamemodeConfig, groupAverageVersion: undefined },
    };
    const [name] = earlier.rounds[0].groupByes ?? [];
    const outcome = Object.values(computeGroupStandings(earlier))
      .flat()
      .find((entry) => entry.name === name)?.rounds?.[0];
    expect(outcome).toMatchObject({ bye: true, points: 3, results: ['W'] });
  });
});
