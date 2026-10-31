import { describe, expect, it } from 'vitest';
import { computeGroupStandings, computeQualificationStandings } from '../advancement';
import { isUnitAbsentFromRoom } from '../absences';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { removeRosterUnit, swapTeam } from '../mutations';
import { getUnitScore, scoreKeysForPosition } from '../scoring';
import { advanceTournamentRound } from '../transitions';
import type { TeamScoringRuleKey, TournamentState, TournamentTeam } from '../types';
import { buildState, scoreCurrentRound } from './play-through';

/**
 * A team that leaves the roster (removed, or swapped out) is in neither the players nor the reserves any more, but the
 * rooms it played in the rounds before still hold its scores: they must read as they were typed.
 */

const REPLACEMENT: TournamentTeam = {
  teamId: 'tNew',
  teamName: 'New Team',
  members: [{ name: 'n1' }, { name: 'n2' }],
};

const RULES: TeamScoringRuleKey[] = ['sum-members', 'designated-player', ONE_SCORE_PER_TEAM];

function groupStage2v2(teamScoringRule: TeamScoringRuleKey): TournamentState {
  const state = buildState({
    label: `2v2-${teamScoringRule}`,
    count: 8,
    teams: true,
    setup: {
      gameFormat: 'team-2v2',
      poolingPhase: 'group-stage',
      groupSize: '4',
      qualifiersPerGroup: '2',
      qualAdv: '4',
      teamScoringRule,
    },
  });
  if (!state) throw new Error('generation failed');
  return state;
}

/** Round 0 scored and advanced; the state is in round 1 with the seat's team and the score it had. */
function afterRoundOne(state: TournamentState) {
  const scored = scoreCurrentRound(
    state,
    ONE_SCORE_PER_TEAM === state.gamemodeConfig.teamScoringRule ? 0 : 2,
  );
  const seat = scored.assignments[0].find((entry) => entry.room === 1);
  if (!seat) throw new Error('no seat in room 1');
  const before = getUnitScore(scored, 0, 1, 0, null);
  const advanced = advanceTournamentRound(scored);
  if (advanced.status !== 'advanced') throw new Error(`stuck: ${advanced.status}`);
  return { state: advanced.state, team: seat.name, before };
}

describe('a team that left the roster keeps its past scores', () => {
  it.each(RULES)('removed, %s', (rule) => {
    const { state, team, before } = afterRoundOne(groupStage2v2(rule));
    expect(before).toBeGreaterThan(0);
    const after = removeRosterUnit(state, team);
    expect(getUnitScore(after, 0, 1, 0, null)).toBe(before);
  });

  it.each(RULES)('swapped out, %s', (rule) => {
    const { state, team, before } = afterRoundOne(groupStage2v2(rule));
    const after = swapTeam(state, team, REPLACEMENT);
    expect(after).not.toBe(state);
    expect(getUnitScore(after, 0, 1, 0, null)).toBe(before);
  });

  it('keeps the designated defender of a team whose defender changed before it left', () => {
    const { state, team, before } = afterRoundOne(groupStage2v2('designated-player'));
    const changed = { ...state, defenderChanges: { [team]: [{ round: 0, memberIdx: 1 }] } };
    const readAs = getUnitScore(changed, 0, 1, 0, null);
    const after = removeRosterUnit(changed, team);
    expect(getUnitScore(after, 0, 1, 0, null)).toBe(readAs);
    expect(readAs).not.toBe(before);
  });
});

describe('the group stage keeps what a swapped-out team did', () => {
  it('the replacement’s line holds the old team’s round, and the opponent’s result stays', () => {
    const { state, team } = afterRoundOne(groupStage2v2('sum-members'));
    const opponent = state.assignments[0].find((entry) => entry.room === 1 && entry.name !== team)?.name;
    if (!opponent) throw new Error('no opponent');
    const lineOf = (current: TournamentState, name: string) =>
      Object.values(computeGroupStandings(current))
        .flat()
        .find((entry) => entry.name === name);
    const oldLine = lineOf(state, team)?.rounds?.find((round) => round.roundIndex === 0);
    const opponentLine = lineOf(state, opponent)?.rounds?.find((round) => round.roundIndex === 0);
    expect(oldLine).toBeDefined();
    const swapped = swapTeam(state, team, REPLACEMENT);
    expect(lineOf(swapped, REPLACEMENT.teamId)?.rounds?.find((round) => round.roundIndex === 0)).toEqual(
      oldLine,
    );
    expect(lineOf(swapped, opponent)?.rounds?.find((round) => round.roundIndex === 0)).toEqual(opponentLine);
  });
});

describe('a team-format qualification table', () => {
  it('a removal leaves the other units’ past places and points unchanged', () => {
    const base = buildState({
      label: 'qual-2v2v2v2',
      count: 12,
      teams: true,
      setup: { gameFormat: 'team-2v2v2v2', poolingPhase: 'qual-table', qualAdv: '6' },
    });
    if (!base) throw new Error('generation failed');
    const scored = scoreCurrentRound(base, 2);
    const victim = scored.assignments[0].find((entry) => entry.room === 1)?.name;
    if (!victim) throw new Error('no seat');
    const advanced = advanceTournamentRound(scored);
    if (advanced.status !== 'advanced') throw new Error(`stuck: ${advanced.status}`);
    const firstRound = (current: TournamentState) =>
      Object.fromEntries(
        computeQualificationStandings(current)
          .filter((entry) => entry.name !== victim)
          .map((entry) => [entry.name, entry.rounds?.find((round) => round.roundIndex === 0)]),
      );
    const before = firstRound(advanced.state);
    expect(Object.values(before).some((round) => round !== undefined)).toBe(true);
    expect(firstRound(removeRosterUnit(advanced.state, victim))).toEqual(before);
  });
});

describe('a team that left the roster stays absent from the room it missed', () => {
  it('removed after the round was advanced', () => {
    const base = groupStage2v2('sum-members');
    const scored = scoreCurrentRound(base, 2);
    const seat = scored.assignments[0].find((entry) => entry.room === 1);
    if (!seat) throw new Error('no seat');
    const keys = scoreKeysForPosition({ roundIndex: 0, room: 1, position: 0, numGames: 1, teamSize: 2 });
    const absent = {
      ...scored,
      scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
      absences: Object.fromEntries(keys.map((key) => [key, 'absent' as const])),
    };
    const advanced = advanceTournamentRound(absent);
    if (advanced.status !== 'advanced') throw new Error(`stuck: ${advanced.status}`);
    expect(isUnitAbsentFromRoom(advanced.state, 0, 1, 0)).toBe(true);
    expect(isUnitAbsentFromRoom(removeRosterUnit(advanced.state, seat.name), 0, 1, 0)).toBe(true);
  });
});
