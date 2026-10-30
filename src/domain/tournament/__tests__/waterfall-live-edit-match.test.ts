import { describe, expect, it } from 'vitest';
import { answerAbsence, markSurvivalMemberAbsent, survivalMemberKey } from '../absences';
import { roomFinishOrder } from '../advancement';
import { generateTournament } from '../generation';
import { roomMatch } from '../match-format';
import { isFinalComplete } from '../rankings';
import { createTournamentRuntime } from '../runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState, TournamentTeam } from '../types';
import { applyWaterfallGraphEdit } from '../waterfall-live-edit';
import { scoreCurrentRound } from './play-through';

const ROUNDS = (r1: string, final: string) =>
  `ROUNDS:\nR1 = 2x2${r1}\nFinal = 2 FINAL${final}\nROUTES:\nR1.A: 1->Final\nR1.B: 1->Final`;

function teams(): TournamentTeam[] {
  return Array.from({ length: 4 }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

/** 4 teams, one score per team (or sum of members), no pooling: the two warm-up rounds are played, so R1 (round 2) is in play. */
function inR1(
  r1 = '',
  final = '',
  rule: 'survival-teams' | 'sum-members' = 'survival-teams',
): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 4, players: teams(), title: 'Live edit' }),
    createDefaultSetup({
      gameFormat: 'team-2v2',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'none',
      teamScoringRule: rule,
      finalsGames: '3',
      waterfallGraph: ROUNDS(r1, final),
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error('generation failed');
  let state: TournamentState = { ...result.state, started: true };
  while (state.rounds[state.curRound].customLabel !== 'R1') {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, rule === 'survival-teams' ? 0 : 2));
    if (advanced.status !== 'advanced') throw new Error(`could not reach R1: ${advanced.status}`);
    state = advanced.state;
  }
  return state;
}

function edit(state: TournamentState, r1: string, final: string): TournamentState {
  const result = applyWaterfallGraphEdit(state, ROUNDS(r1, final));
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function refusal(state: TournamentState, r1: string, final: string): string {
  const result = applyWaterfallGraphEdit(state, ROUNDS(r1, final));
  if (result.ok) throw new Error('expected a refusal');
  return result.error;
}

const R1 = 2;
const withScores = (state: TournamentState, scores: Record<string, number>): TournamentState => ({
  ...state,
  scores: { ...state.scores, ...scores },
});

describe('changing the match format of the round in play', () => {
  it('moves a one-game round to Best of 3: the typed scores become game 1, the room is read again', () => {
    const state = withScores(inR1(), { 'r2-rm1-p0': 30, 'r2-rm1-p1': 10 });
    const next = edit(state, ' BO3', '');
    expect(next.rounds[R1]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(next.scores['r2-rm1-p0-g1']).toBe(30);
    expect(next.scores['r2-rm1-p1-g1']).toBe(10);
    expect(next.scores['r2-rm1-p0']).toBeUndefined();
    expect(roomMatch(next, R1, 1)).toMatchObject({ countedGames: 1, complete: false });
  });

  it('lets a decided room advance after the change', () => {
    let state = edit(withScores(inR1(), { 'r2-rm1-p0': 30, 'r2-rm1-p1': 10 }), ' BO3', '');
    state = withScores(state, {
      'r2-rm1-p0-g2': 25,
      'r2-rm1-p1-g2': 5,
      'r2-rm2-p0-g1': 30,
      'r2-rm2-p1-g1': 10,
      'r2-rm2-p0-g2': 25,
      'r2-rm2-p1-g2': 5,
    });
    expect(roomMatch(state, R1, 1)).toMatchObject({ decidingGame: 2, complete: true });
    const advanced = advanceTournamentRound(state);
    expect(advanced.status).toBe('advanced');
  });

  it('keeps the keys of a round that stays on several games, and reads them by the new rule', () => {
    const scores = {
      'r2-rm1-p0-g1': 900,
      'r2-rm1-p1-g1': 1,
      'r2-rm1-p0-g2': 1,
      'r2-rm1-p1-g2': 100,
      'r2-rm1-p0-g3': 1,
      'r2-rm1-p1-g3': 100,
    };
    const bestOf = withScores(inR1(' BO3'), scores);
    // B wins 2-1 on wins, A has the larger total.
    const [first, second] = bestOf.assignments[R1].filter((entry) => entry.room === 1).map(
      (entry) => entry.name,
    );
    expect(roomFinishOrder(bestOf, R1, 1)).toEqual([second, first]);
    expect(roomFinishOrder(edit(bestOf, ' GAMES 3', ''), R1, 1)).toEqual([first, second]);
    expect(Object.keys(edit(bestOf, ' GAMES 3', '').scores).filter((key) => key.startsWith('r2-'))).toEqual(
      Object.keys(scores),
    );
  });

  it('moves a Best of 3 back to one game when only game 1 is typed, and refuses it with a game 2 in', () => {
    const onlyFirst = withScores(inR1(' BO3'), { 'r2-rm1-p0-g1': 30, 'r2-rm1-p1-g1': 10 });
    const back = edit(onlyFirst, '', '');
    expect(back.scores['r2-rm1-p0']).toBe(30);
    expect(back.scores['r2-rm1-p0-g1']).toBeUndefined();
    expect(back.rounds[R1].numGames).toBeUndefined();
    expect(back.rounds[R1].bestOf).toBeUndefined();
    const second = withScores(onlyFirst, { 'r2-rm1-p0-g2': 5 });
    expect(refusal(second, '', '')).toBe(
      'Can\'t save: "R1" already has scores for game 2, so it can\'t be played over 1 game.',
    );
  });

  it('refuses fewer games than the highest game typed, naming the round and the game', () => {
    const state = withScores(inR1(' GAMES 4'), { 'r2-rm1-p0-g3': 5, 'r2-rm1-p1-g3': 6 });
    expect(refusal(state, ' GAMES 2', '')).toBe(
      'Can\'t save: "R1" already has scores for game 3, so it can\'t be played over 2 games.',
    );
    expect(edit(state, ' GAMES 3', '').rounds[R1].numGames).toBe(3);
  });

  it('moves an absence answer with its score key', () => {
    const typed = withScores(inR1(), { 'r2-rm1-p0': 30, 'r2-rm1-p1': 0 });
    const answered = answerAbsence(typed, ['r2-rm1-p1'], 'absent');
    expect(answered.absences['r2-rm1-p1']).toBe('absent');
    const next = edit(answered, ' BO3', '');
    expect(next.absences['r2-rm1-p1-g1']).toBe('absent');
    expect(next.absences['r2-rm1-p1']).toBeUndefined();
    const back = edit(next, '', '');
    expect(back.absences['r2-rm1-p1']).toBe('absent');
  });

  it("leaves a Survival member's mark where it is, since that key is round-wide", () => {
    const state = markSurvivalMemberAbsent(inR1(), R1, 1, 0, 1);
    const key = survivalMemberKey(R1, 1, 0, 1);
    expect(state.absences[key]).toBe('absent');
    expect(edit(state, ' BO3', '').absences[key]).toBe('absent');
  });

  it('moves every member key of a sum-of-members round', () => {
    const state = withScores(inR1('', '', 'sum-members'), {
      'r2-rm1-p0-m0': 10,
      'r2-rm1-p0-m1': 5,
      'r2-rm1-p1-m0': 3,
      'r2-rm1-p1-m1': 2,
    });
    const next = edit(state, ' BO3', '');
    expect(next.scores['r2-rm1-p0-g1-m0']).toBe(10);
    expect(next.scores['r2-rm1-p1-g1-m1']).toBe(2);
    expect(next.scores['r2-rm1-p0-m0']).toBeUndefined();
  });

  it('checks the room again for tie decisions: a resolution that no longer matches is dropped', () => {
    const tied = withScores(inR1(), { 'r2-rm1-p0': 20, 'r2-rm1-p1': 20 });
    const resolved = { ...tied, tieResolutions: { 'r2-rm1-s20': ['t1'] } };
    const next = edit(resolved, ' BO3', '');
    expect(next.tieResolutions).toEqual({});
  });
});

describe('changing the match format of the Final', () => {
  function inFinal(finalScores: Record<string, number>): TournamentState {
    const state = withScores(inR1(), {
      'r2-rm1-p0': 30,
      'r2-rm1-p1': 10,
      'r2-rm2-p0': 30,
      'r2-rm2-p1': 10,
    });
    const advanced = advanceTournamentRound(state);
    if (advanced.status !== 'advanced') throw new Error('could not reach the Final');
    const finalists = advanced.state.assignments[advanced.state.curRound].map((entry) => entry.name);
    const scores = Object.fromEntries(
      Object.entries(finalScores).map(([key, score]) => {
        const [game, seat] = key.split('/');
        return [`game${game}-${finalists[Number(seat)]}`, score];
      }),
    );
    return { ...advanced.state, finalScores: scores };
  }

  it('reads three summed games as a Best of 3: complete at 2-0, game 3 left out', () => {
    const state = inFinal({ '1/0': 20, '1/1': 10, '2/0': 20, '2/1': 10 });
    expect(isFinalComplete(state)).toBe(false);
    const next = edit(state, '', ' BO3');
    expect(next.rounds[next.curRound]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(isFinalComplete(next)).toBe(true);
  });

  it('refuses a Best of 3 Final cut to 2 games with game 3 typed, and a one-game Final with game 2 typed', () => {
    const state = inFinal({ '1/0': 20, '1/1': 10, '2/0': 20, '2/1': 10, '3/0': 1, '3/1': 2 });
    expect(refusal(state, '', ' GAMES 2')).toContain('already has scores for game 3');
    const two = inFinal({ '1/0': 20, '1/1': 10, '2/0': 20, '2/1': 10 });
    expect(refusal(two, '', ' GAMES 1')).toContain('already has scores for game 2');
  });
});

describe('who may change a match format', () => {
  it('lets a round that has not been reached take any format', () => {
    const next = edit(inR1(), '', ' BO5');
    const final = next.rounds.find((round) => round.isFinal);
    expect(final).toMatchObject({ bestOf: 5, numGames: 5 });
    expect(edit(next, '', '').rounds.find((round) => round.isFinal)).toMatchObject({ numGames: 3 });
  });

  it('refuses a round of a column that is finished', () => {
    const state = withScores(inR1(), { 'r2-rm1-p0': 30, 'r2-rm1-p1': 10, 'r2-rm2-p0': 30, 'r2-rm2-p1': 10 });
    const advanced = advanceTournamentRound(state);
    if (advanced.status !== 'advanced') throw new Error('could not advance');
    expect(refusal(advanced.state, ' BO3', '')).toBe(
      'Can\'t save: "R1" is finished, so its match format can\'t change.',
    );
    expect(applyWaterfallGraphEdit(advanced.state, ROUNDS('', '')).ok).toBe(true);
  });
});
