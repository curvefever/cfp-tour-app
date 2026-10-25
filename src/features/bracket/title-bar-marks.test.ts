import { describe, expect, it } from 'vitest';
import { buildRound } from '../../domain/tournament/__tests__/test-fixtures';
import { isFinalComplete } from '../../domain/tournament/rankings';
import { createDefaultInfo, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentInfo, TournamentRound } from '../../domain/tournament/types';
import { hasRoundNotes, roundProgress, showsNowPill, sumProgress } from './title-bar-marks';

const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'];

/** Round 1 (rooms of 4 and 3, room A scored) then a 1-game Final of P1 and P2. */
interface Options {
  atFinal?: boolean;
  finalScores?: Record<string, number>;
  final?: Partial<TournamentRound>;
}

function twoRounds({ atFinal = false, finalScores = {}, final = {} }: Options = {}) {
  return createDefaultTournamentState({
    gameFormat: 'ffa-individual',
    players: names,
    curRound: atFinal ? 1 : 0,
    rounds: [
      buildRound({ roundNum: 1, rooms: [4, 3], players: 7, advPerRoom: 1 }),
      buildRound({ roundNum: 2, rooms: [2], players: 2, isFinal: true, numGames: 1, ...final }),
    ],
    assignments: [
      names.map((name, index) => ({ name, room: index < 4 ? 1 : 2, isLucky: false })),
      atFinal
        ? [
            { name: 'P1', room: 1, isLucky: false },
            { name: 'P5', room: 1, isLucky: false },
          ]
        : [],
    ],
    scores: { 'r0-rm1-p0': 40, 'r0-rm1-p1': 30, 'r0-rm1-p2': 20, 'r0-rm1-p3': 10 },
    finalScores,
  });
}

describe('showsNowPill', () => {
  it('marks the round in play and no other', () => {
    const state = twoRounds();
    expect(showsNowPill(state, 0, isFinalComplete(state))).toBe(true);
    expect(showsNowPill(state, 1, isFinalComplete(state))).toBe(false);
  });

  it('keeps NOW on the Final while it is being played', () => {
    const state = twoRounds({ atFinal: true, finalScores: { 'game1-P1': 50 } });
    expect(showsNowPill(state, 1, isFinalComplete(state))).toBe(true);
  });

  it('drops NOW once the Final is complete', () => {
    const state = twoRounds({ atFinal: true, finalScores: { 'game1-P1': 50, 'game1-P5': 80 } });
    expect(isFinalComplete(state)).toBe(true);
    expect(showsNowPill(state, 1, isFinalComplete(state))).toBe(false);
  });
});

describe('roundProgress', () => {
  it('counts the rooms of the round in play for an editable Bracket', () => {
    expect(roundProgress(twoRounds(), 0, true)).toEqual({ scored: 1, total: 2 });
  });

  it('is null for a view that is not editable (a viewer)', () => {
    expect(roundProgress(twoRounds(), 0, false)).toBeNull();
  });

  it('is null for a round outside the column in play', () => {
    const atFinal = twoRounds({ atFinal: true });
    expect(roundProgress(atFinal, 0, true)).toBeNull();
    expect(roundProgress(twoRounds(), 1, true)).toBeNull();
  });

  it('is null for the Final in play', () => {
    expect(roundProgress(twoRounds({ atFinal: true }), 1, true)).toBeNull();
  });

  it('is null for the race Grand Final in play', () => {
    const raceFinal: Partial<TournamentRound> = { bracket: 'grand-final', wbFinalistName: 'P1' };
    expect(roundProgress(twoRounds({ atFinal: true, final: raceFinal }), 1, true)).toBeNull();
  });
});

describe('sumProgress', () => {
  it('adds the rounds in play of a wave box together', () => {
    expect(sumProgress([{ scored: 1, total: 4 }, null, { scored: 2, total: 2 }])).toEqual({
      scored: 3,
      total: 6,
    });
  });

  it('is null when no round of the box is in play', () => {
    expect(sumProgress([null, null])).toBeNull();
  });
});

describe('hasRoundNotes', () => {
  const withNotes = (roundNotes: TournamentInfo['roundNotes']) => ({
    ...twoRounds(),
    info: { ...createDefaultInfo(), roundNotes },
  });

  it('is false without notes', () => {
    expect(hasRoundNotes(twoRounds())).toBe(false);
    expect(hasRoundNotes(withNotes(undefined))).toBe(false);
  });

  it("is true when a round has a note of its own, by the round's name", () => {
    expect(hasRoundNotes(withNotes({ Final: 'Target score: high' }))).toBe(true);
    expect(hasRoundNotes(withNotes({ 'Round 1': 'Powers: Ghost' }))).toBe(true);
  });

  it('is false when the notes belong to no round of this tournament, or are blank', () => {
    expect(hasRoundNotes(withNotes({ 'Round 9': 'x' }))).toBe(false);
    expect(hasRoundNotes(withNotes({ Final: '   ' }))).toBe(false);
  });

  it('ignores the stage notes of an earlier build', () => {
    const old = { stages: { final: 'x' }, rounds: { Final: 'y' } } as unknown as TournamentInfo['roundNotes'];
    expect(hasRoundNotes(withNotes(old))).toBe(false);
  });
});
