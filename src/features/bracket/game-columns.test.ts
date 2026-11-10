import { describe, expect, it } from 'vitest';
import { oneRoomState, generated } from '../../domain/tournament/__tests__/test-fixtures';
import { bestOfGameCount } from '../../domain/tournament/match-format';
import { roundNoteNames } from '../../domain/tournament/round-notes';
import type { TournamentState } from '../../domain/tournament/types';
import {
  MAX_GAME_COLUMNS_IN_VIEW,
  ROUND_COLUMN_WIDTH,
  roomShowsGameColumns,
  roundColumnWidth,
  showsPoints,
} from './game-columns';

/** One room of 8 (round 1), a Best of 3 (up to 9 games), with `games[g]` the scores of game g + 1 in seat order. */
function bestOfRoom(games: number[][]): TournamentState {
  const names = Array.from({ length: 8 }, (_, index) => `P${index + 1}`);
  const scores: Record<string, number> = {};
  games.forEach((row, game) =>
    row.forEach((value, position) => {
      scores[`r0-rm1-p${position}-g${game + 1}`] = value;
    }),
  );
  return oneRoomState({
    players: names,
    rounds: [{ bestOf: 3, numGames: bestOfGameCount(3, 8), isWaterfall: true }, {}],
    scores,
  });
}

/** The unit at `winner` scores highest of the game. */
const wonBy = (winner: number): number[] =>
  Array.from({ length: 8 }, (_, index) => (index === winner ? 100 : 10 + index));

const widthOf = (state: TournamentState, editable = false) => roundColumnWidth(state, [0], editable);

describe('roundColumnWidth', () => {
  it('stays 330 px for a round that is not drawn: the expected and projected rounds show names only', () => {
    const state = generated(37, { qualAdv: '30', poolingGames: '2', finalsBestOf: '3' });
    const names = roundNoteNames(state);
    const final = names.indexOf('Final');
    expect(state.rounds[final].numGames).toBe(9);
    expect(state.assignments[final] ?? []).toHaveLength(0);
    expect(roundColumnWidth(state, [final], false)).toBe(ROUND_COLUMN_WIDTH);
    expect(roundColumnWidth(state, [names.indexOf('Round 4')], false)).toBe(ROUND_COLUMN_WIDTH);
  });

  it('follows the columns a drawn room shows: 46 px per column, never below 330', () => {
    const widths = [[], [0], [0, 1], [0, 1, 2]].map((winners) => widthOf(bestOfRoom(winners.map(wonBy))));
    // One shared column (nothing played), then G1 + the rest, G1 G2 + the rest, G1 G2 G3 + the rest.
    expect(widths).toEqual([ROUND_COLUMN_WIDTH, 260 + 2 * 46, 260 + 3 * 46, 260 + 4 * 46]);
  });

  it('never shows more than 4 game columns: a room played to game 9 has the width of 4', () => {
    const four = widthOf(bestOfRoom([wonBy(0), wonBy(1), wonBy(2)]));
    const ninth = widthOf(bestOfRoom(Array.from({ length: 9 }, (_, game) => wonBy(game % 8))));
    expect(MAX_GAME_COLUMNS_IN_VIEW).toBe(4);
    expect(ninth).toBe(four);
    expect(widthOf(bestOfRoom([wonBy(0), wonBy(1), wonBy(2), wonBy(3)]))).toBe(four);
  });

  it('adds the points column of a pooling room that counts toward the standings', () => {
    const pooling = generated(37, { qualAdv: '30', poolingGames: '2' });
    expect(showsPoints(pooling, 0)).toBe(true);
    expect(roundColumnWidth(pooling, [0], false)).toBe(260 + 44 + 2 * 46);
    expect(showsPoints(bestOfRoom([]), 0)).toBe(false);
  });

  it('stays 330 while the rows take the score inputs (an admin at the round in play)', () => {
    expect(widthOf(bestOfRoom([wonBy(0)]), true)).toBe(ROUND_COLUMN_WIDTH);
  });

  it('is the widest of the rounds played in one column', () => {
    const state = generated(37, { qualAdv: '30', poolingGames: '2' });
    const round = state.rounds.findIndex((entry) => (entry.numGames ?? 1) === 2);
    const single = state.rounds.findIndex((entry) => (entry.numGames ?? 1) === 1);
    const wide = roundColumnWidth(state, [round], false);
    expect(wide).toBeGreaterThan(ROUND_COLUMN_WIDTH);
    expect(roundColumnWidth(state, [single, round], false)).toBe(wide);
  });
});

describe('roomShowsGameColumns', () => {
  const round = (extra: object) => ({ ...bestOfRoom([]).rounds[0], ...extra });

  it('is the one predicate of the room cards: a round of several games whose rows take no inputs, never the Final', () => {
    expect(roomShowsGameColumns(round({}), false)).toBe(true);
    expect(roomShowsGameColumns(round({}), true)).toBe(false);
    expect(roomShowsGameColumns(round({ isFinal: true }), false)).toBe(false);
    expect(roomShowsGameColumns(round({ numGames: 1 }), false)).toBe(false);
  });
});
