import { describe, expect, it } from 'vitest';
import { createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { buildRound } from '../../../domain/tournament/__tests__/test-fixtures';
import { schedulePreviewRows } from './schedule-preview-rows';

function stateOf(rounds: ReturnType<typeof buildRound>[]) {
  return { ...createDefaultTournamentState(), rounds };
}

describe('schedulePreviewRows', () => {
  it('names a round, counts its rooms and lists their sizes, byes and what advances', () => {
    const rows = schedulePreviewRows(
      stateOf([
        buildRound({
          roundNum: 1,
          rooms: [8, 8, 7, 7, 7],
          players: 37,
          byeCount: 1,
          advTotal: 24,
          luckyCount: 2,
        }),
      ]),
      'players',
    );
    expect(rows).toEqual([
      {
        name: 'Round 1',
        meta: '5 rooms',
        detail: '8 · 8 · 7 · 7 · 7 players, 1 bye, 24 advance incl. 2 lucky losers',
      },
    ]);
  });

  it('adds the game count when a round is played over several games, and leaves the Final without an advance count', () => {
    const rows = schedulePreviewRows(
      stateOf([
        buildRound({ roundNum: 2, rooms: [4, 4], players: 8, isSemis: true, numGames: 2, advTotal: 4 }),
        buildRound({ roundNum: 3, rooms: [4], players: 4, isFinal: true, numGames: 3, advTotal: 1 }),
      ]),
      'teams',
    );
    expect(rows[0]).toMatchObject({
      name: 'Semis',
      meta: '2 rooms · 2 games',
      detail: '4 · 4 teams, 4 advance',
    });
    expect(rows[1]).toEqual({ name: 'Final', meta: '1 room · 3 games', detail: '4 teams' });
  });

  it('shows no cut for a round that sends everyone on', () => {
    const rows = schedulePreviewRows(
      stateOf([buildRound({ roundNum: 1, rooms: [4, 4], players: 8, advTotal: 8 })]),
      'players',
    );
    expect(rows[0].detail).toBe('4 · 4 players');
  });

  it('counts the matches of a round without rooms', () => {
    const rows = schedulePreviewRows(
      stateOf([
        buildRound({
          roundNum: 1,
          rooms: [],
          players: 4,
          isGroupStage: true,
          matches: [
            { a: 'x', b: 'y' },
            { a: 'z', b: 'w' },
          ] as never,
        }),
      ]),
      'players',
    );
    expect(rows[0]).toEqual({ name: 'Round 1', meta: '2 matches', detail: '' });
  });
});
