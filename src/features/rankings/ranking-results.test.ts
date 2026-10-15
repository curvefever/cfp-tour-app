import { describe, expect, it } from 'vitest';
import { getAllTies, orderedQualificationTable } from '../../domain/tournament/advancement';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import {
  buildQualWaterfall,
  playToQualificationExit,
} from '../../domain/tournament/__tests__/qual-waterfall';
import { computeRankings } from '../../domain/tournament/rankings';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { stillInResults } from './ranking-results';

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status !== 'advanced') throw new Error(`could not advance: ${result.status}`);
  return result.state;
}

function qualTournament(count: number): TournamentState {
  const state = buildState({
    label: `${count}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

function resultsOf(state: TournamentState) {
  const rankings = computeRankings(state);
  if (!rankings) throw new Error('no rankings');
  return stillInResults(state, rankings.lastRi, rankings.stillActive);
}

const counts = (results: Map<string, string>) => {
  const tally: Record<string, number> = {};
  for (const result of results.values()) tally[result] = (tally[result] ?? 0) + 1;
  return tally;
};

describe.each([37, 43])('the stripe of a unit still in, with %i players', (count) => {
  const pooled = (() => {
    let state = qualTournament(count);
    while (state.rounds[state.curRound].isQual) state = advance(state);
    return state;
  })();

  it('has no stripe in a pooling round', () => {
    const state = qualTournament(count);
    expect(new Set(resultsOf(state).values())).toEqual(new Set(['']));
  });

  it('is undecided for everyone while the Quarters rooms are not scored', () => {
    expect(counts(resultsOf(pooled))).toEqual({ undecided: 24 });
  });

  it('is green for places 1-6, a dashed candidate for 7th and red for 8th once the rooms are scored', () => {
    const scored = { ...pooled, scores: scoreCurrentRound(pooled, 0).scores };
    expect(counts(resultsOf(scored))).toEqual({ advance: 18, candidate: 3, eliminate: 3 });
  });
});

describe('the stripe of a unit waiting in a waterfall', () => {
  it('is green for the ranks sent on to a round that is not drawn yet, and undecided in the room being played', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const order = orderedQualificationTable(exit).ordered.map((entry) => entry.name);
    const next = advanceTournamentRound(exit);
    if (next.status !== 'advanced') throw new Error('expected the pooling exit to advance');
    const results = resultsOf(next.state);
    for (const name of order.slice(16, 24)) expect(results.get(name)).toBe('advance');
    for (const name of order.slice(0, 16)) expect(results.get(name)).toBe('undecided');
  });
});

describe('the stripe of units in an unresolved tie', () => {
  /** Round 4 of 37 players with every room scored, and room 1's 6th and 7th placed units on the same score. */
  function tiedAtTheEdge() {
    let state = qualTournament(37);
    while (state.rounds[state.curRound].isQual) state = advance(state);
    const scored = { ...state, scores: scoreCurrentRound(state, 0).scores };
    const ri = scored.curRound;
    const seats = (scored.assignments[ri] ?? [])
      .filter((entry) => entry.room === 1)
      .map((entry, position) => ({ entry, key: `r${ri}-rm1-p${position}` }));
    const ordered = [...seats].sort((a, b) => (scored.scores[b.key] ?? 0) - (scored.scores[a.key] ?? 0));
    const tied = { ...scored, scores: { ...scored.scores, [ordered[6].key]: scored.scores[ordered[5].key] } };
    return { state: tied, names: [ordered[5].entry.name, ordered[6].entry.name], ri };
  }

  it('reads pending for the tied units until the organiser resolves it, then their normal result', () => {
    const { state, names, ri } = tiedAtTheEdge();
    const tie = Object.entries(getAllTies(state, ri));
    expect(tie).toHaveLength(1);
    const before = resultsOf(state);
    expect(names.map((name) => before.get(name))).toEqual(['pending', 'pending']);
    const [key] = tie[0];
    const resolved = { ...state, tieResolutions: { ...state.tieResolutions, [key]: [names[0]] } };
    const after = resultsOf(resolved);
    expect(names.map((name) => after.get(name))).not.toContain('pending');
    expect(after.get(names[0])).toBe('advance');
  });
});
