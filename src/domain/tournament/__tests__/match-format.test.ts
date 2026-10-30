import { describe, expect, it } from 'vitest';
import { answerAbsence, absentInRoom, pendingAbsenceQuestions } from '../absences';
import { detectTieBreaks, invalidateStaleTieResolutions, roomFinishOrder, scoreRoom } from '../advancement';
import { bestOfGameCount, isBestOfRound, roomMatch, winsNeeded } from '../match-format';
import { removeRosterUnit } from '../mutations';
import { computeRankings, isFinalComplete } from '../rankings';
import { isRoomScored, orderRoomWithPlaces } from '../scoring';
import { finalsProgressState } from '../finals';
import { createDefaultTournamentState } from '../state-defaults';
import { advanceTournamentRound } from '../transitions';
import {
  parseWaterfallGraph,
  validateAndOrderWaterfallGraph,
  waterfallBracketPhase,
} from '../waterfall-bracket';
import type { TournamentState } from '../types';
import { buildAssignments, buildRound, oneRoomState } from './test-fixtures';

/** One room (round 1), Best of `bestOf`, with `games[g]` the scores of game g + 1 in seat order. */
function bestOfRoom(names: string[], bestOf: number, games: number[][]): TournamentState {
  const scores: Record<string, number> = {};
  games.forEach((row, game) =>
    row.forEach((value, position) => {
      scores[`r0-rm1-p${position}-g${game + 1}`] = value;
    }),
  );
  return oneRoomState({
    players: names,
    rounds: [{ bestOf, numGames: bestOfGameCount(bestOf, names.length), isWaterfall: true }, {}],
    scores,
  });
}

const PAIR = ['A', 'B'];
const TRIO = ['A', 'B', 'C'];

describe('the Best-of arithmetic', () => {
  it('needs (N + 1) / 2 wins', () => {
    expect([3, 5, 7, 9].map(winsNeeded)).toEqual([2, 3, 4, 5]);
  });

  it('gives a room the most games it can need without a drawn game', () => {
    expect(bestOfGameCount(3, 2)).toBe(3);
    expect(bestOfGameCount(3, 3)).toBe(4);
    expect(bestOfGameCount(3, 4)).toBe(5);
    expect(bestOfGameCount(5, 2)).toBe(5);
    expect(bestOfGameCount(5, 4)).toBe(9);
  });

  it('knows a Best-of round by its bestOf', () => {
    expect(isBestOfRound(buildRound({ roundNum: 1, bestOf: 3 }))).toBe(true);
    expect(isBestOfRound(buildRound({ roundNum: 1, numGames: 3 }))).toBe(false);
    expect(roomMatch(oneRoomState({ players: PAIR }), 0, 1)).toBeNull();
  });
});

describe('a head-to-head Best of 3', () => {
  it('is complete after a 2-0, and a third game typed anyway counts for nothing', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [8, 3],
      [1, 99],
    ]);
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 2, decidingGame: 2, complete: true });
    expect(roomMatch(state, 0, 1)?.units.map(({ wins, total }) => [wins, total])).toEqual([
      [2, 18],
      [0, 8],
    ]);
    expect(isRoomScored(state, 0, 1)).toBe(true);
    expect(roomFinishOrder(state, 0, 1)).toEqual(PAIR);
  });

  it('needs the third game at 1-1, and ranks nobody before it is complete', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [3, 8],
    ]);
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 2, decidingGame: null, complete: false });
    expect(isRoomScored(state, 0, 1)).toBe(false);
    expect(scoreRoom(state, 0, 1, null)).toEqual([]);
    expect(scoreRoom(state, 0, 1, 0).map(({ name, score, tiebreak }) => [name, score, tiebreak])).toEqual([
      ['A', 1, 13],
      ['B', 1, 13],
    ]);
    const decided = { ...state, scores: { ...state.scores, 'r0-rm1-p0-g3': 4, 'r0-rm1-p1-g3': 9 } };
    expect(roomMatch(decided, 0, 1)).toMatchObject({ decidingGame: 3, complete: true });
    expect(roomFinishOrder(decided, 0, 1)).toEqual(['B', 'A']);
  });

  it('waits for the game in play: a game counts once every unit has its score', () => {
    const state = { ...bestOfRoom(PAIR, 3, [[10, 5]]), scores: { 'r0-rm1-p0-g1': 10 } };
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 0, complete: false });
  });

  it('wins nothing from a drawn game: it needs another one, and the first to 2 still decides', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [7, 7],
    ]);
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 2, decidingGame: null, complete: false });
    expect(roomMatch(state, 0, 1)?.units.map((unit) => unit.wins)).toEqual([1, 0]);
    const next = { ...state, scores: { ...state.scores, 'r0-rm1-p0-g3': 1, 'r0-rm1-p1-g3': 4 } };
    expect(roomMatch(next, 0, 1)).toMatchObject({ decidingGame: null, complete: true });
    expect(roomMatch(next, 0, 1)?.units.map((unit) => unit.wins)).toEqual([1, 1]);
  });

  it('orders a match that used every game at 1-1 by the total score', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [7, 7],
      [3, 9],
    ]);
    // 1-1, totals 20 against 21.
    expect(roomFinishOrder(state, 0, 1)).toEqual(['B', 'A']);
  });

  it('is complete with the wins decided, however the draws fall', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [7, 7],
      [6, 6],
    ]);
    expect(roomMatch(state, 0, 1)).toMatchObject({ decidingGame: null, complete: true });
    expect(roomFinishOrder(state, 0, 1)).toEqual(PAIR);
  });

  it('re-opens the room when an earlier game is corrected', () => {
    const decided = bestOfRoom(PAIR, 3, [
      [10, 5],
      [8, 3],
      [1, 99],
    ]);
    const corrected = { ...decided, scores: { ...decided.scores, 'r0-rm1-p1-g2': 20 } };
    // 1-1, and the typed third game now counts: B wins it 99 to 1.
    expect(roomMatch(corrected, 0, 1)).toMatchObject({ decidingGame: 3, complete: true });
    expect(roomFinishOrder(corrected, 0, 1)).toEqual(['B', 'A']);
  });
});

describe('a Best of 5 head-to-head', () => {
  it('needs 3 wins: a 3-0 ends it at game 3, a 2-2 goes to game 5', () => {
    const sweep = bestOfRoom(PAIR, 5, [
      [9, 1],
      [9, 1],
      [9, 1],
    ]);
    expect(roomMatch(sweep, 0, 1)).toMatchObject({ decidingGame: 3, complete: true });
    const level = bestOfRoom(PAIR, 5, [
      [9, 1],
      [1, 9],
      [9, 1],
      [1, 9],
    ]);
    expect(roomMatch(level, 0, 1)).toMatchObject({ countedGames: 4, decidingGame: null, complete: false });
    const fifth = { ...level, scores: { ...level.scores, 'r0-rm1-p0-g5': 2, 'r0-rm1-p1-g5': 3 } };
    expect(roomMatch(fifth, 0, 1)).toMatchObject({ decidingGame: 5, complete: true });
    expect(roomFinishOrder(fifth, 0, 1)).toEqual(['B', 'A']);
  });
});

describe('a Best of 3 in a room of 3', () => {
  // A wins game 1, B game 2, C game 3, A game 4: A has 2 wins, B and C 1 each.
  const games = [
    [10, 5, 1],
    [1, 10, 5],
    [5, 1, 10],
    [10, 2, 2],
  ];

  it('plays up to 4 games and ends at the first unit to win 2', () => {
    const state = bestOfRoom(TRIO, 3, games);
    expect(state.rounds[0].numGames).toBe(4);
    expect(roomMatch(state, 0, 1)).toMatchObject({ countedGames: 4, decidingGame: 4, complete: true });
    expect(roomMatch(state, 0, 1)?.units.map(({ wins, total }) => [wins, total])).toEqual([
      [2, 26],
      [1, 18],
      [1, 18],
    ]);
  });

  it('is not decided by 3 games each won by a different unit', () => {
    expect(roomMatch(bestOfRoom(TRIO, 3, games.slice(0, 3)), 0, 1)).toMatchObject({
      countedGames: 3,
      decidingGame: null,
      complete: false,
    });
  });

  it('orders the units below first by wins, then by the total score', () => {
    const apart = bestOfRoom(TRIO, 3, [...games.slice(0, 3), [10, 2, 3]]);
    expect(roomFinishOrder(apart, 0, 1)).toEqual(['A', 'C', 'B']);
  });

  it('keys a tie on equal wins and equal totals with the total, and nothing else', () => {
    const state = bestOfRoom(TRIO, 3, games);
    const ties = detectTieBreaks(0, state.rounds[0], state);
    expect(Object.keys(ties)).toEqual(['r0-rm1-s1-t18']);
    expect(ties['r0-rm1-s1-t18'].players.map((unit) => unit.name)).toEqual(['B', 'C']);
  });

  it('applies the resolution stored under that key', () => {
    const state = { ...bestOfRoom(TRIO, 3, games), tieResolutions: { 'r0-rm1-s1-t18': ['C'] } };
    expect(roomFinishOrder(state, 0, 1)).toEqual(['A', 'C', 'B']);
    const placed = orderRoomWithPlaces(scoreRoom(state, 0, 1, null), 0, 1, state);
    expect(placed.map(({ entry, place }) => [entry.name, place])).toEqual([
      ['A', 1],
      ['C', 2],
      ['B', 3],
    ]);
  });

  it('keeps a resolution that still matches its tie and drops a stale one', () => {
    const state = { ...bestOfRoom(TRIO, 3, games), tieResolutions: { 'r0-rm1-s1-t18': ['C'] } };
    expect(invalidateStaleTieResolutions(state, 0, 1)).toBe(state);
    // C scores 1 more in game 4: C's total is 19 and the tie at 18 is gone.
    const changed = { ...state, scores: { ...state.scores, 'r0-rm1-p2-g4': 3 } };
    expect(invalidateStaleTieResolutions(changed, 0, 1).tieResolutions).toEqual({});
    // A key for a total nobody has is dropped too.
    const stale = { ...state, tieResolutions: { 'r0-rm1-s1-t17': ['C'] } };
    expect(invalidateStaleTieResolutions(stale, 0, 1).tieResolutions).toEqual({});
  });
});

describe('a summed round', () => {
  it('keeps its tie key and its order', () => {
    const state = oneRoomState({
      players: TRIO,
      scores: { 'r0-rm1-p0': 100, 'r0-rm1-p1': 100, 'r0-rm1-p2': 50 },
    });
    expect(Object.keys(detectTieBreaks(0, state.rounds[0], state))).toEqual(['r0-rm1-s100']);
    expect(scoreRoom(state, 0, 1, null).every((unit) => !('tiebreak' in unit))).toBe(true);
  });
});

describe('absentees in a Best-of room', () => {
  it('asks no question about a game after the decision', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [8, 3],
      [0, 0],
    ]);
    expect(pendingAbsenceQuestions(state)).toEqual([]);
  });

  it('asks about a 0 in a game that counts', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 0],
      [3, 8],
    ]);
    expect(pendingAbsenceQuestions(state).flatMap((room) => room.questions.map((q) => q.key))).toEqual([
      'r0-rm1-p1-g1',
    ]);
  });

  it('counts a unit absent for the whole match, though the games after the decision were never played', () => {
    const played = bestOfRoom(PAIR, 3, [
      [10, 0],
      [8, 0],
    ]);
    const answered = answerAbsence(played, ['r0-rm1-p1-g1', 'r0-rm1-p1-g2'], 'absent');
    expect(absentInRoom(answered, 0, 1)).toEqual(['B']);
    expect(roomFinishOrder(answered, 0, 1)).toEqual(PAIR);
  });
});

describe('a withdrawal from a Best-of room', () => {
  it('counts a score in any game as having played, though a decided match leaves games empty', () => {
    const state = bestOfRoom(PAIR, 3, [
      [10, 5],
      [8, 3],
    ]);
    expect(removeRosterUnit(state, 'B').withdrawnUnits[0]).toMatchObject({ name: 'B', playedAnyMatch: true });
    const unplayed = bestOfRoom(PAIR, 3, []);
    expect(removeRosterUnit(unplayed, 'B').withdrawnUnits[0]).toMatchObject({ playedAnyMatch: false });
  });
});

describe('a Best-of Final', () => {
  function bestOfFinal(finalScores: Record<string, number>): TournamentState {
    return createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2'],
      curRound: 1,
      rounds: [
        buildRound({ roundNum: 1, rooms: [2], players: 2, advPerRoom: 1 }),
        buildRound({ roundNum: 2, rooms: [2], players: 2, isFinal: true, bestOf: 3, numGames: 3 }),
      ],
      assignments: [buildAssignments(['P1', 'P2'], [2]), buildAssignments(['P1', 'P2'], [2])],
      scores: { 'r0-rm1-p0': 400, 'r0-rm1-p1': 300 },
      finalScores,
    });
  }

  it('is complete once decided and orders the podium by wins, showing the wins', () => {
    const state = bestOfFinal({ 'game1-P1': 5, 'game1-P2': 9, 'game2-P1': 3, 'game2-P2': 8, 'game3-P1': 99 });
    expect(isFinalComplete(state)).toBe(true);
    expect(finalsProgressState(state, 1, state.rounds[1])).toMatchObject({
      complete: true,
      order: ['P2', 'P1'],
    });
    expect(computeRankings(state)?.finalists.map(({ name, total, rank }) => [name, total, rank])).toEqual([
      ['P2', 2, 1],
      ['P1', 0, 2],
    ]);
  });

  it('is not complete at 1-1', () => {
    const state = bestOfFinal({ 'game1-P1': 5, 'game1-P2': 9, 'game2-P1': 8, 'game2-P2': 3 });
    expect(isFinalComplete(state)).toBe(false);
    expect(finalsProgressState(state, 1, state.rounds[1])).toMatchObject({ complete: false, nextGame: 3 });
  });
});

describe('routing out of a Best-of column', () => {
  it('sends rank 1 on in each room by the match result, however many games it took', () => {
    const parsed = parseWaterfallGraph(
      'ROUNDS:\nR1 = 2x2\nFinal = 2 FINAL\nROUTES:\nR1.A: 1->Final, 2->eliminated\nR1.B: 1->Final, 2->eliminated',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const validated = validateAndOrderWaterfallGraph(parsed.value, {
      roomSize: { min: 1, max: 20, ideal: 8 },
      entrantCount: 4,
    });
    if (!validated.ok) throw new Error(validated.error);
    const rounds = waterfallBracketPhase(4, 1, {
      graph: {
        ...validated.value,
        rounds: validated.value.rounds.map((spec) => ({ ...spec, bestOf: spec.isFinal ? undefined : 3 })),
      },
      finalsGames: 1,
    });
    expect(rounds[0]).toMatchObject({ bestOf: 3, numGames: 3 });
    const state = createDefaultTournamentState({
      gameFormat: 'ffa-individual',
      players: ['P1', 'P2', 'P3', 'P4'],
      rounds,
      assignments: [buildAssignments(['P1', 'P2', 'P3', 'P4'], [2, 2])],
      curRound: 0,
      scores: {
        // Room A: P1 wins 2-0 in two games.
        'r0-rm1-p0-g1': 10,
        'r0-rm1-p1-g1': 5,
        'r0-rm1-p0-g2': 10,
        'r0-rm1-p1-g2': 5,
        // Room B: P4 has the bigger total, P3 wins 2-1 in three games.
        'r0-rm2-p0-g1': 1,
        'r0-rm2-p1-g1': 900,
        'r0-rm2-p0-g2': 100,
        'r0-rm2-p1-g2': 99,
        'r0-rm2-p0-g3': 100,
        'r0-rm2-p1-g3': 99,
      },
    });
    const result = advanceTournamentRound(state);
    expect(result.status).toBe('advanced');
    if (result.status !== 'advanced') return;
    expect(
      result.state.assignments[1]
        ?.map((entry) => entry.name)
        .sort((first, second) => first.localeCompare(second)),
    ).toEqual(['P1', 'P3']);
  });
});
