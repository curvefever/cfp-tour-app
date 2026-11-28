import { describe, expect, it } from 'vitest';
import { getGameFormat } from '../../../domain/tournament/formats';
import { poolingRoundsOf } from '../../../domain/tournament/pooling-rounds';
import { createDefaultSetup, newTournamentSetup } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import {
  isHeadToHead,
  isRaceCompatible,
  leavesHeadToHeadPooling,
  reconcileScheduleLogicForFormat,
  setupAfterFormatChange,
  setupAfterOddCountChange,
  setupAfterPoolingChange,
  setupAfterScoringChange,
} from './format-change-rules';

const form = (overrides: Partial<PersistedSetup> = {}) => createDefaultSetup(overrides);

const ONE_V_ONE = { gameFormat: 'individual-1v1', oddCountStrategy: 'bye' } as const;
const TWO_TEAMS = {
  gameFormat: 'team-2v2',
  oddCountStrategy: 'bye',
  teamScoringRule: 'sum-members',
} as const;

/** The format change as the panel makes it when nothing moved between the render and the click. */
const toFormat = (start: PersistedSetup, value: PersistedSetup['gameFormat']) =>
  setupAfterFormatChange(start, value, start.poolingPhase);

const FFA = getGameFormat('ffa-individual');
const HEAD_TO_HEAD = getGameFormat('individual-1v1');

describe('the head-to-head questions', () => {
  it('an unknown format is not head-to-head', () => {
    expect(isHeadToHead(HEAD_TO_HEAD)).toBe(true);
    expect(isHeadToHead(FFA)).toBe(false);
    expect(isHeadToHead(undefined)).toBe(false);
  });

  it('the race double elimination needs head-to-head rooms without Flex', () => {
    expect(isRaceCompatible(HEAD_TO_HEAD, 'flex')).toBe(false);
    expect(isRaceCompatible(HEAD_TO_HEAD, 'bye')).toBe(true);
    expect(isRaceCompatible(FFA, 'bye')).toBe(false);
  });

  it.each([
    ['swiss', FFA, true],
    ['group-stage', FFA, true],
    ['swiss', HEAD_TO_HEAD, false],
    ['group-stage', HEAD_TO_HEAD, false],
    ['qual-table', FFA, false],
  ] as const)('a %s pooling phase has to go: %#', (poolingPhase, format, expected) => {
    expect(leavesHeadToHeadPooling(poolingPhase, format)).toBe(expected);
  });
});

describe('reconcileScheduleLogicForFormat', () => {
  it.each([
    ['double-elimination', true, true, 'double-elimination'],
    ['double-elimination', false, true, 'single-elimination'],
    ['double-elimination-shared-final', true, true, 'single-elimination'],
    ['double-elimination-shared-final', false, false, 'double-elimination-shared-final'],
    ['kings-valley', false, true, 'single-elimination'],
    ['kings-valley', false, false, 'kings-valley'],
    ['upper-lower', false, true, 'upper-lower'],
  ] as const)('%s, race %s, head-to-head %s', (current, raceCompatible, headToHeadOnly, expected) => {
    expect(reconcileScheduleLogicForFormat(current, raceCompatible, headToHeadOnly)).toBe(expected);
  });
});

describe('setupAfterFormatChange', () => {
  it('FFA to 1v1 takes the format and its default odd-count strategy', () => {
    const start = form();
    expect(toFormat(start, 'individual-1v1')).toEqual({ ...start, ...ONE_V_ONE });
  });

  it('1v1 to FFA clears the odd-count strategy', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'qual-table', scoring: 'positional-points' });
    expect(toFormat(start, 'ffa-individual')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
    });
  });

  it.each(['swiss', 'group-stage'] as const)(
    '1v1 with %s to FFA takes a qualification table with its usual values',
    (poolingPhase) => {
      const start = form({ ...ONE_V_ONE, poolingPhase, scoring: 'match-results' });
      expect(toFormat(start, 'ffa-individual')).toEqual({
        ...start,
        gameFormat: 'ffa-individual',
        oddCountStrategy: '',
        poolingPhase: 'qual-table',
        qualRoundsOverride: '4',
        nonCountingRounds: '1',
        scoring: 'fairpoints',
      });
    },
  );

  it.each([
    [ONE_V_ONE, 'double-elimination', 'ffa-individual'],
    [{}, 'double-elimination-shared-final', 'individual-1v1'],
    [{}, 'kings-valley', 'individual-1v1'],
  ] as const)('from %o with %s to %s falls back to single elimination', (from, scheduleLogic, value) => {
    expect(toFormat(form({ ...from, scheduleLogic }), value).scheduleLogic).toBe('single-elimination');
  });

  it('sets, keeps and clears the team scoring', () => {
    expect(toFormat(form(), 'team-2v2v2v2').teamScoringRule).toBe('sum-members');
    const fours = form({ gameFormat: 'team-2v2v2v2', teamScoringRule: 'survival-teams' });
    expect(toFormat(fours, 'team-2v2').teamScoringRule).toBe('survival-teams');
    expect(toFormat(fours, 'ffa-individual').teamScoringRule).toBe('');
  });

  it.each([
    ['', '100'],
    ['55', '55'],
  ])('with Match results, a tie margin of "%s" becomes "%s" in 4v4', (tieMargin, expected) => {
    const start = form({ ...TWO_TEAMS, poolingPhase: 'qual-table', scoring: 'match-results', tieMargin });
    expect(toFormat(start, 'team-4v4')).toEqual({ ...start, gameFormat: 'team-4v4', tieMargin: expected });
  });

  it('decides the scoring by the rendered pooling phase and writes the pooling phase from the form', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'group-stage', scoring: 'match-results' });
    // The panel still showed the qualification table: the scoring is judged against the form's group stage.
    expect(setupAfterFormatChange(start, 'ffa-individual', 'qual-table')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
      poolingPhase: 'qual-table',
      qualRoundsOverride: '4',
      nonCountingRounds: '1',
      scoring: 'match-results',
    });
  });
});

/** The pooling phase and the three fields a change of it can write. */
const poolingFields = (setup: PersistedSetup) => ({
  poolingPhase: setup.poolingPhase,
  qualRounds: setup.qualRoundsOverride,
  swissRounds: setup.swissRoundsOverride,
  nonCounting: setup.nonCountingRounds,
});

describe('the pooling phase across the head-to-head line, from a new tournament', () => {
  const oneVOne = toFormat(newTournamentSetup(), 'individual-1v1');

  /** What the fields come to for a field of 37. */
  const played = (setup: PersistedSetup) => {
    const { rounds, nonCounting } = poolingRoundsOf(setup, 37);
    return [rounds.value, nonCounting.value, rounds.typed || nonCounting.typed];
  };

  it('FFA to 1v1: a Swiss with no number typed, which is 5 rounds, all counted', () => {
    expect(poolingFields(oneVOne)).toEqual({
      poolingPhase: 'swiss',
      qualRounds: '',
      swissRounds: '',
      nonCounting: '',
    });
    expect(played(oneVOne)).toEqual([5, 0, false]);
    expect(oneVOne.qualAdv).toBe('');
  });

  it('and back to FFA: a qualification table of 4 rounds, the first not counted', () => {
    const back = toFormat(oneVOne, 'ffa-individual');
    expect(poolingFields(back)).toEqual({
      poolingPhase: 'qual-table',
      qualRounds: '',
      swissRounds: '',
      nonCounting: '',
    });
    expect(played(back)).toEqual([4, 1, false]);
  });

  it('empties typed uncounted rounds when the format change switches the phase, and keeps the round counts', () => {
    const start = { ...newTournamentSetup(), qualRoundsOverride: '6', nonCountingRounds: '2' };
    expect(poolingFields(toFormat(start, 'individual-1v1'))).toEqual({
      poolingPhase: 'swiss',
      qualRounds: '6',
      swissRounds: '',
      nonCounting: '',
    });
  });

  it('a 1v1 Group Stage stays one in 2v2, with the fields untouched', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'group-stage', nonCountingRounds: '2' });
    expect(poolingFields(toFormat(start, 'team-2v2'))).toEqual(poolingFields(start));
  });

  it('a qualification table stays one between two head-to-head formats', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'qual-table', qualRoundsOverride: '7' });
    expect(poolingFields(toFormat(start, 'team-2v2'))).toEqual(poolingFields(start));
  });

  it('no pooling phase stays none', () => {
    expect(toFormat(form(), 'individual-1v1').poolingPhase).toBe('none');
    expect(toFormat(form(ONE_V_ONE), 'ffa-individual').poolingPhase).toBe('none');
  });
});

describe('setupAfterPoolingChange', () => {
  it('puts in the usual values of each phase chosen, over what was typed', () => {
    const typed = form({ ...ONE_V_ONE, qualRoundsOverride: '7', nonCountingRounds: '3' });
    const table = setupAfterPoolingChange(typed, 'qual-table');
    expect(table).toEqual({
      ...typed,
      poolingPhase: 'qual-table',
      qualRoundsOverride: '4',
      nonCountingRounds: '1',
    });
    const swiss = setupAfterPoolingChange({ ...table, qualRoundsOverride: '6' }, 'swiss');
    expect(poolingFields(swiss)).toMatchObject({ swissRounds: '5', nonCounting: '0' });
    expect(poolingFields(setupAfterPoolingChange(swiss, 'qual-table'))).toMatchObject({
      qualRounds: '4',
      nonCounting: '1',
    });
  });

  it.each(['qual-table', 'swiss', 'none', 'group-stage'] as const)(
    'under the app rule, %s types nothing and empties the uncounted rounds',
    (poolingPhase) => {
      const start = form({
        ...ONE_V_ONE,
        poolingDefaultsVersion: '1',
        poolingPhase: 'swiss',
        qualRoundsOverride: '7',
        swissRoundsOverride: '6',
        nonCountingRounds: '3',
      });
      expect(setupAfterPoolingChange(start, poolingPhase)).toEqual({
        ...start,
        poolingPhase,
        nonCountingRounds: '',
      });
    },
  );

  it.each(['none', 'group-stage'] as const)('%s changes the phase alone', (poolingPhase) => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'swiss', swissRoundsOverride: '6' });
    expect(setupAfterPoolingChange(start, poolingPhase)).toEqual({ ...start, poolingPhase });
  });

  it('drops Match results where the phase cannot score them', () => {
    const start = form({ ...ONE_V_ONE, poolingPhase: 'group-stage', scoring: 'match-results' });
    expect(setupAfterPoolingChange(start, 'swiss').scoring).toBe('match-results');
    expect(setupAfterPoolingChange(start, 'none').scoring).toBe('fairpoints');
  });
});

describe('setupAfterOddCountChange', () => {
  it('Flex takes the race double elimination back to single elimination', () => {
    const start = form({ ...TWO_TEAMS, scheduleLogic: 'double-elimination' });
    expect(setupAfterOddCountChange(start, 'flex', true)).toEqual({
      ...start,
      oddCountStrategy: 'flex',
      scheduleLogic: 'single-elimination',
    });
  });

  it('Bye keeps the race double elimination', () => {
    const start = form({ ...ONE_V_ONE, oddCountStrategy: 'none', scheduleLogic: 'double-elimination' });
    expect(setupAfterOddCountChange(start, 'bye', true)).toEqual({ ...start, oddCountStrategy: 'bye' });
  });

  it('Flex keeps the shared-Final double elimination of an FFA', () => {
    const start = form({ scheduleLogic: 'double-elimination-shared-final' });
    expect(setupAfterOddCountChange(start, 'flex', false)).toEqual({ ...start, oddCountStrategy: 'flex' });
  });

  it('Flex ends Match results after a qualification table', () => {
    const start = form({ ...TWO_TEAMS, poolingPhase: 'qual-table', scoring: 'match-results' });
    expect(setupAfterOddCountChange(start, 'flex', true)).toEqual({
      ...start,
      oddCountStrategy: 'flex',
      scoring: 'fairpoints',
    });
  });

  it('reconciles the schedule by the rendered format and judges the scoring by the form’s', () => {
    const start = form({
      scheduleLogic: 'kings-valley',
      poolingPhase: 'qual-table',
      scoring: 'match-results',
    });
    // The panel still showed a head-to-head format while the form already holds FFA.
    expect(setupAfterOddCountChange(start, 'bye', true)).toEqual({
      ...start,
      oddCountStrategy: 'bye',
      scheduleLogic: 'single-elimination',
      scoring: 'fairpoints',
    });
  });
});

describe('setupAfterScoringChange', () => {
  const fours = (tieMargin: string) => form({ ...TWO_TEAMS, gameFormat: 'team-4v4', tieMargin });

  it.each([
    ['', '100'],
    ['55', '55'],
  ])('Match results turns a tie margin of "%s" into "%s"', (tieMargin, expected) => {
    const start = fours(tieMargin);
    expect(setupAfterScoringChange(start, 'match-results')).toEqual({
      ...start,
      scoring: 'match-results',
      tieMargin: expected,
    });
  });

  it('another system leaves the tie margin alone', () => {
    const start = fours('');
    expect(setupAfterScoringChange(start, 'positional-points')).toEqual({
      ...start,
      scoring: 'positional-points',
    });
  });
});
