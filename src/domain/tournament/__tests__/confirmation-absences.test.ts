import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import {
  clickConfirmation,
  confirmationSource,
  rosterConfirmationSummary,
  scoredPlayers,
  setConfirmed,
  teamConfirmation,
} from '../confirmations';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { markBack } from '../likely-absentees';
import type { TournamentState, TeamScoringRuleKey } from '../types';
import { oneRoomState, teamOf } from './test-fixtures';

const four = ['Ann', 'Bob', 'Cy', 'Di'];

function withVersion(state: TournamentState, version: 1 | 2 | 3 | undefined): TournamentState {
  const { absenceVersion: _removed, ...rest } = state.gamemodeConfig;
  return { ...state, gamemodeConfig: version === undefined ? rest : { ...rest, absenceVersion: version } };
}

/** Four players in one room for three rounds, version 3; the scores given. */
function individuals(scores: TournamentState['scores'], version: 1 | 2 | 3 | undefined = 3): TournamentState {
  return withVersion(oneRoomState({ players: four, rounds: [{}, {}, {}], scores }), version);
}

describe('the score tick of individuals', () => {
  it('a 0 answered "played" ticks, an unanswered 0 and a 0 answered absent do not', () => {
    const state = answerAbsence(
      individuals({ 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 0, 'r0-rm1-p3': 40 }),
      ['r0-rm1-p0'],
      'played',
    );
    const absent = answerAbsence(state, ['r0-rm1-p1'], 'absent');
    expect([...scoredPlayers(absent)].sort()).toEqual(['Ann', 'Di']);
  });

  it('a 0 never ticks in a tournament without absence questions', () => {
    const state = individuals({ 'r0-rm1-p0': 0, 'r0-rm1-p1': 30 }, undefined);
    expect([...scoredPlayers(state)]).toEqual(['Bob']);
  });
});

describe('the score tick of teams', () => {
  const teams = [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])];
  const teamState = (rule: TeamScoringRuleKey, scores: TournamentState['scores']) =>
    oneRoomState({ gameFormat: 'team-2v2v2v2', rule, players: teams, rounds: [{}, {}, {}], scores });

  it('One score per team: a team with a score ticks every member, and a 0 counts as played', () => {
    const state = teamState(ONE_SCORE_PER_TEAM, { 'r0-rm1-p0': 55, 'r0-rm1-p1': 0 });
    expect([...scoredPlayers(state)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...scoredPlayers(withVersion(state, undefined))].sort()).toEqual(['a', 'b']);
  });

  it('One score per team: a team marked absent ticks nobody', () => {
    const state = answerAbsence(
      teamState(ONE_SCORE_PER_TEAM, { 'r0-rm1-p0': 0, 'r0-rm1-p1': 55 }),
      ['r0-rm1-p0'],
      'absent',
    );
    expect([...scoredPlayers(state)].sort()).toEqual(['c', 'd']);
  });

  it('Save your Buddy: a score of any member ticks the whole team', () => {
    const state = teamState('designated-player', { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 12 });
    expect([...scoredPlayers(state)].sort()).toEqual(['a', 'b']);
  });

  it('sum of members: only the member who scored ticks', () => {
    const state = teamState('sum-members', { 'r0-rm1-p0-m0': 9, 'r0-rm1-p0-m1': 0 });
    expect([...scoredPlayers(state)]).toEqual(['a']);
  });
});

describe('a likely absentee reads "?" and a unit marked back reads ✓ (absenceVersion 3)', () => {
  /** Ann played round 1 and was absent from round 2 (in play), the others played both. */
  const annAbsentInRound2 = () =>
    answerAbsence(
      {
        ...individuals({
          'r0-rm1-p0': 50,
          'r0-rm1-p1': 40,
          'r1-rm1-p0': 0,
          'r1-rm1-p1': 45,
          'r1-rm1-p2': 35,
        }),
        curRound: 1,
      },
      ['r1-rm1-p0'],
      'absent',
    );

  it('is not confirmed whatever its mark or earlier scores say', () => {
    const state = setConfirmed(annAbsentInRound2(), 'Ann', true);
    expect(scoredPlayers(state).has('Ann')).toBe(true);
    expect(confirmationSource(state, 'Ann')).toBeNull();
    expect(confirmationSource(state, 'Bob')).toBe('score');
  });

  it('is confirmed again, as "back", once marked back, and a count includes it', () => {
    const state = markBack(annAbsentInRound2(), 'Ann');
    expect(confirmationSource(state, 'Ann')).toBe('back');
    expect(rosterConfirmationSummary(state).confirmed).toBe(3);
  });

  it('plays the next round: its score ticks it again', () => {
    const played = { ...annAbsentInRound2(), scores: { ...annAbsentInRound2().scores, 'r2-rm1-p0': 30 } };
    expect(confirmationSource(played, 'Ann')).toBe('score');
  });

  it('a version 2 tournament shows no "?": the marks follow scores and the organiser as before', () => {
    const state = withVersion(annAbsentInRound2(), 2);
    expect(confirmationSource(state, 'Ann')).toBe('score');
  });

  it('a click on the "?" marks it back and confirms it; a click on the ✓ takes the back mark away', () => {
    const back = clickConfirmation(annAbsentInRound2(), 'Ann');
    expect(back.backFromAbsence).toEqual({ Ann: 1 });
    expect(back.confirmations).toEqual({ Ann: true });
    expect(confirmationSource(back, 'Ann')).toBe('back');
    const undone = clickConfirmation(back, 'Ann');
    expect(undone.backFromAbsence).toEqual({});
    expect(confirmationSource(undone, 'Ann')).toBeNull();
  });

  it('any other click confirms or unconfirms by hand, as before', () => {
    const state = annAbsentInRound2();
    const marked = clickConfirmation(state, 'Cy');
    expect(marked.confirmations).toEqual({ Cy: true });
    expect(clickConfirmation(marked, 'Cy').confirmations).toEqual({});
  });
});

describe('a team absent from the round in play', () => {
  const base = oneRoomState({
    gameFormat: 'team-2v2v2v2',
    rule: 'sum-members',
    rounds: [{}, {}],
    players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
    scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 50, 'r0-rm1-p1-m1': 40 },
  });
  const absent = answerAbsence(withVersion(base, 3), ['r0-rm1-p0-m0', 'r0-rm1-p0-m1'], 'absent');
  const red = absent.players[0] as Exclude<(typeof absent.players)[number], string>;

  it('shows every member "?" and a red dot', () => {
    expect(['a', 'b'].map((name) => confirmationSource(absent, name))).toEqual([null, null]);
    expect(teamConfirmation(absent, red)).toEqual({ confirmed: 0, total: 2, level: 'none' });
  });

  it('is back as soon as one member is marked back: that member reads ✓, the team dot turns orange', () => {
    const back = clickConfirmation(absent, 'b');
    expect(['a', 'b'].map((name) => confirmationSource(back, name))).toEqual([null, 'back']);
    expect(teamConfirmation(back, red)).toEqual({ confirmed: 1, total: 2, level: 'some' });
  });
});
