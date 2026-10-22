import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { computeRankings } from '../../domain/tournament/rankings';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState, TournamentTeam, WithdrawnUnit } from '../../domain/tournament/types';
import { rankingsImageHeader } from './rankings-image-header';

const playersOf = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);

/** `count` players in one first round that is still in play. */
function inPlay(count: number, extra: Partial<TournamentState> = {}): TournamentState {
  const names = playersOf(count);
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: 0,
    rounds: [buildRound({ roundNum: 1, rooms: [count], players: count, advPerRoom: 4 })],
    assignments: [names.map((name) => ({ name, room: 1, isLucky: false }))],
    ...extra,
  });
}

/** `count` teams of three in one first round that is still in play. */
function teamsInPlay(count: number): TournamentState {
  const teams: TournamentTeam[] = Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: [{ name: `a${index}` }, { name: `b${index}` }, { name: `c${index}` }],
  }));
  return createDefaultTournamentState({
    gameFormat: 'team-3v3v3',
    players: teams,
    curRound: 0,
    rounds: [buildRound({ roundNum: 1, rooms: [count], players: count, advPerRoom: 4 })],
    assignments: [teams.map((team) => ({ name: team.teamId, room: 1, isLucky: false }))],
  });
}

/** Six players: P1-P4 reach a single-game Final, P5 and P6 went out in the first round. */
function finished(extra: Partial<TournamentState> = {}): TournamentState {
  const names = playersOf(6);
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: 1,
    rounds: [
      buildRound({ roundNum: 1, rooms: [6], players: 6, advPerRoom: 4 }),
      buildRound({ roundNum: 2, rooms: [4], players: 4, isFinal: true, numGames: 1 }),
    ],
    assignments: [
      names.map((name) => ({ name, room: 1, isLucky: false })),
      names.slice(0, 4).map((name) => ({ name, room: 1, isLucky: false })),
    ],
    scores: Object.fromEntries(names.map((_, index) => [`r0-rm1-p${index}`, 600 - index * 100])),
    finalScores: { 'game1-P1': 40, 'game1-P2': 30, 'game1-P3': 20, 'game1-P4': 10 },
    ...extra,
  });
}

function headerOf(state: TournamentState, options?: { timeZone?: string }) {
  const data = computeRankings(state);
  if (!data) throw new Error('no rankings');
  return rankingsImageHeader(state, data, options);
}

const withdrawn = (name: string, playedAnyMatch: boolean): WithdrawnUnit => ({
  name,
  label: name,
  members: null,
  playedAnyMatch,
  reason: 'removed',
});

describe('rankingsImageHeader', () => {
  it('counts the players of an individual format (37, then 31, then 1 in the singular)', () => {
    expect(headerOf(inPlay(37)).count).toBe('37 players');
    expect(headerOf(inPlay(31)).count).toBe('31 players');
    expect(headerOf(inPlay(1)).count).toBe('1 player');
  });

  it('counts the teams, then the players, of a team format: 13 teams of three', () => {
    expect(headerOf(teamsInPlay(13)).count).toBe('13 teams · 39 players');
    expect(headerOf(teamsInPlay(1)).count).toBe('1 team · 3 players');
  });

  it('counts a withdrawn unit that played, and one swapped out, but not one that never played', () => {
    const units = [withdrawn('P38', true), { ...withdrawn('P39', true), reason: 'swapped' as const }];
    expect(headerOf(inPlay(37, { withdrawnUnits: [...units, withdrawn('P40', false)] })).count).toBe(
      '39 players',
    );
  });

  it('does not count a reserve who never joined', () => {
    expect(headerOf(inPlay(31, { reserves: ['R1', 'R2'] })).count).toBe('31 players');
  });

  it('counts the finalists once the Final is played: as many as the names on the image', () => {
    expect(headerOf(finished()).count).toBe('6 players');
    expect(headerOf(finished({ withdrawnUnits: [withdrawn('P7', true)] })).count).toBe('7 players');
  });

  it('says how many are still in while the tournament runs, and nothing after the Final', () => {
    expect(headerOf(inPlay(37)).stillIn).toBe('37 still in');
    expect(headerOf(finished()).stillIn).toBeNull();
  });

  it('labels the rankings live or final', () => {
    expect(headerOf(inPlay(31))).toMatchObject({ label: 'LIVE RANKINGS', live: true });
    expect(headerOf(finished())).toMatchObject({ label: 'FINAL RANKINGS', live: false });
  });

  it('titles the image with the trimmed title, "Unnamed Tournament" without one', () => {
    expect(headerOf(inPlay(31, { title: '  Friday Cup ' })).title).toBe('Friday Cup');
    expect(headerOf(inPlay(31, { title: '   ' })).title).toBe('Unnamed Tournament');
  });

  describe('date', () => {
    const afterMidnightInParis = Date.UTC(2026, 9, 18, 1, 30); // Sun 18 Oct 03:30 CEST, Sat 17 Oct 21:30 EDT
    const scheduled = {
      info: { scheduledAt: afterMidnightInParis, rulesText: '', screenshots: [] },
    };

    it('is the day in the time zone it is read in', () => {
      const state = inPlay(31, scheduled);
      expect(headerOf(state, { timeZone: 'Europe/Paris' }).date).toBe('Sunday 18 October 2026');
      expect(headerOf(state, { timeZone: 'America/New_York' }).date).toBe('Saturday 17 October 2026');
    });

    it('is null without a scheduled date', () => {
      expect(headerOf(inPlay(31)).date).toBeNull();
      expect(
        headerOf(inPlay(31, { info: { scheduledAt: null, rulesText: '', screenshots: [] } })).date,
      ).toBeNull();
    });
  });
});
