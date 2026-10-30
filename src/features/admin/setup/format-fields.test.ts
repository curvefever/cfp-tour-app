import { describe, expect, it } from 'vitest';
import type { PersistedSetup } from '../../../domain/tournament/types';
import {
  gamesLabel,
  matchFromSelectValue,
  matchLabelOf,
  matchSelectValue,
  visibleFormatFields,
  type FormatChoices,
  type FormatField,
} from './format-fields';

/**
 * The expected sets are written out as values, the rules the Setup form has always shown its fields by: the
 * fields of every setup, the ones a pooling phase adds, the ones a schedule logic adds.
 */
const ALWAYS: FormatField[] = [
  'gameFormat',
  'scheduleLogic',
  'poolingPhase',
  'scoring',
  'poolingGames',
  'poolingBestOf',
  'matchOverrides',
];

const BY_POOLING: Record<PersistedSetup['poolingPhase'], FormatField[]> = {
  none: [],
  'qual-table': ['drawPublication', 'qualAdv', 'nonCountingRounds', 'qualRoundsOverride'],
  swiss: ['drawPublication', 'qualAdv', 'nonCountingRounds', 'swissRoundsOverride'],
  'group-stage': ['groupSize', 'roundRobinMode', 'qualifiersPerGroup'],
};

const BY_LOGIC: Record<PersistedSetup['scheduleLogic'], FormatField[]> = {
  'single-elimination': [
    'bracketGames',
    'bracketBestOf',
    'finalsGames',
    'finalsBestOf',
    'semisOverride',
    'semisGames',
    'semisBestOf',
    'finalOverride',
    'eliminationRoundTargets',
    'eliminationSeedingOverrides',
  ],
  'double-elimination': [
    'bracketGames',
    'bracketBestOf',
    'losersGames',
    'losersBestOf',
    'grandFinalWbTarget',
    'grandFinalLbTarget',
  ],
  'double-elimination-shared-final': [
    'bracketGames',
    'bracketBestOf',
    'losersGames',
    'losersBestOf',
    'finalsGames',
    'finalsBestOf',
    'lbQualifiers',
    'finalOverride',
    'eliminationRoundTargets',
    'eliminationSeedingOverrides',
  ],
  'kings-valley': ['bracketGames', 'bracketBestOf', 'finalsGames', 'finalsBestOf'],
  'waterfall-bracket': ['finalsGames', 'finalsBestOf', 'waterfallGraph'],
};

function fieldsOf(choices: Partial<FormatChoices>): FormatField[] {
  return [
    ...visibleFormatFields({
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      scoring: 'fairpoints',
      ...choices,
    }),
  ].sort();
}

function expected(...groups: FormatField[][]): FormatField[] {
  return [...new Set(groups.flat())].sort();
}

describe('visibleFormatFields', () => {
  for (const [poolingPhase, byPooling] of Object.entries(BY_POOLING)) {
    for (const [scheduleLogic, byLogic] of Object.entries(BY_LOGIC)) {
      it(`shows the settings of pooling "${poolingPhase}" with "${scheduleLogic}"`, () => {
        expect(
          fieldsOf({
            poolingPhase: poolingPhase as FormatChoices['poolingPhase'],
            scheduleLogic: scheduleLogic as FormatChoices['scheduleLogic'],
          }),
        ).toEqual(expected(ALWAYS, byPooling, byLogic));
      });
    }
  }

  it('shows the team scoring only for a team format', () => {
    expect(fieldsOf({ gameFormat: 'team-2v2v2v2' })).toContain('teamScoringRule');
    expect(fieldsOf({ gameFormat: 'team-3v3' })).toContain('teamScoringRule');
    expect(fieldsOf({ gameFormat: 'ffa-individual' })).not.toContain('teamScoringRule');
    expect(fieldsOf({ gameFormat: 'individual-1v1' })).not.toContain('teamScoringRule');
  });

  it('shows the odd-count strategy only for a format with a choice of strategies', () => {
    expect(fieldsOf({ gameFormat: 'individual-1v1' })).toContain('oddCountStrategy');
    expect(fieldsOf({ gameFormat: 'team-3v3' })).toContain('oddCountStrategy');
    expect(fieldsOf({ gameFormat: 'ffa-individual' })).not.toContain('oddCountStrategy');
    expect(fieldsOf({ gameFormat: 'team-2v2v2v2' })).not.toContain('oddCountStrategy');
  });

  it('shows the points table only for positional points with a pooling phase', () => {
    for (const poolingPhase of ['qual-table', 'swiss', 'group-stage'] as const) {
      expect(fieldsOf({ poolingPhase, scoring: 'positional-points' })).toContain('positionalPointsTable');
      expect(fieldsOf({ poolingPhase, scoring: 'fairpoints' })).not.toContain('positionalPointsTable');
    }
    expect(fieldsOf({ poolingPhase: 'none', scoring: 'positional-points' })).not.toContain(
      'positionalPointsTable',
    );
  });
});

describe('gamesLabel', () => {
  it('words one game and several games', () => {
    expect(gamesLabel(1)).toBe('Single game');
    expect(gamesLabel(3)).toBe('3 games (sum)');
  });
});

describe('the Semis and Finals format select', () => {
  it('shows the summed games, or Best of N when it is set', () => {
    expect(matchSelectValue('3', '')).toBe('3');
    expect(matchSelectValue('3', '5')).toBe('bo5');
    expect(matchLabelOf(3, undefined)).toBe('3 games (sum)');
    expect(matchLabelOf(3, 5)).toBe('Best of 5');
  });

  it('a Best of N leaves the games as they were, summed games clear the Best of N', () => {
    expect(matchFromSelectValue('bo3')).toEqual({ bestOf: '3' });
    expect(matchFromSelectValue('2')).toEqual({ games: '2', bestOf: '' });
  });
});
