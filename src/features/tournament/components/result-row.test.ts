import { describe, expect, it } from 'vitest';
import {
  buildState,
  scoreCurrentRound,
  withEarlierGroupRule,
} from '../../../domain/tournament/__tests__/play-through';
import {
  buildQualWaterfall,
  playToQualificationExit,
} from '../../../domain/tournament/__tests__/qual-waterfall';
import { describeStandings, type StandingsDisplayTable } from '../../../domain/tournament/standings-display';
import {
  destinationGroupResult,
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

  const qualSplit = (qualLine: string) => `
ROUNDS:
RA = 8
RB = 8
Final = 8 FINAL

ROUTES:
Qual: ${qualLine}
RA: 1-4->Final, 5-8->eliminated
RB: 1-4->Final, 5-8->eliminated
`;
  const exitResults = (graph: string) => {
    const { table } = tableOf(playToQualificationExit(buildQualWaterfall(16, graph)));
    return resultsOf(table, 'final');
  };

  it('a snake split of the standings reads green throughout', () => {
    const results = exitResults(qualSplit('1,4,5,8,9,12,13,16->RA, 2,3,6,7,10,11,14,15->RB'));
    expect(results).toHaveLength(16);
    expect(results.every((result) => result === 'advance')).toBe(true);
  });

  it('a top and bottom split reads green then yellow', () => {
    const results = exitResults(qualSplit('1-8->RA, 9-16->RB'));
    expect(results).toEqual([...Array(8).fill('advance'), ...Array(8).fill('advance-second')]);
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

describe('destinationGroupResult and the groups of a table’s bands', () => {
  it.each<[number | undefined, RowResult]>([
    [undefined, 'advance'],
    [0, 'advance'],
    [1, 'advance-second'],
    [2, 'advance-third'],
    [5, 'advance-third'],
  ])('group %s reads %s', (group, result) => {
    expect(destinationGroupResult(group)).toBe(result);
  });

  it('reads a band by its own group, and an out band as eliminated', () => {
    const table = {
      cut: 6,
      bands: [
        { start: 0, destination: 'A' },
        { start: 2, destination: 'B', group: 1 },
        { start: 4, destination: 'C', group: 2 },
        { start: 6, destination: 'out' },
      ],
    };
    expect([0, 2, 4, 6].map((index) => standingsRowResult(index, table, 'live'))).toEqual([
      'advance',
      'advance-second',
      'advance-third',
      'eliminate',
    ]);
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

  it('gives a row without a rank no stripe, inside the cut and past it, and a ranked row its result', () => {
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
    const table = describeStandings(state)?.tables[0];
    if (!table) throw new Error('no table');
    expect(standingsRowResult(0, table, 'live', false)).toBe('');
    expect(standingsRowResult(3, table, 'live', false)).toBe('');
    expect(standingsRowResult(0, table, 'live', true)).toBe('advance');
    expect(standingsRowResult(3, table, 'live', true)).toBe('eliminate');
    expect(standingsRowResult(0, table, 'final', false)).toBe('');
  });

  it('13 units (the earlier group rule): only the unit on a bye has a rank before a group round is scored, so only it gets a stripe', () => {
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
    const results = (describeStandings(withEarlierGroupRule(state))?.tables ?? []).map((table) =>
      table.entries.map((entry, index) => standingsRowResult(index, table, 'live', entry.rank !== null)),
    );
    expect(results[0]).toEqual(['advance', '', '', '', '']);
    expect(
      results
        .slice(1)
        .flat()
        .every((result) => result === ''),
    ).toBe(true);
  });

  it('13 units (per-match standings): a bye is no match, so nobody has a rank before a group round is scored', () => {
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
    const results = (describeStandings(state)?.tables ?? []).flatMap((table) =>
      table.entries.map((entry, index) => standingsRowResult(index, table, 'live', entry.rank !== null)),
    );
    expect(results.every((result) => result === '')).toBe(true);
  });
});

describe('standingsRowResult: a live FFA table with every row ranked', () => {
  it.each([37, 43])('%i players: ranked rows keep green through and red out', (count) => {
    const state = buildState({
      label: `${count}`,
      count,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'single-elimination',
        poolingPhase: 'qual-table',
        qualAdv: '24',
      },
    });
    if (!state) throw new Error('generation failed');
    const { display, table } = tableOf(scoreCurrentRound(state, 0));
    expect(display.phase).toBe('live');
    expect(table.entries.every((entry) => entry.rank !== null)).toBe(true);
    const results = table.entries.map((entry, index) =>
      standingsRowResult(index, table, display.phase, entry.rank !== null),
    );
    expect(results.slice(0, 24).every((result) => result === 'advance')).toBe(true);
    expect(results.slice(24).every((result) => result === 'eliminate')).toBe(true);
  });
});
