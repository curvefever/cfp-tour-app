import { describe, expect, it } from 'vitest';
import { buildState } from '../../../domain/tournament/__tests__/play-through';
import {
  buildQualWaterfall,
  playToQualificationExit,
} from '../../../domain/tournament/__tests__/qual-waterfall';
import { describeStandings, type StandingsDisplayTable } from '../../../domain/tournament/standings-display';
import {
  rowSurfaceClasses,
  standingsGroupStarts,
  standingsRowResult,
  stripeTone,
  type RowResult,
} from './result-row';

describe('stripeTone', () => {
  it.each<[RowResult, ReturnType<typeof stripeTone>]>([
    ['advance', 'green'],
    ['promote', 'green'],
    ['lucky', 'green'],
    ['advance-second', 'yellow'],
    ['stay', 'yellow'],
    ['demote', 'orange'],
    ['drop', 'purple'],
    ['advance-third', 'purple'],
    ['eliminate', 'red'],
    ['pending', 'dashed'],
    ['candidate', 'dashed'],
    ['undecided', 'dashed'],
    ['', null],
  ])('%s gives %s', (result, tone) => {
    expect(stripeTone(result)).toBe(tone);
  });
});

describe('rowSurfaceClasses', () => {
  it('alternates the two row grounds', () => {
    expect(rowSurfaceClasses(0, false)).toBe('bg-cfp-row-a');
    expect(rowSurfaceClasses(1, false)).toBe('bg-cfp-row-b');
    expect(rowSurfaceClasses(2, false)).toBe('bg-cfp-row-a');
  });

  it('gives a followed row the lighter ground and the ring, whatever its position', () => {
    for (const index of [0, 1]) {
      const classes = rowSurfaceClasses(index, true);
      expect(classes).toContain('bg-cfp-followed');
      expect(classes).toContain('--color-cfp-followed-ring');
      expect(classes).not.toContain('bg-cfp-row');
    }
  });
});

function tableOf(state: Parameters<typeof describeStandings>[0]) {
  const display = describeStandings(state);
  const table = display?.tables[0];
  if (!display || !table) throw new Error('no standings');
  return { display, table };
}

function qualTable(count: number, qualAdv = '24') {
  const state = buildState({
    label: `${count}`,
    count,
    teams: false,
    setup: {
      gameFormat: 'ffa-individual',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'qual-table',
      qualAdv,
    },
  });
  if (!state) throw new Error('generation failed');
  return tableOf(state).table;
}

const resultsOf = (table: StandingsDisplayTable, phase: 'live' | 'final' | 'upcoming') =>
  table.entries.map((_, index) => standingsRowResult(index, table, phase));

describe.each([31, 37, 43, 53])('standingsRowResult with %i players and a cut of 24', (count) => {
  const table = qualTable(count);

  it('shows the top 24 through and the rest out, live and final alike', () => {
    for (const phase of ['live', 'final'] as const) {
      const results = resultsOf(table, phase);
      expect(results.slice(0, 24).every((result) => result === 'advance')).toBe(true);
      expect(results.slice(24).every((result) => result === 'eliminate')).toBe(true);
      expect(results).toHaveLength(count);
    }
  });

  it('shows nothing before the standings start', () => {
    expect(resultsOf(table, 'upcoming').every((result) => result === '')).toBe(true);
  });

  it('has one gap, at the cut', () => {
    expect(standingsGroupStarts(table)).toEqual([24]);
  });
});

describe('standingsRowResult: no cut, and a Qual source', () => {
  it('sends everyone through when there is no cut, with no gap', () => {
    const table = qualTable(37, '99');
    expect(resultsOf(table, 'final').every((result) => result === 'advance')).toBe(true);
    expect(standingsGroupStarts(table)).toEqual([]);
  });

  it.each([31, 37, 43, 53])('%i players: 1-16 green, 17-24 yellow, the rest out', (count) => {
    const { table } = tableOf(playToQualificationExit(buildQualWaterfall(count)));
    const results = resultsOf(table, 'live');
    expect(results.slice(0, 16).every((result) => result === 'advance')).toBe(true);
    expect(results.slice(16, 24).every((result) => result === 'advance-second')).toBe(true);
    expect(results.slice(24).every((result) => result === 'eliminate')).toBe(true);
    expect(standingsGroupStarts(table)).toEqual([16, 24]);
  });

  it('colours a third destination purple', () => {
    const graph = `
ROUNDS:
R1 = 2x8
R1C = 8
R1D = 8
Final = 8 FINAL

ROUTES:
Qual: 1-16->R1, 17-24->R1C, 25-32->R1D
R1.A: 1-2->Final, 3-8->eliminated
R1.B: 1-2->Final, 3-8->eliminated
R1C: 1-2->Final, 3-8->eliminated
R1D: 1-2->Final, 3-8->eliminated
`;
    const { table } = tableOf(playToQualificationExit(buildQualWaterfall(40, graph)));
    const results = resultsOf(table, 'final');
    expect([results[0], results[16], results[24], results[32]]).toEqual([
      'advance',
      'advance-second',
      'advance-third',
      'eliminate',
    ]);
    expect(standingsGroupStarts(table)).toEqual([16, 24, 32]);
  });
});

describe('standingsRowResult: a group stage', () => {
  it('cuts each group at its own number of qualifiers', () => {
    const state = buildState({
      label: 'groups',
      count: 13,
      teams: false,
      setup: {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        qualifiersPerGroup: '2',
        oddCountStrategy: 'bye',
        scheduleLogic: 'single-elimination',
      },
    });
    if (!state) throw new Error('generation failed');
    const display = describeStandings(state);
    expect(display?.perGroup).toBe(true);
    for (const table of display?.tables ?? []) {
      const results = resultsOf(table, 'final');
      expect(results.filter((result) => result === 'advance')).toHaveLength(
        Math.min(2, table.entries.length),
      );
      expect(results.slice(2).every((result) => result === 'eliminate')).toBe(true);
    }
  });
});
