import { describe, expect, it } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { NO_BREAK_SPACE } from '../tournament/components/member-line';
import { answerAbsence, markSurvivalMemberAbsent } from '../../domain/tournament/absences';
import { teamMemberLine } from './team-member-line';

/** The line with each no-break space shown as "_": a line may wrap only at the plain spaces left. */
function shown(line: string): string {
  return line.replaceAll(NO_BREAK_SPACE, '_');
}

function teams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `Ana${index + 1}` }, { name: `Ben${index + 1}` }],
  }));
}

function start(rule: 'sum-members' | 'designated-player' | 'survival-teams', count = 13): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teams(count) }),
    createDefaultSetup({
      gameFormat: 'team-2v2v2v2',
      poolingPhase: 'qual-table',
      qualAdv: '8',
      teamScoringRule: rule,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${JSON.stringify(result)}`);
  return { ...result.state, started: true };
}

/** Gives the unit seated first in room 1 member scores 23 and 18 (or one team score under Survival Teams). */
function scoredFirstSeat(state: TournamentState): { state: TournamentState; name: string } {
  const seat = (state.assignments[0] ?? []).find((entry) => entry.room === 1);
  if (!seat) throw new Error('nobody in room 1');
  const base = 'r0-rm1-p0';
  const scores: Record<string, number> =
    state.gamemodeConfig.teamScoringRule === 'survival-teams'
      ? { [base]: 41 }
      : { [`${base}-m0`]: 23, [`${base}-m1`]: 18 };
  return { state: { ...state, scores: { ...state.scores, ...scores } }, name: seat.name };
}

describe('teamMemberLine at 13 teams in 2v2v2v2', () => {
  it('joins the members with " · " and shows names only before the room is complete', () => {
    const { state, name } = scoredFirstSeat(start('sum-members'));
    const line = teamMemberLine(state, name, 0);
    expect(shown(line)).toMatch(/^Ana\d+_· Ben\d+$/);
  });

  it("adds each member's own score after the name once the room is complete (sum of members)", () => {
    const { state, name } = scoredFirstSeat(start('sum-members'));
    const number = name.replace('t', '');
    expect(shown(teamMemberLine(state, name, 0, { room: 1, position: 0 }))).toBe(
      `Ana${number}_23_· Ben${number}_18`,
    );
  });

  it('wraps only after a " · ": a member never parts from their score', () => {
    const { state, name } = scoredFirstSeat(start('sum-members'));
    const number = name.replace('t', '');
    const line = teamMemberLine(state, name, 0, { room: 1, position: 0 });
    expect(shown(line).split(' ')).toEqual([`Ana${number}_23_·`, `Ben${number}_18`]);
  });

  it('keeps the shield on the designated defender under Save your Buddy, with the scores', () => {
    const { state, name } = scoredFirstSeat(start('designated-player'));
    const line = teamMemberLine(state, name, 0, { room: 1, position: 0 });
    expect(shown(line)).toMatch(
      /^Ana\d+_23_· Ben\d+_18$|^Ana\d+_🛡_23_· Ben\d+_18$|^Ana\d+_23_· Ben\d+_🛡_18$/,
    );
    expect(line.match(/🛡/g)).toHaveLength(1);
  });

  it('shows names only under Survival Teams (one score per team), even when the room is complete', () => {
    const { state, name } = scoredFirstSeat(start('survival-teams'));
    expect(shown(teamMemberLine(state, name, 0, { room: 1, position: 0 }))).toMatch(/^Ana\d+_· Ben\d+$/);
  });

  it("sums a member's scores over the games of a multi-game round", () => {
    const { state, name } = scoredFirstSeat(start('sum-members'));
    const round = state.rounds[0];
    const twoGames: TournamentState = {
      ...state,
      rounds: [{ ...round, numGames: 2 }, ...state.rounds.slice(1)],
      scores: {
        'r0-rm1-p0-g1-m0': 10,
        'r0-rm1-p0-g2-m0': 13,
        'r0-rm1-p0-g1-m1': 8,
        'r0-rm1-p0-g2-m1': 10,
      },
    };
    const number = name.replace('t', '');
    expect(shown(teamMemberLine(twoGames, name, 0, { room: 1, position: 0 }))).toBe(
      `Ana${number}_23_· Ben${number}_18`,
    );
  });

  it('is empty for a unit without members (an individual in an individual format)', () => {
    const individuals = createDefaultTournamentState({ confirmedCount: 3, players: ['A', 'B', 'C'] });
    expect(teamMemberLine(individuals, 'A', 0)).toBe('');
  });
});

describe('teamMemberLine: absent members', () => {
  function played(rule: 'sum-members' | 'survival-teams') {
    const state = start(rule, 6);
    const roundIndex = state.curRound;
    const first = state.assignments[roundIndex].find((entry) => entry.room === 1);
    if (!first) throw new Error('no seat');
    return { state, roundIndex, name: first.name };
  }

  it('shows ABS after a member who scored 0 and was absent, instead of the member score', () => {
    const { state, roundIndex, name } = played('sum-members');
    const keys = [0, 1].map((member) => `r${roundIndex}-rm1-p0-m${member}`);
    const scored = answerAbsence({ ...state, scores: { [keys[0]]: 0, [keys[1]]: 55 } }, [keys[0]], 'absent');
    expect(shown(teamMemberLine(scored, name, roundIndex, { room: 1, position: 0 }))).toMatch(
      /^Ana\d+_ABS_· Ben\d+_55$/,
    );
  });

  it('shows a muted "absent" after a Survival member marked by hand, before the room is complete too', () => {
    const { state, roundIndex, name } = played('survival-teams');
    const marked = markSurvivalMemberAbsent(state, roundIndex, 1, 0, 1);
    expect(shown(teamMemberLine(marked, name, roundIndex, null, { room: 1, position: 0 }))).toMatch(
      /^Ana\d+_· Ben\d+_absent$/,
    );
  });
});
