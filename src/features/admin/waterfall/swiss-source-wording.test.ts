import { describe, expect, it } from 'vitest';
import { standingsKindOfSetup } from '../../../domain/tournament/waterfall-numbering';
import { graphTextHasQualLine } from '../../../domain/tournament/waterfall-bracket';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import { cutoffTieHeading } from '../../bracket/cutoff-tie-heading';
import { sourceName, standingsSourceName } from './waterfall-format';

const WITH_LINE = 'ROUNDS:\nR1 = 8\nFinal = 8 FINAL\n\nROUTES:\nQual: 1-8->R1\nR1: 1-8->Final\n';
const WITHOUT_LINE = 'ROUNDS:\nR1 = 8\nFinal = 8 FINAL\n\nROUTES:\nR1: 1-8->Final\n';

describe('the Swiss as a source of a Custom bracket', () => {
  const swiss = (waterfallGraph: string) =>
    createDefaultSetup({ scheduleLogic: 'waterfall-bracket', poolingPhase: 'swiss', waterfallGraph });

  it('a Swiss whose graph has a Qual line is a "qual" source, one without is none', () => {
    expect(standingsKindOfSetup(swiss(WITH_LINE))).toBe('qual');
    expect(standingsKindOfSetup(swiss(WITHOUT_LINE))).toBeNull();
    expect(standingsKindOfSetup(swiss(''))).toBeNull();
  });

  it('a Groups line under a Swiss is not a Qual line', () => {
    expect(graphTextHasQualLine(WITH_LINE.replace('Qual:', 'Groups:'))).toBe(false);
    expect(standingsKindOfSetup(swiss(WITH_LINE.replace('Qual:', 'Groups:')))).toBeNull();
  });

  it('the other pooling phases are unchanged', () => {
    const base = { scheduleLogic: 'waterfall-bracket' as const, waterfallGraph: WITHOUT_LINE };
    expect(standingsKindOfSetup(createDefaultSetup({ ...base, poolingPhase: 'qual-table' }))).toBe('qual');
    expect(standingsKindOfSetup(createDefaultSetup({ ...base, poolingPhase: 'group-stage' }))).toBe('groups');
    expect(standingsKindOfSetup(createDefaultSetup({ ...base, poolingPhase: 'none' }))).toBeNull();
  });

  it('the source reads "Swiss standings" in the editor, the table and the groups keep their names', () => {
    expect(standingsSourceName('qual', true)).toBe('Swiss standings');
    expect(standingsSourceName('qual')).toBe('Qualification table');
    expect(standingsSourceName('groups', true)).toBe('Groups');
    expect(sourceName('Qual', 'qual', true)).toBe('Swiss standings');
    expect(sourceName('R1', 'qual', true)).toBe('R1');
  });

  it('a cut-off tie after a Swiss reads "Swiss tie"', () => {
    expect(cutoffTieHeading('qual-band-1', {}, 'U and L', '7 pts', true)).toBe(
      '⚖ Swiss tie between U and L (7 pts)',
    );
    expect(cutoffTieHeading('qual-cutoff', {}, null, '7 pts', true)).toBe(
      '⚖ Swiss tie at the cut-off (7 pts)',
    );
    expect(cutoffTieHeading('qual-cutoff', {}, null, '7 pts')).toBe(
      '⚖ Qualification tie at the cut-off (7 pts)',
    );
  });
});
