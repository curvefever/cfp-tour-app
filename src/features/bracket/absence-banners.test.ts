import { describe, expect, it } from 'vitest';
import { answerAbsence, clearAbsenceAnswer } from '../../domain/tournament/absences';
import { generate, playedRound } from '../../domain/tournament/__tests__/fair-cut-fixtures';
import { oneRoomState, teamOf } from '../../domain/tournament/__tests__/test-fixtures';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { absenceBannerRows } from './absence-banners';
import { ONE_SCORE_PER_TEAM } from '../../domain/tournament/formats';

const zeros = (...positions: number[]) =>
  Object.fromEntries(positions.map((position) => [`r0-rm1-p${position}`, 0]));

const six = ['Ann', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];

describe('absenceBannerRows', () => {
  it('names a single zero and offers absent and played', () => {
    const state = oneRoomState({ players: six, scores: { ...zeros(2), 'r0-rm1-p0': 80 } });
    const [row] = absenceBannerRows(state);
    expect(row.heading).toBe('⚠ Score of 0 — Round 1 · Room A (1 at 0)');
    expect(row.detail).toBe('Carol scored 0 — pick who was absent; the others played');
    expect(row.buttons.map((button) => button.label)).toEqual(['Carol absent', 'Carol played']);
    expect(row.tone).toBe('danger');
  });

  it('offers a button per unit and "Both" shortcuts for two zeros', () => {
    const [row] = absenceBannerRows(oneRoomState({ players: six, scores: zeros(2, 3) }));
    expect(row.heading).toBe('⚠ Score of 0 — Round 1 · Room A (2 at 0)');
    expect(row.buttons.map((button) => button.label)).toEqual([
      'Carol absent',
      'Dave absent',
      'Both absent',
      'Both played',
    ]);
  });

  it('offers "All 4" shortcuts for four zeros, each answering every key', () => {
    const [row] = absenceBannerRows(oneRoomState({ players: six, scores: zeros(2, 3, 4, 5) }));
    expect(row.heading).toBe('⚠ Score of 0 — Round 1 · Room A (4 at 0)');
    expect(row.detail).toBe('Carol, Dave, Eve, Frank scored 0 — pick who was absent; the others played');
    expect(row.buttons.map((button) => button.label)).toEqual([
      'Carol absent',
      'Dave absent',
      'Eve absent',
      'Frank absent',
      'All 4 absent',
      'All 4 played',
    ]);
    const allPlayed = row.buttons.at(-1);
    expect(allPlayed).toMatchObject({ answer: 'played', keys: Object.keys(zeros(2, 3, 4, 5)) });
  });

  it('counts what is left and lists the answers once some are given', () => {
    const state = answerAbsence(
      oneRoomState({ players: six, scores: zeros(2, 3, 4, 5) }),
      ['r0-rm1-p3', 'r0-rm1-p4'],
      'absent',
    );
    const [row] = absenceBannerRows(state);
    expect(row.heading).toBe('⚠ Score of 0 — Round 1 · Room A (2 left)');
    expect(row.detail).toBe('Absent: Dave, Eve — still to answer: Carol, Frank');
    expect(row.buttons.map((button) => button.label)).toEqual([
      'Carol absent',
      'Frank absent',
      'Both absent',
      'Both played',
    ]);
  });

  it('has no bar once every zero is answered, nor without a zero', () => {
    const all = answerAbsence(oneRoomState({ players: six, scores: zeros(2) }), ['r0-rm1-p2'], 'played');
    expect(absenceBannerRows(all)).toEqual([]);
    expect(absenceBannerRows(oneRoomState({ players: six, scores: { 'r0-rm1-p0': 50 } }))).toEqual([]);
  });

  it('labels members "Alice (Red)" in a sum-of-members room', () => {
    const state = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'sum-members',
      players: [teamOf('Red', ['Alice', 'Bea']), teamOf('Blue', ['Cy', 'Di'])],
      scores: { 'r0-rm1-p0-m0': 0, 'r0-rm1-p0-m1': 60, 'r0-rm1-p1-m0': 40, 'r0-rm1-p1-m1': 40 },
    });
    expect(absenceBannerRows(state)[0].buttons.map((button) => button.label)).toEqual([
      'Alice (Red) absent',
      'Alice (Red) played',
    ]);
  });

  it('is a warning in One score per team and says an unanswered zero counts as played', () => {
    const state = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 50 },
    });
    const [row] = absenceBannerRows(state);
    expect(row.tone).toBe('warning');
    expect(row.detail).toBe(
      'Red scored 0 — pick who was absent; the others played — counted as played unless marked',
    );
    const answered = absenceBannerRows(
      answerAbsence(
        oneRoomState({
          gameFormat: 'team-2v2v2v2',
          rule: ONE_SCORE_PER_TEAM,
          players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd']), teamOf('Green', ['e', 'f'])],
          scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 50 },
        }),
        ['r0-rm1-p0'],
        'absent',
      ),
    );
    expect(answered[0].detail).toBe('Absent: Red — still to answer: Blue — counted as played unless marked');
  });

  it('tags a game in a Semis room', () => {
    const state = oneRoomState({
      rounds: [{ isSemis: true, numGames: 2 }, {}],
      scores: { 'r0-rm1-p0-g1': 0, 'r0-rm1-p1-g1': 70 },
    });
    expect(absenceBannerRows(state)[0].buttons[0].label).toBe('Ann · game 1 absent');
  });

  it('names each round of a column of several rounds', () => {
    const state = oneRoomState({
      rounds: [{ waterfallColumn: 1 }, { waterfallColumn: 1 }],
      scores: { ...zeros(1), 'r1-rm1-p2': 0 },
    });
    const labels = bracketRoundLabels(state);
    expect(absenceBannerRows(state).map((row) => row.heading)).toEqual([
      `⚠ Score of 0 — ${labels[0].label} · Room A (1 at 0)`,
      `⚠ Score of 0 — ${labels[1].label} · Room A (1 at 0)`,
    ]);
  });

  it('names a losers round by its column in a double elimination, not by its stored number', () => {
    const start = generate('DE 37', 37, {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
    });
    const labels = bracketRoundLabels(start);
    const byColumn = start.rounds.findIndex(
      (round, index) => round.bracket === 'losers' && labels[index].label !== `LB Round ${round.roundNum}`,
    );
    expect(byColumn).toBeGreaterThan(-1);
    const played = clearAbsenceAnswer(playedRound(start, byColumn, { 1: [7] }), `r${byColumn}-rm1-p7`);
    expect(absenceBannerRows(played)[0].heading).toBe(
      `⚠ Score of 0 — ${labels[byColumn].label} · Room A (1 at 0)`,
    );
  });
});
