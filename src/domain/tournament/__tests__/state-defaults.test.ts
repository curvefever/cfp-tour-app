import { describe, expect, it } from 'vitest';
import { generateTournament } from '../generation';
import { createDefaultSetup, createDefaultTournamentState, newTournamentSetup } from '../state-defaults';
import { generatedState, rosterFor, testRuntime } from './test-fixtures';

describe('createDefaultSetup', () => {
  // It fills the keys a stored setup lacks, so these may not move with the defaults of a new tournament.
  it('keeps the values stored tournaments are read with', () => {
    expect(createDefaultSetup()).toMatchObject({
      poolingPhase: 'none',
      poolingDefaultsVersion: '',
      qualAdv: '24',
      qualRoundsOverride: '',
      swissRoundsOverride: '',
      nonCountingRounds: '0',
    });
  });
});

describe('newTournamentSetup', () => {
  it('is a qualification table with every number left to the app, under the app rule', () => {
    expect(newTournamentSetup()).toEqual(
      createDefaultSetup({
        poolingPhase: 'qual-table',
        poolingDefaultsVersion: '1',
        qualAdv: '',
        nonCountingRounds: '',
      }),
    );
  });

  it('generates as it stands at 37: 4 table rounds, 1 not counted, 28 in the bracket', () => {
    const state = createDefaultTournamentState({
      confirmedCount: 37,
      players: rosterFor('ffa-individual', 37),
    });
    const generated = generatedState(generateTournament(state, newTournamentSetup(), testRuntime()));
    const table = generated.rounds.filter((round) => round.isQual);
    expect(table.map((round) => round.excludeFromStandings === true)).toEqual([true, false, false, false]);
    expect(generated.cfg.qualAdv).toBe(28);
  });
});
