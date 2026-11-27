import { describe, expect, it } from 'vitest';
import {
  createDefaultSetup,
  createDefaultTournamentState,
  newTournamentSetup,
} from '../../../domain/tournament/state-defaults';
import { setupDerived } from './setup-derived';

describe('setupDerived: the pooling rounds "Non-counting rounds" counts from', () => {
  const state = createDefaultTournamentState({ confirmedCount: 37 });
  const roundsOf = (setup: Parameters<typeof createDefaultSetup>[0]) =>
    setupDerived(createDefaultSetup(setup), state, '2').totalPoolingRounds;

  it('follows a typed override of a qualification table and of a Swiss', () => {
    expect(setupDerived(newTournamentSetup(), state, '2').totalPoolingRounds).toBe(4);
    expect(roundsOf({ gameFormat: 'individual-1v1', poolingPhase: 'swiss', swissRoundsOverride: '5' })).toBe(
      5,
    );
  });

  it('is the app’s own number while the override is empty', () => {
    // A table of 3; a Swiss of 37 takes 6.
    expect(roundsOf({ poolingPhase: 'qual-table' })).toBe(3);
    expect(roundsOf({ gameFormat: 'individual-1v1', poolingPhase: 'swiss' })).toBe(6);
  });

  it('is 0 for a pooling phase with no such field', () => {
    expect(roundsOf({ poolingPhase: 'none' })).toBe(0);
    expect(roundsOf({ gameFormat: 'individual-1v1', poolingPhase: 'group-stage' })).toBe(0);
  });
});
