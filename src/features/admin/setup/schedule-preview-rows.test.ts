import { describe, expect, it } from 'vitest';
import { createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { buildRound } from '../../../domain/tournament/__tests__/test-fixtures';
import {
  SE_2V2V2V2,
  SE_FFA,
  firstEliminationIndex,
  generate,
  withRoundShape,
} from '../../../domain/tournament/__tests__/fair-cut-fixtures';
import { withEarlierCutRule } from '../../../domain/tournament/__tests__/play-through';
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

describe('schedulePreviewRows -- the fair cut', () => {
  it('says what each room size loses instead of the lucky-loser count', () => {
    const state = generate('2v2v2v2 31', 31, SE_2V2V2V2);
    const index = firstEliminationIndex(state);
    expect(schedulePreviewRows(state, 'teams')[index].detail).toBe(
      '4 · 4 · 4 · 4 · 4 · 4 · 4 · 3 teams, 26 advance: rooms of 4 lose 4–5, the room of 3 loses 0–1',
    );
  });

  it('says "lose 2" when there is no spare range', () => {
    const base = generate('FFA 37', 37, SE_FFA);
    const index = firstEliminationIndex(base);
    const shaped = withRoundShape(base, index, { rooms: [4, 4, 2, 2], advTotal: 9 });
    expect(schedulePreviewRows(shaped, 'players')[index].detail).toBe(
      '4 · 4 · 2 · 2 players, 9 advance: rooms of 4 lose 2, rooms of 2 lose 1',
    );
  });

  it('keeps the earlier wording for equal rooms and for a tournament without cutVersion', () => {
    const equal = generate('FFA 40', 40, SE_FFA);
    const rows = schedulePreviewRows(equal, 'players');
    expect(rows[firstEliminationIndex(equal)].detail).not.toContain('advance:');
    const earlier = withEarlierCutRule(generate('2v2v2v2 31', 31, SE_2V2V2V2));
    const detail = schedulePreviewRows(earlier, 'teams')[firstEliminationIndex(earlier)].detail;
    expect(detail).toBe('4 · 4 · 4 · 4 · 4 · 4 · 4 · 3 teams, 26 advance incl. 2 lucky losers');
  });
});

describe('schedulePreviewRows on a Best-of round', () => {
  it('says "best of 3" where a summed round says how many games', () => {
    const rows = schedulePreviewRows(
      stateOf([
        buildRound({ roundNum: 1, rooms: [2, 2], players: 4, bestOf: 3, numGames: 3 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, numGames: 2 }),
      ]),
      'players',
    );
    expect(rows.map((row) => row.meta)).toEqual(['2 rooms · best of 3', '1 room · 2 games']);
  });
});
