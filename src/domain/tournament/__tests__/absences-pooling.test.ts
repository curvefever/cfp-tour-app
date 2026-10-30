import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../absences';
import {
  computeQualificationStandings,
  detectTieBreaks,
  isRoomFullyScored,
  presentUnitCount,
  relativeRoomShare,
  roomFinishOrder,
  roomPointsByPlace,
  scoreRoom,
} from '../advancement';
import { resolveTournamentTie } from '../mutations';
import { describeStandings } from '../standings-display';
import { smallerRoomSeatsBefore } from '../smaller-room-seats';
import { advanceTournamentRound } from '../transitions';
import type { TournamentState } from '../types';
import { scoreCurrentRound, withoutAbsenceRule } from './play-through';
import { generated, oneRoomState, teamOf } from './test-fixtures';
import { ONE_SCORE_PER_TEAM } from '../formats';

function roomKeys(state: TournamentState, room: number): string[] {
  const size = state.assignments[state.curRound].filter((entry) => entry.room === room).length;
  return Array.from({ length: size }, (_, position) => `r${state.curRound}-rm${room}-p${position}`);
}

/** Types 0 for the last `count` seats of a room and answers them absent. */
function absentLastSeats(state: TournamentState, room: number, count: number): TournamentState {
  const keys = roomKeys(state, room).slice(-count);
  const scores = { ...state.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) };
  return answerAbsence({ ...state, scores }, keys, 'absent');
}

function names(state: TournamentState, room: number): string[] {
  return state.assignments[state.curRound].filter((entry) => entry.room === room).map((entry) => entry.name);
}

function shares(state: TournamentState): number[] {
  const scored = scoreRoom(state, 0, 1, null);
  return scored.map((entry) => relativeRoomShare(entry.score, scored, entry.players));
}

const SUM_TEAMS = { gameFormat: 'team-2v2v2v2', rule: 'sum-members' } as const;

function fourTeams(lastTeam: ReturnType<typeof teamOf>, version = true) {
  return oneRoomState({
    ...SUM_TEAMS,
    version,
    players: [teamOf('A', ['a1', 'a2']), teamOf('B', ['b1', 'b2']), teamOf('C', ['c1', 'c2']), lastTeam],
    scores: {
      'r0-rm1-p0-m0': 100,
      'r0-rm1-p0-m1': 100,
      'r0-rm1-p1-m0': 90,
      'r0-rm1-p1-m1': 90,
      'r0-rm1-p2-m0': 75,
      'r0-rm1-p2-m1': 75,
      'r0-rm1-p3-m0': 70,
      'r0-rm1-p3-m1': 0,
    },
  });
}

describe('37 FFA, rooms 8·8·7·7·7: absentees in a pooling round', () => {
  const started = (): TournamentState => {
    const state = { ...generated(37, { poolingPhase: 'qual-table', qualAdv: '24' }), started: true };
    expect(state.rounds[0].rooms).toEqual([8, 8, 7, 7, 7]);
    return state;
  };
  const played = (): TournamentState => {
    let state = scoreCurrentRound(started(), 0);
    state = absentLastSeats(state, 1, 3);
    return absentLastSeats(state, 3, 1);
  };

  it('reads the table at the present size, and gives the absentees a missed round', () => {
    const state = played();
    const standings = computeQualificationStandings(state);
    const row = (name: string) => standings.find((entry) => entry.name === name);

    expect(presentUnitCount(state, 0, 1)).toBe(5);
    expect(presentUnitCount(state, 0, 3)).toBe(6);
    const roomA = names(state, 1);
    const fivePoints = roomPointsByPlace(state, 5);
    const sixPoints = roomPointsByPlace(state, 6);
    expect(roomA.slice(0, 5).map((name) => row(name)?.totalFP)).toEqual(fivePoints);
    const roomC = names(state, 3);
    expect(roomC.slice(0, 6).map((name) => row(name)?.totalFP)).toEqual(sixPoints);
    for (const name of [...roomA.slice(5), roomC[6]]) {
      expect(row(name)?.rounds).toEqual([]);
      expect(row(name)?.roomShare).toBeNull();
      expect(row(name)?.totalFP ?? 0).toBe(0);
    }
    const room1 = scoreRoom(state, 0, 1, null);
    expect(room1.map((entry) => entry.name)).toEqual(roomA.slice(0, 5));
  });

  it('draws the absentees into Round 2: nobody is cut in a warm-up of the qualification table', () => {
    const state = played();
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    const drawn = result.state.assignments[1].map((entry) => entry.name).sort();
    expect(drawn).toEqual([...state.assignments[0].map((entry) => entry.name)].sort());
  });

  it('counts a smaller-room seat for each present unit of the short room, and none for the absentees', () => {
    const state = played();
    const result = advanceTournamentRound(state);
    if (result.status !== 'advanced') throw new Error('did not advance');
    const tally = smallerRoomSeatsBefore(result.state, 1);
    const roomA = names(state, 1);
    for (const name of roomA.slice(0, 5)) expect(tally[name]).toBe(1);
    for (const name of roomA.slice(5)) expect(tally[name]).toBeUndefined();
    const roomC = names(state, 3);
    expect(roomC.slice(0, 6).map((name) => tally[name])).toEqual([1, 1, 1, 1, 1, 1]);
    expect(tally[roomC[6]]).toBeUndefined();
  });

  it('marks the absentees’ rounds in the standings display, for the ABS cell', () => {
    const state = played();
    const table = describeStandings(state)?.tables[0];
    const roomA = names(state, 1);
    const absentRounds = (name: string) => table?.entries.find((entry) => entry.name === name)?.absentRounds;
    expect(absentRounds(roomA[7])).toEqual([0]);
    expect(absentRounds(roomA[0])).toBeUndefined();
  });

  it('puts the absentees after the present units in the room finish order', () => {
    const state = played();
    const roomA = names(state, 1);
    const order = roomFinishOrder(state, 0, 1);
    expect(order).toHaveLength(8);
    expect(order.slice(5).sort()).toEqual(roomA.slice(5).sort());
  });

  it('does not change a room with no absentee, with or without absenceVersion', () => {
    const full = scoreCurrentRound(started(), 0);
    expect(computeQualificationStandings(full)).toEqual(
      computeQualificationStandings(withoutAbsenceRule(full)),
    );
    const withVersion = advanceTournamentRound(full);
    const without = advanceTournamentRound(withoutAbsenceRule(full));
    if (withVersion.status !== 'advanced' || without.status !== 'advanced')
      throw new Error('did not advance');
    expect(withVersion.state.assignments).toEqual(without.state.assignments);
  });
});

describe('43 FFA: a room with one present unit, and a room with none', () => {
  it('credits the lone present unit a win and gives the all-absent room no win at all', () => {
    let state = { ...generated(43, { poolingPhase: 'qual-table', qualAdv: '24' }), started: true };
    state = scoreCurrentRound(state, 0);
    state = absentLastSeats(state, 1, names(state, 1).length - 1);
    state = absentLastSeats(state, 2, names(state, 2).length);
    const standings = computeQualificationStandings(state);
    const row = (name: string) => standings.find((entry) => entry.name === name);

    const [winner, ...absentees] = names(state, 1);
    expect(row(winner)?.rounds).toMatchObject([{ bye: true, score: null, rank: null }]);
    expect(row(winner)?.roomShare).toBeNull();
    expect(row(winner)?.totalFP).toBe(roomPointsByPlace(state, 1)[0]);
    for (const name of absentees) expect(row(name)?.rounds).toEqual([]);
    for (const name of names(state, 2)) expect(row(name)?.rounds).toEqual([]);
    expect(isRoomFullyScored(state, 0, 2)).toBe(true);
  });
});

describe('relative score per player in a sum-of-members room', () => {
  it('measures a team playing short against the room average per player', () => {
    const state = answerAbsence(fourTeams(teamOf('D', ['d1', 'd2'])), ['r0-rm1-p3-m1'], 'absent');
    const [a, b, c, d] = shares(state);
    expect([a, b, c, d].map((share) => Number(share.toFixed(4)))).toEqual([1.1667, 1.05, 0.875, 0.8167]);
    expect(scoreRoom(state, 0, 1, null).map((entry) => entry.players)).toEqual([2, 2, 2, 1]);
  });

  it('gives a vacant slot the numbers an absent member gives', () => {
    const vacant = fourTeams(teamOf('D', ['d1', null]));
    expect(shares(vacant).map((share) => Number(share.toFixed(4)))).toEqual([1.1667, 1.05, 0.875, 0.8167]);
  });

  it('keeps today’s numbers without absenceVersion, vacant slot and absent member alike', () => {
    const vacant = fourTeams(teamOf('D', ['d1', null]), false);
    const today = [1.3333, 1.2, 1.0, 0.4667];
    expect(shares(vacant).map((share) => Number(share.toFixed(4)))).toEqual([1.3333, 1.2, 1, 0.4667]);
    const marked = answerAbsence(fourTeams(teamOf('D', ['d1', 'd2']), false), ['r0-rm1-p3-m1'], 'absent');
    expect(shares(marked).map((share) => Number(share.toFixed(4)))).toEqual(
      today.map((x) => Number(x.toFixed(4))),
    );
  });

  it('gives full teams the same shares to the last digit with and without the version', () => {
    const full = fourTeams(teamOf('D', ['d1', 'd2']));
    const scores = { ...full.scores, 'r0-rm1-p3-m1': 20 };
    const withVersion = shares({ ...full, scores });
    const without = shares(withoutAbsenceRule({ ...full, scores }));
    expect(withVersion).toEqual(without);
  });

  it('leaves a team whose members are all absent out of the room, so no share divides by zero', () => {
    let state = fourTeams(teamOf('D', ['d1', 'd2']));
    state = answerAbsence(
      { ...state, scores: { ...state.scores, 'r0-rm1-p3-m0': 0 } },
      ['r0-rm1-p3-m0', 'r0-rm1-p3-m1'],
      'absent',
    );
    const scored = scoreRoom(state, 0, 1, null);
    expect(scored.map((entry) => entry.name)).toEqual(['A', 'B', 'C']);
    expect(shares(state).every(Number.isFinite)).toBe(true);
    expect(roomFinishOrder(state, 0, 1)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('gives everyone a share of 1 when every present unit scored 0', () => {
    const state = answerAbsence(
      answerAbsence(
        oneRoomState({ scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 0, 'r0-rm1-p3': 0 } }),
        ['r0-rm1-p0', 'r0-rm1-p1'],
        'absent',
      ),
      ['r0-rm1-p2', 'r0-rm1-p3'],
      'played',
    );
    expect(shares(state)).toEqual([1, 1]);
  });
});

describe('Save your Buddy', () => {
  it('scores the same when a non-defender is marked absent', () => {
    const before = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: 'designated-player',
      players: [teamOf('A', ['a1', 'a2']), teamOf('B', ['b1', 'b2'])],
      scores: { 'r0-rm1-p0-m0': 80, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 60, 'r0-rm1-p1-m1': 30 },
    });
    const after = answerAbsence(before, ['r0-rm1-p0-m1'], 'absent');
    expect(scoreRoom(after, 0, 1, null)).toEqual(scoreRoom(before, 0, 1, null));
    expect(scoreRoom(after, 0, 1, null).map((entry) => entry.players)).toEqual([1, 1]);
  });
});

describe('a tie at 0', () => {
  const zeros = () =>
    oneRoomState({ scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 50, 'r0-rm1-p3': 40 } });
  const ties = (state: TournamentState) => Object.keys(detectTieBreaks(0, state.rounds[0], state));

  it('waits for both answers before it shows', () => {
    expect(ties(zeros())).toEqual([]);
    expect(ties(answerAbsence(zeros(), ['r0-rm1-p0'], 'played'))).toEqual([]);
  });

  it('is no tie when one of the two was absent', () => {
    expect(ties(answerAbsence(zeros(), ['r0-rm1-p0', 'r0-rm1-p1'], 'absent'))).toEqual([]);
    const one = answerAbsence(answerAbsence(zeros(), ['r0-rm1-p0'], 'absent'), ['r0-rm1-p1'], 'played');
    expect(ties(one)).toEqual([]);
  });

  it('is a tie when both played', () => {
    expect(ties(answerAbsence(zeros(), ['r0-rm1-p0', 'r0-rm1-p1'], 'played'))).toEqual(['r0-rm1-s0']);
  });

  it('shows at once in a tournament without absenceVersion, and in One score per team', () => {
    const old = oneRoomState({
      version: false,
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 50, 'r0-rm1-p3': 40 },
    });
    expect(ties(old)).toEqual(['r0-rm1-s0']);
    const oneScorePerTeam = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      players: [teamOf('A', ['a1', 'a2']), teamOf('B', ['b1', 'b2']), teamOf('C', ['c1', 'c2'])],
      scores: { 'r0-rm1-p0': 0, 'r0-rm1-p1': 0, 'r0-rm1-p2': 50 },
    });
    expect(ties(oneScorePerTeam)).toEqual(['r0-rm1-s0']);
  });

  it('drops a decision made on a tie that an answer dissolves', () => {
    const tied = answerAbsence(zeros(), ['r0-rm1-p0', 'r0-rm1-p1'], 'played');
    const decided = resolveTournamentTie(tied, 'r0-rm1-s0', 'Ann');
    expect(decided.tieResolutions['r0-rm1-s0']).toBeDefined();
    const undone = answerAbsence({ ...decided, absences: {} }, ['r0-rm1-p0', 'r0-rm1-p1'], 'absent');
    expect(undone.tieResolutions).toEqual({});
  });
});
