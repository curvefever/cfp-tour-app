import { describe, expect, it } from 'vitest';
import { answerAbsence } from '../../domain/tournament/absences';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { removeRosterUnit, shareTiedPoints } from '../../domain/tournament/mutations';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { liveTournament } from '../../domain/tournament/__tests__/qual-waterfall';
import { foldedColumnSummary, foldedRoundSummary } from './folded-round';

const FFA = {
  gameFormat: 'ffa-individual',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'qual-table',
  qualAdv: '24',
} as const;

function started(count: number, setup: Parameters<typeof buildState>[0]['setup'] = FFA): TournamentState {
  const state = buildState({ label: `${count}`, count, teams: false, setup });
  if (!state) throw new Error('generation failed');
  return state;
}

function advanced(state: TournamentState): TournamentState {
  const result = advanceTournamentRound(scoreCurrentRound(state, 0));
  if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
  return result.state;
}

const firstSeated = (state: TournamentState, roundIndex: number, room: number) =>
  (state.assignments[roundIndex] ?? []).find((entry) => entry.room === room)?.name ?? '';

describe.each([37, 43])('foldedRoundSummary with %i players', (count) => {
  const first = started(count);
  const second = advanced(first);

  it('counts the occupied rooms of the round, whether or not it is done', () => {
    const rooms = new Set((first.assignments[0] ?? []).map((entry) => entry.room)).size;
    expect(foldedRoundSummary(second, 0, null)).toEqual({
      rooms,
      done: true,
      notCounted: false,
      followed: null,
    });
    expect(foldedRoundSummary(second, 1, null).done).toBe(false);
  });

  it('is not counted only for a seeding-only round', () => {
    const seedingOnly = {
      ...second,
      rounds: second.rounds.map((round, index) =>
        index === 0 ? { ...round, excludeFromStandings: true } : round,
      ),
    };
    expect(foldedRoundSummary(seedingOnly, 0, null).notCounted).toBe(true);
    expect(foldedRoundSummary(seedingOnly, 1, null).notCounted).toBe(false);
  });

  it('marks only rounds before the current one as done', () => {
    expect(foldedRoundSummary(second, 0, null).done).toBe(true);
    expect(foldedRoundSummary(second, second.curRound, null).done).toBe(false);
    expect(foldedRoundSummary(second, second.curRound + 1, null).done).toBe(false);
  });

  it('gives a followed unit its room and place once the room is scored', () => {
    const name = firstSeated(second, 0, 2);
    const summary = foldedRoundSummary(second, 0, name).followed;
    expect(summary?.room).toBe(2);
    expect(summary?.place).toBeGreaterThanOrEqual(1);
    expect(summary?.detail).toMatch(/^Room B · \d+(st|nd|rd|th)$/);
  });

  it('shows the room alone while the room is still being scored', () => {
    const name = firstSeated(first, 0, 1);
    expect(foldedRoundSummary(first, 0, name).followed).toMatchObject({
      room: 1,
      place: null,
      detail: 'Room A',
    });
  });

  it('shows nothing for a unit that did not play the round, or that nobody follows', () => {
    expect(foldedRoundSummary(second, 0, 'Nobody At All').followed).toBeNull();
    expect(foldedRoundSummary(second, 0, null).followed).toBeNull();
  });

  it('keeps a unit that was removed after the round out of the folded box without failing', () => {
    const name = firstSeated(second, 0, 1);
    const removed = removeRosterUnit(second, name);
    expect(() => foldedRoundSummary(removed, 0, name)).not.toThrow();
  });
});

describe('foldedRoundSummary: a bye', () => {
  it('reads "Bye" for a unit sitting a round out (33 head-to-head players, odd count)', () => {
    const state = started(33, {
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'bye',
    });
    const byeName = state.byes[0]?.[0];
    expect(byeName).toBeTruthy();
    expect(foldedRoundSummary(state, 0, byeName ?? '').followed).toMatchObject({
      room: null,
      place: null,
      detail: 'Bye',
    });
  });
});

describe('foldedRoundSummary: a shared place', () => {
  it('reads "=2nd" for units sharing 2nd place, and plain places around them (37 players)', () => {
    const base = scoreCurrentRound(started(37), 0);
    const names = (base.assignments[0] ?? []).filter((entry) => entry.room === 1).map((entry) => entry.name);
    const scores = { ...base.scores };
    names.forEach((_, seat) => {
      scores[`r0-rm1-p${seat}`] = [900, 500, 500, 400][seat] ?? 100 - seat * 10;
    });
    const shared = shareTiedPoints({ ...base, scores }, 'r0-rm1-s500', [names[1], names[2]]);
    const detail = (name: string) => foldedRoundSummary(shared, 0, name).followed?.detail;
    expect(detail(names[0])).toBe('Room A · 1st');
    expect(detail(names[1])).toBe('Room A · =2nd');
    expect(detail(names[2])).toBe('Room A · =2nd');
    expect(detail(names[3])).toBe('Room A · 4th');
  });
});

describe('foldedColumnSummary -- a waterfall column of two rounds', () => {
  function inBracket(): TournamentState {
    let state = liveTournament(19);
    for (let guard = 0; guard < 20 && !state.rounds[state.curRound].isWaterfall; guard += 1) {
      state = advanced2(state);
    }
    return state;
  }
  function advanced2(state: TournamentState): TournamentState {
    const result = advanceTournamentRound(scoreCurrentRound(state, 2));
    if (result.status !== 'advanced') throw new Error(`could not advance: ${JSON.stringify(result)}`);
    return result.state;
  }
  const start = inBracket();
  const upper = start.curRound;
  const column = [upper, upper + 1];

  it('counts the rooms of every round of the column, and is not done while it is in play', () => {
    expect(foldedColumnSummary(start, column, null)).toEqual({
      rooms: 4,
      done: false,
      notCounted: false,
      followed: null,
    });
  });

  it('is done once the column has been advanced from', () => {
    let scored = start;
    for (const index of column)
      scored = { ...scoreCurrentRound({ ...scored, curRound: index }, 2), curRound: start.curRound };
    const next = advanceTournamentRound(scored);
    if (next.status !== 'advanced') throw new Error('expected an advance');
    expect(foldedColumnSummary(next.state, column, null)).toMatchObject({ rooms: 4, done: true });
  });

  it('names the round in the line of a followed unit that played the second round', () => {
    const lowerUnit = (start.assignments[upper + 1] ?? []).find((entry) => entry.room === 2)?.name ?? '';
    const scored = { ...scoreCurrentRound({ ...start, curRound: upper + 1 }, 2), curRound: upper };
    const followed = foldedColumnSummary(scored, column, lowerUnit).followed;
    expect(followed?.detail).toMatch(/^Round 5 Lower · Room B( · \d+(st|nd|rd|th))?$/);
    expect(followed?.room).toBe(2);
  });

  it('keeps the plain line for a column of one round', () => {
    const unit = (start.assignments[upper] ?? []).find((entry) => entry.room === 1)?.name ?? '';
    expect(foldedColumnSummary(start, [upper], unit).followed?.detail).toBe('Room A');
  });
});

describe('foldedRoundSummary: an absentee', () => {
  it('reads "Room A · absent" for the followed absentee, and the others are placed among themselves', () => {
    const scored = scoreCurrentRound(started(37), 0);
    const names = scored.assignments[0].filter((entry) => entry.room === 1).map((entry) => entry.name);
    const key = 'r0-rm1-p7';
    const state = answerAbsence({ ...scored, scores: { ...scored.scores, [key]: 0 } }, [key], 'absent');
    expect(foldedRoundSummary(state, 0, names[7]).followed).toMatchObject({
      room: 1,
      place: null,
      detail: 'Room A · absent',
    });
    expect(foldedRoundSummary(state, 0, names[6]).followed?.detail).toBe('Room A · 7th');
  });
});
