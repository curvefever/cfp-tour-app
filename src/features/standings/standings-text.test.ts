import { describe, expect, it } from 'vitest';
import type { StandingsDisplay } from '../../domain/tournament/standings-display';
import { standingsContextLine } from './standings-text';

function display(overrides: Partial<StandingsDisplay>, cut: number | null): StandingsDisplay {
  return {
    phase: 'live',
    roundsDone: 2,
    roundsTotal: 3,
    firstCountedRoundNum: 2,
    lastStandingsRoundIndex: 2,
    perGroup: false,
    tables: [{ key: 'qual-cutoff', label: 'Qualification Table', entries: [], cut }],
    ...overrides,
  };
}

describe('standingsContextLine', () => {
  it('says when the standings start before any counted round', () => {
    expect(standingsContextLine(display({ phase: 'upcoming' }, 24))).toBe('Standings start after Round 2.');
  });

  it('shows progress and the cut while live', () => {
    expect(standingsContextLine(display({}, 24))).toBe('After 2 of 3 rounds · top 24 go through');
    expect(standingsContextLine(display({ perGroup: true }, 2))).toBe(
      'After 2 of 3 rounds · top 2 per group go through',
    );
    expect(standingsContextLine(display({}, null))).toBe('After 2 of 3 rounds · everyone goes through');
  });

  it('reports who qualified once final', () => {
    expect(standingsContextLine(display({ phase: 'final' }, 16))).toBe('Final standings · top 16 qualified');
    expect(standingsContextLine(display({ phase: 'final', perGroup: true }, 2))).toBe(
      'Final standings · top 2 per group qualified',
    );
    expect(standingsContextLine(display({ phase: 'final' }, null))).toBe(
      'Final standings · everyone qualified',
    );
  });
});
