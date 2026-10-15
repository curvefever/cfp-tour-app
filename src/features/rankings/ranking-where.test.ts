import { describe, expect, it } from 'vitest';
import { orderedQualificationTable } from '../../domain/tournament/advancement';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import {
  buildQualWaterfall,
  playToQualificationExit,
} from '../../domain/tournament/__tests__/qual-waterfall';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { computeRankings } from '../../domain/tournament/rankings';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { eliminatedWhere, finalistWhere, stillInWhere, WITHDRAWN_WHERE } from './ranking-where';

function advance(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status !== 'advanced') throw new Error(`could not advance: ${result.status}`);
  return result.state;
}

function advanceWhile(
  start: TournamentState,
  keepGoing: (round: TournamentState['rounds'][number]) => boolean,
) {
  let state = start;
  while (keepGoing(state.rounds[state.curRound])) state = advance(state);
  return state;
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

function wheres(state: TournamentState) {
  const rankings = computeRankings(state);
  if (!rankings) throw new Error('no rankings');
  const labels = bracketRoundLabels(state);
  return {
    rankings,
    stillIn: rankings.stillActive.map((entry) => stillInWhere(state, rankings.lastRi, entry, labels)),
    eliminated: rankings.eliminatedList.map((entry) => eliminatedWhere(state, entry, labels)),
  };
}

describe.each([31, 37, 43, 53])(
  'the where line with %i players, right after the qualification table',
  (count) => {
    const afterPooling = advanceWhile(qualTournament(count), (round) => Boolean(round.isQual));

    it('puts every unit the cut sent out at "Qualification · #N", N from the standings', () => {
      const { rankings, eliminated } = wheres(afterPooling);
      expect(rankings.eliminatedList).toHaveLength(count - 24);
      rankings.eliminatedList.forEach((entry, index) => {
        expect(eliminated[index]).toBe(`Qualification · #${entry.poolRank?.rank}`);
        expect(entry.poolRank?.rank).toBeGreaterThanOrEqual(24);
      });
    });

    it('names the room of a unit still in, with no place before the room is scored', () => {
      const { stillIn } = wheres(afterPooling);
      expect(stillIn).toHaveLength(24);
      expect(stillIn.every((where) => /^Round 4 · Room [A-C]$/.test(where))).toBe(true);
    });

    it('adds the place once the whole room is scored', () => {
      const scored = { ...afterPooling, scores: scoreCurrentRound(afterPooling, 0).scores };
      const { stillIn } = wheres(scored);
      expect(stillIn.every((where) => /^Round 4 · Room [A-C] · [1-8](st|nd|rd|th)$/.test(where))).toBe(true);
    });
  },
);

describe('the where line at 37 players after the Quarters', () => {
  it('names the room and the place of a unit a room eliminated, and the standings place of the 13 the cut sent out', () => {
    const quarters = advanceWhile(qualTournament(37), (round) => Boolean(round.isQual));
    const afterQuarters = advance(quarters);
    const { rankings, eliminated } = wheres(afterQuarters);
    const outInQuarters = rankings.eliminatedList.filter((entry) => !entry.atCut);
    expect(outInQuarters.length).toBeGreaterThan(0);
    const labels = bracketRoundLabels(afterQuarters);
    for (const entry of outInQuarters) {
      expect(eliminatedWhere(afterQuarters, entry, labels)).toMatch(
        /^Round 4 · Room [A-C] · \d+(st|nd|rd|th)$/,
      );
    }
    expect(eliminated.filter((where) => where.startsWith('Qualification · #')).length).toBe(13);
  });
});

describe('the where line after the Final', () => {
  const state = createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: ['P1', 'P2', 'P3', 'P4'],
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [4], players: 4, advPerRoom: 2 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, isFinal: true, numGames: 1 }),
    ],
    assignments: [
      [
        { name: 'P1', room: 1, isLucky: false },
        { name: 'P2', room: 1, isLucky: false },
        { name: 'P3', room: 1, isLucky: false },
        { name: 'P4', room: 1, isLucky: false },
      ],
      [
        { name: 'P1', room: 1, isLucky: false },
        { name: 'P2', room: 1, isLucky: false },
      ],
    ],
    scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300, 'r0-rm1-p2': 200, 'r0-rm1-p3': 100 },
    finalScores: { 'game1-P1': 50, 'game1-P2': 80 },
  });

  it('reads "Final · 1st" for the winner, and the room and place of those out earlier', () => {
    const rankings = computeRankings(state);
    const labels = bracketRoundLabels(state);
    if (!rankings) throw new Error('no rankings');
    expect(rankings.finalists.map((entry) => finalistWhere(rankings.lastRi, entry, labels))).toEqual([
      'Final · 1st',
      'Final · 2nd',
    ]);
    expect(rankings.eliminatedList.map((entry) => eliminatedWhere(state, entry, labels))).toEqual([
      'Round 1 · Room A · 3rd',
      'Round 1 · Room A · 4th',
    ]);
  });

  it('names a unit that is still playing the Final by the round alone, not "Final · Final"', () => {
    const playing = { ...state, finalScores: {} };
    const rankings = computeRankings(playing);
    const labels = bracketRoundLabels(playing);
    if (!rankings) throw new Error('no rankings');
    const where = rankings.stillActive.map((entry) => stillInWhere(playing, rankings.lastRi, entry, labels));
    expect(where).toEqual(['Final', 'Final']);
  });
});

describe('the where line of a unit waiting in a waterfall', () => {
  it('reads "Waiting for R1C" for ranks 17-24 and the room of R1 for the rest at 37 registered', () => {
    const exit = playToQualificationExit(buildQualWaterfall(37));
    const order = orderedQualificationTable(exit).ordered.map((entry) => entry.name);
    const result = advanceTournamentRound(exit);
    if (result.status !== 'advanced') throw new Error('expected the pooling exit to advance');
    const state = result.state;
    const rankings = computeRankings(state);
    const labels = bracketRoundLabels(state);
    if (!rankings) throw new Error('no rankings');
    const where = new Map(
      rankings.stillActive.map((entry) => [entry.name, stillInWhere(state, rankings.lastRi, entry, labels)]),
    );
    for (const name of order.slice(16, 24)) expect(where.get(name)).toBe('Waiting for R1C');
    for (const name of order.slice(0, 16)) expect(where.get(name)).toMatch(/^R1 · Room [A-B]$/);
    const out = rankings.eliminatedList.map((entry) => eliminatedWhere(state, entry, labels));
    expect(out).toHaveLength(13);
    expect(out.every((text) => /^Qualification · #\d+$/.test(text))).toBe(true);
  });
});

describe('the where line of a group stage with 13 players', () => {
  it("names the unit's place in its own group for those the group cut sent out", () => {
    const start = buildState({
      label: 'groups',
      count: 13,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        oddCountStrategy: 'bye',
        scheduleLogic: 'single-elimination',
      },
    });
    if (!start) throw new Error('generation failed');
    const state = advanceWhile(start, (round) => Boolean(round.isGroupStage));
    const { rankings, eliminated } = wheres(state);
    expect(rankings.eliminatedList.length).toBeGreaterThan(0);
    expect(eliminated.every((text) => /^Group [A-C] · #[3-5]$/.test(text))).toBe(true);
  });
});

describe('the where line of a unit on a bye', () => {
  it('reads "Round 1 · Bye" for the one unit of a 13-player group stage that sits the first round out', () => {
    const state = buildState({
      label: 'groups',
      count: 13,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        oddCountStrategy: 'bye',
        scheduleLogic: 'single-elimination',
      },
    });
    if (!state) throw new Error('generation failed');
    const { stillIn, rankings } = wheres(state);
    expect(stillIn.filter((where) => where.endsWith('Bye'))).toEqual(['Round 1 · Bye']);
    expect(rankings.stillActive.filter((entry) => entry.room === null)).toHaveLength(1);
    expect(
      stillIn
        .filter((where) => !where.endsWith('Bye'))
        .every((where) => /^Round 1 · Group [A-C] · Room [A-Z]$/.test(where)),
    ).toBe(true);
  });
});

describe('the where line of a withdrawn unit', () => {
  it('is "Withdrawn", for a unit that played before it left', () => {
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      rounds: [buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1 })],
      assignments: [
        [
          { name: 'P1', room: 1, isLucky: false },
          { name: 'P2', room: 1, isLucky: false },
        ],
      ],
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 50 },
      withdrawnUnits: [{ name: 'P3', label: 'P3', members: null, playedAnyMatch: true, reason: 'removed' }],
    });
    const rankings = computeRankings(state);
    expect(rankings?.dnfList.map((unit) => unit.name)).toEqual(['P3']);
    expect(WITHDRAWN_WHERE).toBe('Withdrawn');
  });
});
