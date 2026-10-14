import { describe, expect, it } from 'vitest';
import { buildState, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { scoreKeysForPosition } from '../../domain/tournament/scoring';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { roomsStillPlaying, stillPlayingText } from './still-playing';

function atFirstLuckyRound(count: number): TournamentState {
  let state = buildState({
    label: `${count}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '24',
    },
  });
  if (!state) throw new Error('generation failed');
  while (state.rounds[state.curRound].luckyCount === 0) {
    const result = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (result.status !== 'advanced') throw new Error('could not advance');
    state = result.state;
  }
  return state;
}

/** Scores every unit of the given rooms of the current round. */
function scoreRooms(state: TournamentState, rooms: number[]): TournamentState {
  const scores = { ...state.scores };
  const seats = new Map<number, number>();
  for (const entry of state.assignments[state.curRound] ?? []) {
    if (entry.room === null || !rooms.includes(entry.room)) continue;
    const position = seats.get(entry.room) ?? 0;
    seats.set(entry.room, position + 1);
    for (const key of scoreKeysForPosition({ roundIndex: state.curRound, room: entry.room, position })) {
      scores[key] = 90 - position * 4;
    }
  }
  return { ...state, scores };
}

describe.each([37, 53])('roomsStillPlaying with %i players', (count) => {
  const state = atFirstLuckyRound(count);
  const roomCount = new Set((state.assignments[state.curRound] ?? []).map((entry) => entry.room)).size;

  it('lists every room before anything is scored', () => {
    expect(roomsStillPlaying(state, state.curRound)).toEqual(
      Array.from({ length: roomCount }, (_, i) => i + 1),
    );
  });

  it('drops the rooms that are fully scored', () => {
    expect(roomsStillPlaying(scoreRooms(state, [1, 2]), state.curRound)).toEqual(
      Array.from({ length: roomCount - 2 }, (_, i) => i + 3),
    );
  });

  it('is empty once every room is scored', () => {
    const all = Array.from({ length: roomCount }, (_, i) => i + 1);
    expect(roomsStillPlaying(scoreRooms(state, all), state.curRound)).toEqual([]);
  });

  it('keeps a room that has only some of its scores', () => {
    const partial = scoreRooms(state, [1]);
    const seat = (state.assignments[state.curRound] ?? []).findIndex((entry) => entry.room === 1);
    const [key] = scoreKeysForPosition({ roundIndex: state.curRound, room: 1, position: seat });
    const scores = { ...partial.scores, [key]: null };
    expect(roomsStillPlaying({ ...partial, scores }, state.curRound)).toContain(1);
  });
});

describe('stillPlayingText', () => {
  it('reads one, two and several rooms', () => {
    expect(stillPlayingText([3])).toBe('Room C still playing.');
    expect(stillPlayingText([2, 3])).toBe('Rooms B and C still playing.');
    expect(stillPlayingText([1, 2, 3])).toBe('Rooms A, B and C still playing.');
  });

  it('says nothing when no room is playing', () => {
    expect(stillPlayingText([])).toBe('');
  });
});
