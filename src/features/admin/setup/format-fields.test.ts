import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import {
  bracketStageLabel,
  gamesLabel,
  matchFromSelectValue,
  matchLabelOf,
  matchSelectValue,
  overrideSelectValue,
  overrideTokenOf,
  stageFormatLabel,
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

  it('shows the match-result points and the tie margin only for match results in a group stage', () => {
    const fields: FormatField[] = ['matchResultPoints', 'tieMargin'];
    expect(fieldsOf({ poolingPhase: 'group-stage', scoring: 'match-results' })).toEqual(
      expect.arrayContaining(fields),
    );
    expect(fieldsOf({ poolingPhase: 'group-stage', scoring: 'fairpoints' })).not.toContain('tieMargin');
    for (const poolingPhase of ['none', 'qual-table', 'swiss'] as const) {
      const shown = fieldsOf({ poolingPhase, scoring: 'match-results' });
      for (const field of fields) expect(shown).not.toContain(field);
    }
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

  it('names the first stage of the bracket after the schedule', () => {
    expect(bracketStageLabel('single-elimination')).toBe('Elimination rounds');
    expect(bracketStageLabel('kings-valley')).toBe('Ladder rounds');
    expect(bracketStageLabel('double-elimination')).toBe('Winners rounds');
    expect(bracketStageLabel('double-elimination-shared-final')).toBe('Winners rounds');
  });

  it('words the format a stage gives its rounds', () => {
    const setup = createDefaultSetup({ poolingBestOf: '3', bracketGames: '2', finalsGames: '4' });
    expect(stageFormatLabel('pooling', setup)).toBe('Best of 3');
    expect(stageFormatLabel('bracket', setup)).toBe('2 games (sum)');
    expect(stageFormatLabel('losers', setup)).toBe('Single game');
    expect(stageFormatLabel('finals', setup)).toBe('4 games (sum)');
  });

  it('turns an override token into a select value and back', () => {
    expect(overrideSelectValue('BO3')).toBe('bo3');
    expect(overrideSelectValue('GAMES 2')).toBe('2');
    expect(overrideSelectValue('')).toBe('');
    expect(overrideSelectValue('nonsense')).toBe('');
    expect(overrideTokenOf('bo5')).toBe('BO5');
    expect(overrideTokenOf('3')).toBe('GAMES 3');
    expect(overrideTokenOf('')).toBe('');
  });
});
