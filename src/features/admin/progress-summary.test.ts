import { describe, expect, it } from 'vitest';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentRound, TournamentState } from '../../domain/tournament/types';
import { liveTournament } from '../../domain/tournament/__tests__/qual-waterfall';
import { progressSummary } from './progress-summary';

function ffa37(): TournamentState {
  const state = buildState({
    label: 'ffa-37',
    count: 37,
    setup: { poolingPhase: 'qual-table', qualAdv: '24', scheduleLogic: 'single-elimination' },
    teams: false,
  });
  if (!state) throw new Error('the 37-player tournament was not generated');
  return state;
}

/** Scores and advances whole rounds until the current round matches `stop`; that round is left unscored. */
function playUntil(start: TournamentState, stop: (round: TournamentRound) => boolean): TournamentState {
  let state = start;
  for (let guard = 0; guard < 40 && !stop(state.rounds[state.curRound]); guard += 1) {
    const result = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (result.status !== 'advanced') throw new Error(`could not advance round ${state.curRound}`);
    state = result.state;
  }
  return state;
}

function withoutRoom(state: TournamentState, room: number): TournamentState {
  const prefix = `r${state.curRound}-rm${room}-`;
  const scores = Object.fromEntries(Object.entries(state.scores).filter(([key]) => !key.startsWith(prefix)));
  return { ...state, scores };
}

function scoreFinalPlayers(state: TournamentState, count: number): TournamentState {
  const round = state.rounds[state.curRound];
  const finalScores = { ...state.finalScores };
  state.assignments[state.curRound].slice(0, count).forEach((entry, index) => {
    for (let game = 1; game <= (round.numGames ?? 1); game += 1) {
      finalScores[`game${game}-${entry.name}`] = 100 - index;
    }
  });
  return { ...state, finalScores };
}

describe('progressSummary', () => {
  it('starts a qualification table with nothing scored: the first round is now, the rest upcoming', () => {
    const summary = progressSummary(ffa37());
    expect(summary.text).toBe('Round 1 · 0 of 5 rooms scored');
    expect(summary.fraction).toBe(0);
    expect(summary.stages[0]).toEqual({ name: 'Round 1', state: 'now' });
    expect(summary.stages[1]).toEqual({ name: 'Round 2', state: 'upcoming' });
    expect(summary.rooms.map((room) => room.name)).toEqual([
      'Room A',
      'Room B',
      'Room C',
      'Room D',
      'Room E',
    ]);
    expect(summary.rooms.map((room) => room.players)).toEqual([8, 8, 7, 7, 7]);
  });

  it('says every room is scored once they all are, while the round is still the current one', () => {
    const summary = progressSummary(scoreCurrentRound(ffa37(), 0));
    expect(summary.text).toBe('Round 1 · all 5 rooms scored');
    expect(summary.fraction).toBe(1);
    expect(summary.rooms.every((room) => room.hasScores)).toBe(true);
  });

  it('counts the rooms scored in a bracket round with one room still to score, and marks the earlier rounds done', () => {
    const bracket = playUntil(ffa37(), (round) => !round.isQual && !round.isNoElim);
    const rooms = bracket.rounds[bracket.curRound].rooms.length;
    expect(rooms).toBeGreaterThan(1);
    const summary = progressSummary(withoutRoom(scoreCurrentRound(bracket, 0), rooms));
    expect(summary.text).toBe(`${summary.roundName} · ${rooms - 1} of ${rooms} rooms scored`);
    expect(summary.fraction).toBeCloseTo((rooms - 1) / rooms);
    expect(summary.stages[bracket.curRound].state).toBe('now');
    expect(summary.stages.slice(0, bracket.curRound).every((stage) => stage.state === 'done')).toBe(true);
    expect(summary.rooms.at(-1)).toMatchObject({ scored: 0, hasScores: false });
    expect(summary.rooms[0]).toMatchObject({ hasScores: true });
  });

  it('does not count a partly scored room as scored, and shows its scores in', () => {
    const bracket = playUntil(ffa37(), (round) => !round.isQual && !round.isNoElim);
    const rooms = bracket.rounds[bracket.curRound].rooms.length;
    const scored = scoreCurrentRound(bracket, 0);
    // Room B keeps its first five of eight scores.
    const scores = Object.fromEntries(
      Object.entries(scored.scores).filter(([key]) => {
        const prefix = `r${bracket.curRound}-rm2-p`;
        return !key.startsWith(prefix) || Number(key.slice(prefix.length)) < 5;
      }),
    );
    const summary = progressSummary(withoutRoom({ ...scored, scores }, rooms));
    expect(summary.text).toBe(`${summary.roundName} · 1 of ${rooms} rooms scored`);
    expect(summary.rooms[1]).toMatchObject({ name: 'Room B', players: 8, scored: 5, hasScores: true });
    expect(summary.fraction).toBeCloseTo(1 / rooms);
  });

  it('counts the scores in of the Final, a single room', () => {
    const final = playUntil(ffa37(), (round) => round.isFinal);
    expect(progressSummary(final).text).toBe('Final · 0 of 8 scores in');
    const partly = progressSummary(scoreFinalPlayers(final, 5));
    expect(partly.text).toBe('Final · 5 of 8 scores in');
    expect(partly.fraction).toBeCloseTo(5 / 8);
    expect(partly.rooms).toHaveLength(1);
    expect(partly.stages.at(-1)?.state).toBe('now');
  });

  it('reports a tournament whose Final is fully scored as complete, every stage done', () => {
    const final = playUntil(ffa37(), (round) => round.isFinal);
    const summary = progressSummary(scoreFinalPlayers(final, 8));
    expect(summary.text).toBe('Final · complete');
    expect(summary.fraction).toBe(1);
    expect(summary.stages.every((stage) => stage.state === 'done')).toBe(true);
  });
});

describe('progressSummary -- a waterfall column of two rounds', () => {
  function inBracket(): TournamentState {
    let state = liveTournament(19);
    for (let guard = 0; guard < 20 && !state.rounds[state.curRound].isWaterfall; guard += 1) {
      const result = advanceTournamentRound(scoreCurrentRound(state, 2));
      if (result.status !== 'advanced') throw new Error('could not advance');
      state = result.state;
    }
    return state;
  }

  it('names the column by its rounds, lists every room under its round, and marks both rounds as now', () => {
    const start = inBracket();
    const summary = progressSummary(start);
    expect(summary.roundName).toBe('Round 5 Upper + Round 5 Lower');
    expect(summary.text).toBe('Round 5 Upper + Round 5 Lower · 0 of 4 rooms scored');
    expect(summary.rooms.map((room) => room.name)).toEqual([
      'Round 5 Upper · Room A',
      'Round 5 Upper · Room B',
      'Round 5 Lower · Room A',
      'Round 5 Lower · Room B',
    ]);
    const now = summary.stages.filter((stage) => stage.state === 'now').map((stage) => stage.name);
    expect(now).toEqual(['Round 5 Upper', 'Round 5 Lower']);
    expect(summary.stages.find((stage) => stage.name === 'Semi A')?.state).toBe('upcoming');
  });

  it('counts a room scored in the second round', () => {
    const start = inBracket();
    const lower = start.curRound + 1;
    const scored = { ...scoreCurrentRound({ ...start, curRound: lower }, 2), curRound: start.curRound };
    expect(progressSummary(scored).text).toBe('Round 5 Upper + Round 5 Lower · 2 of 4 rooms scored');
  });
});
