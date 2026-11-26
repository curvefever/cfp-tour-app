import { describe, expect, it } from 'vitest';
import { markOneScoreTeamMemberAbsent } from '../absences';
import { answerAbsence } from '../absence-answers';
import { ONE_SCORE_PER_TEAM } from '../formats';
import { swapIndividual } from '../mutations';
import { removeRosterUnit } from '../unit-removal';
import { playersWhoPlayed } from '../players-who-played';
import type { TournamentState, TournamentTeam } from '../types';
import { buildState, pressNextRound, scoreCurrentRound } from './play-through';
import { oneRoomState, teamOf } from './test-fixtures';

/** The score key of the unit's seat in the round in play. */
function seatKey(state: TournamentState, unit: string): string {
  const roundAssignments = state.assignments[state.curRound];
  const entry = roundAssignments.find((item) => item.name === unit);
  if (!entry || entry.room === null) throw new Error(`${unit} has no seat in round ${state.curRound + 1}`);
  const position = roundAssignments.filter((item) => item.room === entry.room).indexOf(entry);
  return `r${state.curRound}-rm${entry.room}-p${position}`;
}

/** The unit at a seat of the round in play. */
function unitAt(state: TournamentState, room: number, position: number): string {
  const found = state.assignments[state.curRound].filter((entry) => entry.room === room)[position];
  if (!found) throw new Error(`no seat ${position} in room ${room}`);
  return found.name;
}

/** Scores the round in play, then types a 0 for each given score key and answers it absent. */
function scoreWithAbsent(state: TournamentState, teamSize: number, keys: string[]): TournamentState {
  const scored = scoreCurrentRound(state, teamSize);
  const zeroed = {
    ...scored,
    scores: { ...scored.scores, ...Object.fromEntries(keys.map((key) => [key, 0])) },
  };
  return answerAbsence(zeroed, keys, 'absent');
}

/** A started tournament with absenceVersion 3 (the absentees' rules). */
function started(
  count: number,
  gameFormat: 'ffa-individual' | 'team-2v2v2v2',
  teams: boolean,
): TournamentState {
  const built = buildState({ label: gameFormat, count, setup: { gameFormat }, teams });
  if (!built) throw new Error('generation failed');
  return { ...built, gamemodeConfig: { ...built.gamemodeConfig, absenceVersion: 3 } };
}

describe('playersWhoPlayed, individual format', () => {
  it('lists 33 current players and the one removed after playing, not the 3 who never played nor the swapped-out one', () => {
    let state = started(37, 'ffa-individual', false);

    // Before round 1: the player of room 4's first seat is swapped out for a newcomer, so never plays.
    const swappedOut = unitAt(state, 4, 0);
    state = swapIndividual(state, swappedOut, 'Newcomer');
    expect(state.players).toContain('Newcomer');

    // Three players are absent in both rounds: still drawn into round 2, still on the roster.
    const neverPlayed = [1, 2, 3].map((room) => unitAt(state, room, 0));
    for (let round = 0; round < 2; round += 1) {
      const keys = neverPlayed.map((unit) => seatKey(state, unit));
      state = pressNextRound(scoreWithAbsent(state, 0, keys));
    }

    // One player who played is removed afterwards.
    const removed = unitAt(state, 1, 1);
    state = removeRosterUnit(state, removed);
    expect(state.withdrawnUnits.map((unit) => [unit.name, unit.playedAnyMatch])).toEqual([
      [swappedOut, false],
      [removed, true],
    ]);

    const list = playersWhoPlayed(state);
    expect(list).toHaveLength(37 - 3 - 1 + 1);
    expect(list).toContain(removed);
    expect(list).toContain('Newcomer');
    for (const name of [...neverPlayed, swappedOut]) expect(list).not.toContain(name);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual([...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it('lists nobody before a score is in', () => {
    expect(playersWhoPlayed(started(37, 'ffa-individual', false))).toEqual([]);
  });
});

describe('playersWhoPlayed, team formats', () => {
  it('lists members only: none of a team absent throughout, and not a member absent in every round, in 13 teams', () => {
    let state = started(13, 'team-2v2v2v2', true);
    const absentTeam = unitAt(state, 1, 0);
    const partialTeam = unitAt(state, 1, 1);
    for (let round = 0; round < 2; round += 1) {
      const whole = seatKey(state, absentTeam);
      const keys = [`${whole}-m0`, `${whole}-m1`, `${seatKey(state, partialTeam)}-m1`];
      state = pressNextRound(scoreWithAbsent(state, 2, keys));
    }

    const teams = state.players as TournamentTeam[];
    const namesOf = (teamId: string) =>
      (teams.find((team) => team.teamId === teamId)?.members ?? []).flatMap((member) =>
        member ? [member.name] : [],
      );
    const list = playersWhoPlayed(state);
    const [partialFirst, partialSecond] = namesOf(partialTeam);

    expect(list).toHaveLength(13 * 2 - 2 - 1);
    expect(list).toContain(partialFirst);
    expect(list).not.toContain(partialSecond);
    for (const name of namesOf(absentTeam)) expect(list).not.toContain(name);
    for (const team of teams) expect(list).not.toContain(team.teamName);
  });

  it('One score per team: a member marked absent by hand is left out, and a team that did not score is not listed', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      rule: ONE_SCORE_PER_TEAM,
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd']), teamOf('Gold', ['e', 'f'])],
      scores: { 'r0-rm1-p0': 60, 'r0-rm1-p1': 50 },
    });
    const marked = markOneScoreTeamMemberAbsent(base, 0, 1, 0, 1);
    expect(playersWhoPlayed(marked)).toEqual(['a', 'c', 'd']);
  });

  it('a team removed after a room round keeps its present member and not the absent one, in 13 teams', () => {
    let state = started(13, 'team-2v2v2v2', true);
    const team = unitAt(state, 1, 0);
    const [present, absent] = (
      (state.players as TournamentTeam[]).find((entry) => entry.teamId === team)?.members ?? []
    ).map((member) => member?.name ?? '');
    // Round 1: the team plays with its second member absent. Round 2 is drawn, then the team is removed.
    state = pressNextRound(scoreWithAbsent(state, 2, [`${seatKey(state, team)}-m1`]));
    const removed = removeRosterUnit(state, team);

    expect(removed.withdrawnUnits).toMatchObject([{ name: team, playedAnyMatch: true }]);
    const list = playersWhoPlayed(removed);
    expect(list).toContain(present);
    expect(list).not.toContain(absent);
    expect(list).toHaveLength(13 * 2 - 1);
  });

  it('a team that played the Final lists every member, and so does one removed after playing it', () => {
    const base = oneRoomState({
      gameFormat: 'team-2v2v2v2',
      players: [teamOf('Red', ['a', 'b']), teamOf('Blue', ['c', 'd'])],
      rounds: [{}, { isFinal: true }],
      scores: { 'r0-rm1-p0-m0': 40, 'r0-rm1-p0-m1': 0, 'r0-rm1-p1-m0': 30, 'r0-rm1-p1-m1': 20 },
    });
    const afterRound1 = answerAbsence(base, ['r0-rm1-p0-m1'], 'absent');
    const final = {
      ...afterRound1,
      assignments: [afterRound1.assignments[0], [{ name: 'Red', room: null, isLucky: false }]],
      finalScores: { 'game1-Red-m0': 10, 'game1-Red-m1': 12 },
    };
    // Round 1 alone leaves b out; the Final brings Red's whole line-up in.
    expect(playersWhoPlayed(afterRound1)).toEqual(['a', 'c', 'd']);
    expect(playersWhoPlayed(final)).toEqual(['a', 'b', 'c', 'd']);
    const removed = removeRosterUnit(final, 'Red');
    expect(removed.withdrawnUnits[0]).toMatchObject({ name: 'Red', playedAnyMatch: true });
    expect(playersWhoPlayed(removed)).toEqual(['a', 'b', 'c', 'd']);
  });
});
