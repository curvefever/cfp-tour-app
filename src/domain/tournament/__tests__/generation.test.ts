import { describe, expect, it } from 'vitest';
import { finalsProgressState } from '../finals';
import { generateTournament } from '../generation';
import { addReserveUnit, setFinalScore } from '../mutations';
import { computeRankings } from '../rankings';
import { getMinimumBracketUnits } from '../schedule-generation';
import { roomPairKey } from '../seeding';
import { createDefaultSetup, createDefaultTournamentState } from '../state-defaults';
import { createTournamentRuntime } from '../runtime';
import { fixedIdSource, sequenceRandom } from './test-fixtures';

function names(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `P${index + 1}`);
}

describe('getMinimumBracketUnits', () => {
  it('returns 4 for double-elimination regardless of room size', () => {
    expect(getMinimumBracketUnits('double-elimination', { min: 6, max: 8, ideal: 8 })).toBe(4);
  });

  it('returns 2 * roomSize.ideal for single-elimination', () => {
    expect(getMinimumBracketUnits('single-elimination', { min: 2, max: 2, ideal: 2 })).toBe(4);
    expect(getMinimumBracketUnits('single-elimination', { min: 6, max: 8, ideal: 8 })).toBe(16);
  });

  it('returns 2 * roomSize.ideal for double-elimination-shared-final -- NOT the flat 4 plain double-elimination gets (exact key match, not "any double-elim variant")', () => {
    expect(getMinimumBracketUnits('double-elimination-shared-final', { min: 6, max: 8, ideal: 8 })).toBe(16);
  });

  it("returns 1 for waterfall-bracket -- the real floor is enforced precisely against the organiser's own graph, not this early generic gate", () => {
    expect(getMinimumBracketUnits('waterfall-bracket', { min: 6, max: 8, ideal: 8 })).toBe(1);
  });
});

describe('generateTournament -- validation failures', () => {
  it('refuses when no roster has been confirmed', () => {
    const state = createDefaultTournamentState({ confirmedCount: null });
    const form = createDefaultSetup();
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Load a roster first');
    }
  });

  it('refuses when confirmedCount is below the format/schedule floor', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('needs at least 16 confirmed players');
      expect(result.message).toContain('Semis is fixed at 16 players in 2 rooms of 8');
    }
  });

  it('refuses a "None" odd-count strategy when config.n and the actual bracket-entry count disagree', () => {
    // n=10 (even, passes a naive config.n check) but qualAdv clamps to 5
    // (odd) -- the number ACTUALLY entering the bracket. A validation that
    // only checked config.n would wrongly accept this.
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv: '5',
      oddCountStrategy: 'none',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('number advancing to the bracket');
      expect(result.message).toContain('must be an exact multiple of 2');
      expect(result.message).toContain('got 5');
    }
  });

  it('rejects an empty "Advance to bracket" value instead of silently defaulting to 24', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Advance to bracket');
    }
  });

  it('rejects "0" for "Advance to bracket" instead of silently defaulting to 24', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '0' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
  });

  it('rejects a negative "Advance to bracket" value', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', qualAdv: '-3' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
  });

  it('ignores qualAdv validation entirely when poolingPhase is "none"', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'none', qualAdv: '' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });
});

describe('generateTournament -- non-counting rounds', () => {
  it('flags exactly the leading N rounds excludeFromStandings for a qual-table tournament (fixed at 3 rounds)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', nonCountingRounds: '2' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // Only the first 3 rounds are the qual-table pooling phase itself --
    // the rest is the trailing single-elimination bracket phase, which
    // excludeFromStandings has no bearing on.
    expect(result.state.rounds.slice(0, 3).map((round) => Boolean(round.excludeFromStandings))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('flags exactly the leading N rounds excludeFromStandings for a Swiss tournament (n=8 -> 3 rounds)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      nonCountingRounds: '1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.slice(0, 3).map((round) => Boolean(round.excludeFromStandings))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('defaults to 0 non-counting rounds (every round counts) when the field is left blank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', nonCountingRounds: '' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.every((round) => !round.excludeFromStandings)).toBe(true);
  });

  it('rejects a negative value instead of silently clamping to 0', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', nonCountingRounds: '-1' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('Non-counting rounds');
  });

  it('rejects a value that would leave zero counting rounds (qual-table has only 3 rounds total)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', nonCountingRounds: '3' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('at least one round that counts');
      expect(result.message).toContain('Qualification Table');
    }
  });

  it('rejects a value that would leave zero counting rounds for Swiss too (n=8 -> 3 rounds)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      nonCountingRounds: '3',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('at least one round that counts');
      expect(result.message).toContain('Swiss');
    }
  });

  it('ignores non-counting-rounds validation entirely for Group Stage -- it has its own separate standings mechanism', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      nonCountingRounds: '99',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });

  it('ignores non-counting-rounds validation entirely when poolingPhase is "none"', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'none', nonCountingRounds: '99' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });
});

describe('generateTournament -- pooling round-count override', () => {
  it('overrides the qual-table pooling phase to a non-default round count', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', qualRoundsOverride: '5' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.filter((round) => round.isQual)).toHaveLength(5);
  });

  it('overrides the Swiss pooling phase to a non-default round count', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      swissRoundsOverride: '4',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.filter((round) => round.isSwiss)).toHaveLength(4);
  });

  it('defaults to the normal derived round count when the override field is left blank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', qualRoundsOverride: '' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.filter((round) => round.isQual)).toHaveLength(3);
  });

  it.each(['0', '-2', '13', 'abc'])(
    'rejects an out-of-range or non-numeric qual-table override ("%s")',
    (value) => {
      const state = createDefaultTournamentState({ confirmedCount: 20 });
      const form = createDefaultSetup({ poolingPhase: 'qual-table', qualRoundsOverride: value });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Qualification Table round count override');
      }
    },
  );

  it('is ignored (never even parsed) when poolingPhase is not qual-table/swiss', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'none', qualRoundsOverride: 'garbage' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });

  it('feeds the overridden round count into non-counting-rounds validation, not the un-overridden default', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    // Default qual-table is 3 rounds, so nonCountingRounds:'2' would normally
    // pass -- but overriding down to 2 rounds means 2 non-counting rounds
    // would leave nothing that counts.
    const tooMany = generateTournament(
      state,
      createDefaultSetup({ poolingPhase: 'qual-table', qualRoundsOverride: '2', nonCountingRounds: '2' }),
      createTournamentRuntime(),
    );
    expect(tooMany.status).toBe('invalid');
    const justRight = generateTournament(
      state,
      createDefaultSetup({ poolingPhase: 'qual-table', qualRoundsOverride: '2', nonCountingRounds: '1' }),
      createTournamentRuntime(),
    );
    expect(justRight.status).toBe('generated');
  });
});

describe('generateTournament -- Group Stage format gating', () => {
  it.each([
    ['ffa-individual', 20, 'FFA — Individual'],
    ['team-2v2v2v2', 10, '2v2v2v2'],
    ['team-3v3v3', 8, '3v3v3'],
  ] as const)(
    'refuses Group Stage for %s -- round-robin needs a head-to-head room shape',
    (gameFormat, confirmedCount, label) => {
      const state = createDefaultTournamentState({ confirmedCount });
      const form = createDefaultSetup({ gameFormat, poolingPhase: 'group-stage' });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Group Stage');
        expect(result.message).toContain(label);
      }
    },
  );

  it('still generates Group Stage successfully for a head-to-head format (individual-1v1)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 12, players: names(12) });
    const form = createDefaultSetup({ gameFormat: 'individual-1v1', poolingPhase: 'group-stage' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isGroupStage).toBe(true);
    expect(result.state.groups.length).toBeGreaterThan(0);
  });
});

describe('generateTournament -- Swiss format gating', () => {
  it.each([
    ['ffa-individual', 20, 'FFA — Individual'],
    ['team-2v2v2v2', 10, '2v2v2v2'],
    ['team-3v3v3', 8, '3v3v3'],
  ] as const)(
    'refuses Swiss for %s -- fold-pairing needs a head-to-head room shape',
    (gameFormat, confirmedCount, label) => {
      const state = createDefaultTournamentState({ confirmedCount });
      const form = createDefaultSetup({ gameFormat, poolingPhase: 'swiss' });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Swiss');
        expect(result.message).toContain(label);
      }
    },
  );

  it('still generates Swiss successfully for a head-to-head format (individual-1v1)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({ gameFormat: 'individual-1v1', poolingPhase: 'swiss' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isSwiss).toBe(true);
  });
});

describe('generateTournament -- double-elimination format/odd-count-strategy gating', () => {
  it('refuses "double-elimination" for a non-head-to-head format', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'double-elimination' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Double elimination');
      expect(result.message).toContain('FFA — Individual');
    }
  });

  it('refuses "double-elimination" combined with the "flex" odd-count strategy -- the stale UI-desync scenario (odd-count-strategy changed after schedule logic was picked)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'team-3v3',
      scheduleLogic: 'double-elimination',
      oddCountStrategy: 'flex',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Double elimination');
      expect(result.message).toContain('Flex');
    }
  });
});

describe('generateTournament -- double-elimination bracket-entry-count reachability', () => {
  it('refuses Group Stage + Double Elimination when too few qualifiers would actually reach the bracket', () => {
    // 6 players, groups of 3 (2 groups), 1 qualifier per group -> only 2
    // units would enter the bracket phase, below double-elimination's own
    // floor of 2 winners-bracket rounds (needs at least 3, floored to 4 by
    // getMinimumBracketUnits's conservative flat minimum).
    const state = createDefaultTournamentState({ confirmedCount: 6 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'group-stage',
      groupSize: '3',
      qualifiersPerGroup: '1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('double-elimination bracket');
      expect(result.message).toContain('enter the bracket phase');
    }
  });

  it('refuses a Final size override for double-elimination-shared-final that needs more WB qualifiers than would actually enter the bracket', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'double-elimination-shared-final',
      poolingPhase: 'none',
      finalOverride: '30',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('winners-bracket qualifiers');
    }
  });
});

describe('generateTournament -- double-elimination-shared-final + Group Stage / Swiss (empirical smoke check)', () => {
  // Both combinations are only UI-reachable for a head-to-head format via
  // the 'flex' odd-count strategy (team-3v3 is the only format supporting
  // it) -- flex keeps raceCompatible false (so shared-final, not the race
  // variant, is offered) while leaving Group Stage/Swiss still available
  // (both only require idealRoomSize===2, unaffected by flex). Verified
  // structurally plausible during the audit but never executed -- these
  // anchors convert "looks fine on paper" into "confirmed by running it."
  it('generates successfully: team-3v3, Group Stage + double-elimination-shared-final', () => {
    const state = createDefaultTournamentState({ confirmedCount: 12, players: names(12) });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'team-3v3',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'group-stage',
        oddCountStrategy: 'flex',
        finalOverride: '3',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isGroupStage).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'winners')).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'losers')).toBe(true);
    expect(result.state.rounds[result.state.rounds.length - 1]).toMatchObject({ isFinal: true, rooms: [3] });
  });

  it('generates successfully: team-3v3, Swiss + double-elimination-shared-final', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'team-3v3',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'swiss',
        oddCountStrategy: 'flex',
        finalOverride: '3',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds[0].isSwiss).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'winners')).toBe(true);
    expect(result.state.rounds.some((r) => r.bracket === 'losers')).toBe(true);
    expect(result.state.rounds[result.state.rounds.length - 1]).toMatchObject({ isFinal: true, rooms: [3] });
  });
});

describe('generateTournament -- elimination round-target override', () => {
  it('replaces the automatic curve for single-elimination with the exact supplied targets', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '32,24',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // 2 no-elim warmup rounds (poolingPhase 'none') + 2 explicit elimination
    // rounds + default Semis (16) + Final (8), not the automatic curve's
    // usual 4 elimination rounds.
    expect(result.state.rounds.slice(2, 4).map((round) => round.advTotal)).toEqual([32, 24]);
    expect(result.state.rounds[4]).toMatchObject({ isSemis: true, players: 16 });
    expect(result.state.rounds[5]).toMatchObject({ isFinal: true, players: 8 });
  });

  it('replaces the automatic curve for double-elimination-shared-final, respecting the winners-bracket-qualifiers floor', () => {
    const state = createDefaultTournamentState({ confirmedCount: 19 });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'double-elimination-shared-final',
        finalOverride: '8',
        eliminationRoundTargets: '16,10,6',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const winnersRounds = result.state.rounds.filter((round) => round.bracket === 'winners');
    expect(winnersRounds.map((round) => round.advTotal)).toEqual([16, 10, 6]);
  });

  it('leaves the automatic curve untouched when the field is blank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.slice(2, 6).map((round) => round.advTotal)).toEqual([30, 24, 20, 16]);
  });

  it('rejects a non-numeric entry', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '24,abc,10',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('positive whole numbers');
  });

  it('rejects an increasing sequence', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '10,24',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('must not increase');
  });

  it('accepts a plateau (a round that eliminates no one)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '32,32,24,20',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.rounds.slice(2, 6).map((round) => round.advTotal)).toEqual([32, 32, 24, 20]);
  });

  it('rejects a first target exceeding the number of units entering the bracket phase', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '999,10',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain("can't exceed");
  });

  it('rejects a last target below the Semis-size floor', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '30,10',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('must be at least');
      expect(result.message).toContain('Semis size');
    }
  });

  it('is ignored for a schedule logic it does not apply to (Kings Valley)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'kings-valley',
      eliminationRoundTargets: '999,1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });
});

describe('generateTournament -- elimination seeding-weight override', () => {
  it('stamps the parsed mode onto each WB elimination round, index-aligned with the targets list', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '32,24,20',
      eliminationSeedingOverrides: 'diversity,,balance',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // 2 no-elim warmup rounds precede the 3 explicit elimination rounds.
    expect(result.state.rounds.slice(2, 5).map((round) => round.seedingOverride)).toEqual([
      'diversity',
      undefined,
      'balance',
    ]);
  });

  it('rejects being set without elimination round targets also being set', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationSeedingOverrides: 'diversity',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('require elimination round targets');
    }
  });

  it('ignores stale seeding overrides when the schedule logic does not show the field (kings-valley, blank targets)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 23 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'kings-valley',
      eliminationSeedingOverrides: ',diversity',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
  });

  it('rejects a length mismatch against elimination round targets', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '32,24',
      eliminationSeedingOverrides: 'diversity,balance,random',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('exactly as many entries');
    }
  });

  it('rejects an invalid mode keyword', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      eliminationRoundTargets: '32,24',
      eliminationSeedingOverrides: 'diversity,chaos',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('must be blank (automatic), "diversity", "balance", or "random"');
    }
  });

  it('works for double-elimination-shared-final too, stamping only the WB rounds', () => {
    const state = createDefaultTournamentState({ confirmedCount: 19 });
    const form = {
      ...createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'double-elimination-shared-final',
        finalOverride: '8',
        eliminationRoundTargets: '16,10,6',
        eliminationSeedingOverrides: 'random,,',
      }),
      lbQualifiers: '2',
    };
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const winnersRounds = result.state.rounds.filter((round) => round.bracket === 'winners');
    expect(winnersRounds.map((round) => round.seedingOverride)).toEqual(['random', undefined, undefined]);
    expect(result.state.rounds.some((round) => round.bracket === 'losers' && round.seedingOverride)).toBe(
      false,
    );
  });
});

describe('generateTournament -- positional-points scoring', () => {
  it('ignores a stale positional-points selection when poolingPhase is "none" (its Setup field is hidden)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37 });
    const form = createDefaultSetup({
      poolingPhase: 'none',
      scoring: 'positional-points',
      positionalPointsTable: 'abc',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.scoring).toBe('fairpoints');
    expect(result.state.gamemodeConfig.positionalPointsTable).toBeUndefined();
  });

  it('rejects a blank points table', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', scoring: 'positional-points' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('rank-to-points table');
  });

  it('rejects a non-numeric entry', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      poolingPhase: 'qual-table',
      scoring: 'positional-points',
      positionalPointsTable: '10,8,abc,5,4,3,2,1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('non-negative whole numbers');
  });

  it('rejects a table that increases from rank to rank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      poolingPhase: 'qual-table',
      scoring: 'positional-points',
      positionalPointsTable: '10,8,9,5,4,3,2,1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('must not increase');
  });

  it("rejects a table shorter than the format's largest possible room size", () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      poolingPhase: 'qual-table',
      scoring: 'positional-points',
      positionalPointsTable: '10,8,6,5,4',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('needs at least 8 entries');
  });

  it('accepts a valid table and wires it into gamemodeConfig alongside the scoring system', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      poolingPhase: 'qual-table',
      scoring: 'positional-points',
      positionalPointsTable: '10,8,6,5,4,3,2,1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.scoring).toBe('positional-points');
    expect(result.state.gamemodeConfig.positionalPointsTable).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
  });

  it('defaults to fairpoints scoring with no positionalPointsTable when the field is left blank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.scoring).toBe('fairpoints');
    expect(result.state.gamemodeConfig.positionalPointsTable).toBeUndefined();
  });
});

describe('generateTournament -- fixed draw publication', () => {
  it('ignores a stale fixed draw publication when poolingPhase is "none", storing "adaptive" so reserves are not blocked by it', () => {
    const state = createDefaultTournamentState({ confirmedCount: 23, players: names(23) });
    const form = createDefaultSetup({ poolingPhase: 'none', drawPublication: 'fixed' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.drawPublication).toBe('adaptive');
    // reserveOpen forced on so addReserveUnit reaches its fixed-draw check.
    expect(addReserveUnit({ ...result.state, reserveOpen: true }, 'Reserve 1')).not.toMatchObject({
      status: 'blocked',
      reason: 'fixed-draw',
    });
  });

  it('ignores a stale fixed draw publication when poolingPhase is "group-stage" (its Setup field is hidden)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 30, players: names(30) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      drawPublication: 'fixed',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.drawPublication).toBe('adaptive');
  });

  it('qual-table: assigns round 0 from the fixed schedule, leaves round 1 unassigned in state.assignments but pre-computed on the round itself, and folds roomHistory/poolingByeCounts upfront', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20, players: names(20) });
    const form = createDefaultSetup({ poolingPhase: 'qual-table', drawPublication: 'fixed' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const { state: generated } = result;

    expect(generated.gamemodeConfig.drawPublication).toBe('fixed');
    expect(generated.rounds[0].fixedRoomAssignments).toBeDefined();
    expect(generated.assignments[0]).toEqual(generated.rounds[0].fixedRoomAssignments);

    // Round 1 has NOT been "reached" (state.assignments) even though its
    // draw is already fully decided (round.fixedRoomAssignments).
    expect(generated.assignments[1]).toBeUndefined();
    expect(generated.rounds[1].fixedRoomAssignments).toBeDefined();
    expect(generated.rounds[1].fixedRoomAssignments?.length).toBeGreaterThan(0);

    // roomHistory already reflects rounds beyond 0 -- more pairs recorded
    // than round 0 alone could ever produce.
    const round0Rooms = new Map<number, string[]>();
    for (const entry of generated.rounds[0].fixedRoomAssignments ?? []) {
      if (entry.room === null) continue;
      round0Rooms.set(entry.room, [...(round0Rooms.get(entry.room) ?? []), entry.name]);
    }
    let round0PairCount = 0;
    for (const members of round0Rooms.values()) {
      round0PairCount += (members.length * (members.length - 1)) / 2;
    }
    expect(Object.keys(generated.roomHistory).length).toBeGreaterThan(round0PairCount);
  });

  it('swiss: same round-0-only-assignment behavior, and pairingTBD is cleared since pairings are no longer live-determined', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'swiss',
      drawPublication: 'fixed',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const { state: generated } = result;

    expect(generated.assignments[0]).toEqual(generated.rounds[0].fixedRoomAssignments);
    expect(generated.assignments[1]).toBeUndefined();
    expect(generated.rounds[1].fixedRoomAssignments).toBeDefined();
    expect(generated.rounds.filter((round) => round.isSwiss).every((round) => !round.pairingTBD)).toBe(true);
  });

  it('defaults to adaptive draw publication when the field is left blank', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({ poolingPhase: 'qual-table' });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    expect(result.state.gamemodeConfig.drawPublication).toBe('adaptive');
    expect(result.state.rounds[0].fixedRoomAssignments).toBeUndefined();
  });
});

describe('generateTournament -- Stage B numeric-input robustness', () => {
  it('refuses a negative Semis size override', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      semisOverride: '-5',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Semis size override');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a negative Final size override', () => {
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      finalOverride: '-3',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a Final size override exceeding the derived default Semis size when no Semis override is set', () => {
    // ffa-individual's default Semis size is 2 * roomSize.ideal = 16.
    const state = createDefaultTournamentState({ confirmedCount: 20 });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      finalOverride: '20',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Final size override');
      expect(result.message).toContain('default Semis size');
    }
  });

  it('refuses a Group size exceeding the upper bound', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      groupSize: '10',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Group size');
      expect(result.message).toContain("can't exceed");
    }
  });

  it('refuses a negative Qualifiers per group', () => {
    const state = createDefaultTournamentState({ confirmedCount: 10 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase: 'group-stage',
      qualifiersPerGroup: '-1',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Qualifiers per group');
      expect(result.message).toContain('positive');
    }
  });

  it('refuses a negative Grand Final win target', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16 });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      grandFinalWbTarget: '-2',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('Grand Final win targets');
      expect(result.message).toContain('positive');
    }
  });
});

describe('generateTournament -- round-0 seeding', () => {
  it('seeds round 0 via randomSeed with the injected RandomSource, exact assignment', () => {
    const state = createDefaultTournamentState({ confirmedCount: 4, players: names(4) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'none',
    });
    const runtime = createTournamentRuntime({
      random: sequenceRandom([0, 0, 0]),
      ids: fixedIdSource(),
    });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // Fisher-Yates on [P1,P2,P3,P4] with next() always 0: swap(3,0)->[P4,P2,P3,P1],
    // swap(2,0)->[P3,P2,P4,P1], swap(1,0)->[P2,P3,P4,P1]. Rooms [2,2] fill
    // sequentially: room1=[P2,P3], room2=[P4,P1].
    expect(result.state.assignments[0]).toEqual([
      { name: 'P2', room: 1, isLucky: false },
      { name: 'P3', room: 1, isLucky: false },
      { name: 'P4', room: 2, isLucky: false },
      { name: 'P1', room: 2, isLucky: false },
    ]);
    expect(result.state.tournamentId).toBe('test-tournament-id');
    // Round 0's assignment must be recorded into roomHistory at generation
    // time -- otherwise the first live transition runs tieredSeed against an
    // empty history and fails to diversify rooms (see qual-table bug fix).
    expect(result.state.roomHistory).toEqual({
      [roomPairKey('P2', 'P3')]: 0,
      [roomPairKey('P4', 'P1')]: 0,
    });
  });

  it('benches the first roster-order player under the Bye odd-count strategy, deterministically', () => {
    const state = createDefaultTournamentState({ confirmedCount: 5, players: names(5) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'bye',
    });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.1, 0.2, 0.3]) });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // The first bye recipient is always roster-order position 0 (P1),
    // independent of the random source -- randomSeed only shuffles the
    // remaining players, the bye pick itself is positional.
    expect(result.state.byes[0]).toEqual(['P1']);
    expect(result.state.poolingByeCounts.P1).toBe(1);
    const byeEntry = result.state.assignments[0].find((a) => a.name === 'P1');
    expect(byeEntry).toEqual({ name: 'P1', room: null, isLucky: false });
    const seatedNames = result.state.assignments[0]
      .filter((a) => a.room !== null)
      .map((a) => a.name)
      .sort();
    expect(seatedNames).toEqual(['P2', 'P3', 'P4', 'P5']);
  });
});

describe('generateTournament -- end-to-end anchors', () => {
  it('FFA 37 players, single-elimination, default pooling: reproduces the known sweep-table shape', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37, players: names(37) });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'single-elimination' });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.37]), ids: fixedIdSource() });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const rounds = result.state.rounds;
    // 2 no-elim warmup rounds (poolingPhase 'none') + 4 elimination rounds
    // (the [30,24,20,16] anchor, confirmed in Stage 1's single-elimination.test.ts)
    // + 1 Semis + 1 Final = 8.
    expect(rounds).toHaveLength(8);
    expect(rounds[0]).toMatchObject({ roundNum: 1, isNoElim: true, players: 37, advTotal: 37 });
    expect(rounds[1]).toMatchObject({ roundNum: 2, isNoElim: true, players: 37, advTotal: 37 });
    expect(rounds.slice(2, 6).map((r) => r.advTotal)).toEqual([30, 24, 20, 16]);
    expect(rounds.slice(2, 6).every((r) => !r.isNoElim && !r.isQual && !r.isFinal)).toBe(true);
    expect(rounds[6].isSemis).toBe(true);
    expect(rounds[7]).toMatchObject({ isFinal: true, rooms: [8] });
    // Every roster name seeded into round 0 exactly once.
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(37).sort());
    expect(result.state.qualTable).toHaveLength(37);
    expect(result.state.groupStandings).toEqual({});
  });

  it('individual-1v1, 16 players, double-elimination: WB/LB/grand-final shape composes correctly', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16, players: names(16) });
    const form = createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'double-elimination',
      poolingPhase: 'none',
      oddCountStrategy: 'none',
    });
    const runtime = createTournamentRuntime({ random: sequenceRandom([0.16]), ids: fixedIdSource() });
    const result = generateTournament(state, form, runtime);
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const rounds = result.state.rounds;
    expect(rounds[0].isNoElim).toBe(true);
    expect(rounds[1].isNoElim).toBe(true);
    const winnersRounds = rounds.filter((r) => r.bracket === 'winners');
    const losersRounds = rounds.filter((r) => r.bracket === 'losers');
    const grandFinal = rounds[rounds.length - 1];
    // nextPowerOf2AndRounds(16) -> 4 WB rounds; losers = 2*4-2 = 6 (both
    // confirmed directly in Stage 2's double-elimination.test.ts).
    expect(winnersRounds).toHaveLength(4);
    expect(losersRounds).toHaveLength(6);
    expect(grandFinal).toMatchObject({ bracket: 'grand-final', numGames: 1, isFinal: true });
    expect(rounds).toHaveLength(2 + 4 + 6 + 1);
    // 16 is an exact power of 2 at roomSize.ideal=2 -- no byes needed anywhere.
    expect(winnersRounds[0].byeCount).toBe(0);
    expect(result.state.gamemodeConfig.lbQualifiers).toBeUndefined();
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(16).sort());
  });
});

describe('generateTournament -- kings-valley', () => {
  it('generates successfully (no longer rejected as "not available yet") and ends in a Final', () => {
    const state = createDefaultTournamentState({ confirmedCount: 37, players: names(37) });
    const form = createDefaultSetup({ gameFormat: 'ffa-individual', scheduleLogic: 'kings-valley' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    // Default poolingPhase is 'none' -- a fixed 2-round no-elim warmup precedes
    // the Kings Valley phase, matching every other schedule logic's convention.
    expect(result.state.rounds[2].isKingsValley).toBe(true);
    expect(result.state.rounds[result.state.rounds.length - 1].isFinal).toBe(true);
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(37).sort());
  });

  it('generates for a head-to-head format too (no compatibility gate)', () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({ gameFormat: 'individual-1v1', scheduleLogic: 'kings-valley' });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
  });
});

describe('generateTournament -- waterfall-bracket', () => {
  // The exact structure traced cell-by-cell from the real organiser
  // spreadsheet ("Matches 40p" tab) that this whole feature was built
  // against -- see waterfall-bracket.test.ts for the parser/validator/builder
  // unit coverage of this same graph; this describe block only checks that
  // generateTournament threads form.waterfallGraph through correctly.
  const SPREADSHEET_GRAPH = `
ROUNDS:
5 = 4x8
6B = 8
6C = 8
7A = 8
SemiA = 8
SemiB = 8
Final = 8 FINAL

ROUTES:
5.A: 1-4->SemiA, 5,8->6B, 6,7->6C
5.B: 1-4->SemiA, 6,7->6B, 5,8->6C
5.C: 1,4->6C, 2,3->6B, 5-8->eliminated
5.D: 1,4->6B, 2,3->6C, 5-8->eliminated
SemiA: 1-4->Final, 5-8->SemiB
6B: 1-4->7A, 5-8->eliminated
6C: 1-4->7A, 5-8->eliminated
7A: 1-4->SemiB, 5-8->eliminated
SemiB: 1-4->Final, 5-8->eliminated
`;

  it('generates the worked spreadsheet example end-to-end', () => {
    const state = createDefaultTournamentState({ confirmedCount: 32, players: names(32) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: SPREADSHEET_GRAPH,
    });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const rounds = result.state.rounds;
    // Default poolingPhase is 'none' -- a fixed 2-round no-elim warmup
    // precedes the waterfall phase, matching every other schedule logic.
    expect(rounds[0].isNoElim).toBe(true);
    expect(rounds[1].isNoElim).toBe(true);
    expect(rounds.slice(2).map((round) => round.customLabel)).toEqual([
      '5',
      'SemiA',
      '6B',
      '6C',
      '7A',
      'SemiB',
      'Final',
    ]);
    expect(rounds.slice(2).every((round) => round.isWaterfall)).toBe(true);
    expect(rounds[2].rooms).toEqual([8, 8, 8, 8]);
    expect(rounds[rounds.length - 1]).toMatchObject({ isFinal: true, customLabel: 'Final' });
    // Round 5's rooms route absolutely: 5.A ranks 1-4 skip straight to
    // SemiA (array index 3, several rounds before 6B/6C/7A finish feeding
    // SemiB) -- the genuine skip-ahead case this whole feature exists for.
    expect(rounds[2].waterfallRoutes?.[0]).toEqual([3, 3, 3, 3, 4, 5, 5, 4]);
    expect(result.state.assignments[0].map((a) => a.name).sort()).toEqual(names(32).sort());
  });

  it("rejects a malformed graph with the parser's own specific error", () => {
    const state = createDefaultTournamentState({ confirmedCount: 8, players: names(8) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: 'ROUNDS:\n5 = 8 FINAL\nROUTES:\n5 1-8->eliminated',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('missing ":"');
  });

  it('rejects a graph whose entry total does not match the real entrant count', () => {
    const state = createDefaultTournamentState({ confirmedCount: 30, players: names(30) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: SPREADSHEET_GRAPH, // declares 32, but only 30 are confirmed
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.message).toContain('must match exactly');
  });

  it('tells the organiser where to write the graph when the box is empty or whitespace-only', () => {
    const state = createDefaultTournamentState({ confirmedCount: 32, players: names(32) });
    for (const emptyGraph of ['', '  \n  ']) {
      const form = createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'waterfall-bracket',
        waterfallGraph: emptyGraph,
      });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(result.message).toContain('Waterfall bracket graph');
        expect(result.message).toContain('example');
        expect(result.message).not.toContain('No ROUNDS: section found');
      }
    }
  });

  it('says which rooms still have no routing when the graph has rounds but no routes yet', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16, players: names(16) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      waterfallGraph: 'ROUNDS:\nR1 = 2x8\nFinal = 8 FINAL\n\nROUTES:',
    });
    const result = generateTournament(state, form, createTournamentRuntime());
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.message).toContain('has no ROUTES line');
      expect(result.message).not.toContain('No ROUTES: section found');
    }
  });

  // The exact configuration an organiser reported failing: 24 FFA players,
  // fixed-draw qualification table with 1 non-counting round, 16 advancing,
  // a 3-game Final -- with a 16-entrant repechage graph written for it.
  const REPECHAGE_GRAPH = `
ROUNDS:
R1 = 2x8
SemiB = 8
Final = 8 FINAL

ROUTES:
R1.A: 1-3->Final, 4-7->SemiB, 8->eliminated
R1.B: 1-3->Final, 4-7->SemiB, 8->eliminated
SemiB: 1-2->Final, 3-8->eliminated
`;

  it("applies the Finals format to the waterfall Final, in the organiser's reported configuration", () => {
    const state = createDefaultTournamentState({ confirmedCount: 24, players: names(24) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'qual-table',
      drawPublication: 'fixed',
      qualAdv: '16',
      nonCountingRounds: '1',
      finalsGames: '3',
      waterfallGraph: REPECHAGE_GRAPH,
    });
    const result = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(result.status).toBe('generated');
    if (result.status !== 'generated') return;
    const finalRound = result.state.rounds[result.state.rounds.length - 1];
    expect(finalRound).toMatchObject({ isFinal: true, customLabel: 'Final', numGames: 3 });
  });

  it('a generated waterfall Final needs all of its games scored before it counts as complete', () => {
    const state = createDefaultTournamentState({ confirmedCount: 16, players: names(16) });
    const form = createDefaultSetup({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'waterfall-bracket',
      finalsGames: '2',
      waterfallGraph: `
ROUNDS:
R1 = 2x8
Final = 8 FINAL

ROUTES:
R1.A: 1-4->Final, 5-8->eliminated
R1.B: 1-4->Final, 5-8->eliminated
`,
    });
    const generated = generateTournament(state, form, createTournamentRuntime({ ids: fixedIdSource() }));
    expect(generated.status).toBe('generated');
    if (generated.status !== 'generated') return;
    const finalIndex = generated.state.rounds.length - 1;
    const finalists = names(16).slice(0, 8);
    let live = {
      ...generated.state,
      curRound: finalIndex,
      // state.assignments only has entries for rounds already reached, so pad
      // it out to the Final's own index rather than mapping over what exists.
      assignments: Array.from({ length: finalIndex + 1 }, (_, index) =>
        index === finalIndex
          ? finalists.map((name) => ({ name, room: 1, isLucky: false }))
          : (generated.state.assignments[index] ?? []),
      ),
    };
    expect(finalsProgressState(live, finalIndex, live.rounds[finalIndex]).complete).toBe(false);
    expect(computeRankings(live)?.finalComplete).toBe(false);

    for (const name of finalists) live = setFinalScore(live, `game1-${name}`, 10);
    expect(finalsProgressState(live, finalIndex, live.rounds[finalIndex]).complete).toBe(false);
    expect(computeRankings(live)?.finalComplete).toBe(false);

    for (const name of finalists) live = setFinalScore(live, `game2-${name}`, 5);
    expect(finalsProgressState(live, finalIndex, live.rounds[finalIndex]).complete).toBe(true);
    expect(computeRankings(live)?.finalComplete).toBe(true);
  });

  it.each([
    ['a valid graph', SPREADSHEET_GRAPH],
    ['a graph that does not parse', 'ROUNDS:\nnonsense'],
  ])(
    'ignores leftover waterfall-graph text (%s) when a different schedule logic is selected',
    (_label, graph) => {
      const state = createDefaultTournamentState({ confirmedCount: 37, players: names(37) });
      const form = createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        waterfallGraph: graph,
      });
      const result = generateTournament(state, form, createTournamentRuntime());
      expect(result.status).toBe('generated');
      if (result.status !== 'generated') return;
      expect(result.state.gamemodeConfig.graph).toBeUndefined();
      expect(result.state.gamemodeConfig).not.toHaveProperty('waterfallGraph');
    },
  );
});
