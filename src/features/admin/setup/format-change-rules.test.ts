import { describe, expect, it } from 'vitest';
import { getGameFormat } from '../../../domain/tournament/formats';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import {
  isHeadToHead,
  isRaceCompatible,
  leavesHeadToHeadPooling,
  reconcileScheduleLogicForFormat,
  setupAfterFormatChange,
  setupAfterOddCountChange,
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

  it.each(['swiss', 'group-stage'] as const)('1v1 with %s to FFA drops the pooling phase', (poolingPhase) => {
    const start = form({ ...ONE_V_ONE, poolingPhase, scoring: 'match-results' });
    expect(toFormat(start, 'ffa-individual')).toEqual({
      ...start,
      gameFormat: 'ffa-individual',
      oddCountStrategy: '',
      poolingPhase: 'none',
      scoring: 'fairpoints',
    });
  });

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
      poolingPhase: 'none',
      scoring: 'match-results',
    });
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
