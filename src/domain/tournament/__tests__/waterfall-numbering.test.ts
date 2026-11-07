import { describe, expect, it } from 'vitest';
import { computeSwissRoundCount } from '../pooling';
import { infoWithRenamedRounds } from '../round-notes';
import { createDefaultInfo, createDefaultSetup } from '../state-defaults';
import type { PersistedSetup } from '../types';
import {
  renumberWaterfallDefaults,
  numberingAfterEdit,
  standingsKindOfSetup,
  waterfallFirstRoundNumber,
  withWaterfallNumbering,
} from '../waterfall-numbering';

const QUAL_GRAPH = [
  'ROUNDS:',
  'Round 4 = 2x8',
  'Round 5 = 8',
  'Round 4 - Upper = 8',
  'Final = 8 FINAL',
  '',
  'ROUTES:',
  'Qual: 1-16->Round 4, 17-20->Round 4 - Upper',
  'Round 4.A: 1-4->Round 5, 5-8->eliminated',
  'Round 4.B: 1-4->Round 5, 5-8->eliminated',
  'Round 5: 1-4->Final, 5-8->eliminated',
  'Round 4 - Upper: 1-4->Final, 5-8->eliminated',
].join('\n');

function setupOf(overrides: Partial<PersistedSetup>): PersistedSetup {
  return createDefaultSetup({
    scheduleLogic: 'waterfall-bracket',
    poolingPhase: 'qual-table',
    waterfallGraph: QUAL_GRAPH,
    waterfallNumberedFrom: '4',
    ...overrides,
  });
}

describe('waterfallFirstRoundNumber', () => {
  it('is one past the pooling rounds: Round 4 after 3 qualification rounds, Round 5 after 4, Round 3 with no pooling', () => {
    expect(waterfallFirstRoundNumber(setupOf({}), 37)).toBe(4);
    expect(waterfallFirstRoundNumber(setupOf({ qualRoundsOverride: '4' }), 37)).toBe(5);
    expect(waterfallFirstRoundNumber(setupOf({ poolingPhase: 'none' }), 37)).toBe(3);
  });

  it('follows the head count in Swiss and in a group stage (31 and 37 units, groups of 4)', () => {
    for (const count of [31, 37, 43, 53]) {
      const swiss = setupOf({ poolingPhase: 'swiss' });
      expect(waterfallFirstRoundNumber(swiss, count)).toBe(computeSwissRoundCount(count) + 1);
    }
    const groups = setupOf({ poolingPhase: 'group-stage', groupSize: '4' });
    const rounds31 = waterfallFirstRoundNumber(groups, 31) - 1;
    const rounds37 = waterfallFirstRoundNumber(groups, 37) - 1;
    expect(rounds31).toBe(3);
    expect(rounds37).toBe(5);
  });
});

describe('standingsKindOfSetup', () => {
  it('is the Qual line after a qualification table, the Groups line after a group stage, none otherwise', () => {
    expect(standingsKindOfSetup(setupOf({}))).toBe('qual');
    expect(standingsKindOfSetup(setupOf({ poolingPhase: 'group-stage' }))).toBe('groups');
    expect(standingsKindOfSetup(setupOf({ poolingPhase: 'none' }))).toBeNull();
    expect(standingsKindOfSetup(setupOf({ scheduleLogic: 'single-elimination' }))).toBeNull();
  });
});

describe('renumberWaterfallDefaults', () => {
  it('shifts the default names when the qualification rounds go from 3 to 4, and the Qual line with them', () => {
    const result = renumberWaterfallDefaults(setupOf({ qualRoundsOverride: '4' }), 37);
    expect([...(result?.renames ?? [])]).toEqual([
      ['Round 4', 'Round 5'],
      ['Round 5', 'Round 6'],
    ]);
    expect(result?.numberedFrom).toBe('5');
    expect(result?.graph).toContain('Round 5 = 2x8');
    expect(result?.graph).toContain('Round 4 - Upper = 8');
    expect(result?.graph).toContain('Qual: 1-16->Round 5, 17-20->Round 4 - Upper');
  });

  it('shifts back down when the rounds go from 4 to 3', () => {
    const shifted = renumberWaterfallDefaults(setupOf({ qualRoundsOverride: '4' }), 37);
    const back = renumberWaterfallDefaults(
      setupOf({ waterfallGraph: shifted?.graph ?? '', waterfallNumberedFrom: '5' }),
      37,
    );
    expect(back?.numberedFrom).toBe('4');
    expect(back?.graph).toContain('Round 4 = 2x8');
    expect(back?.graph).toContain('Round 5 = 8');
    expect(back?.graph).toContain('Qual: 1-16->Round 4, 17-20->Round 4 - Upper');
  });

  it('moves the notes with the names: a note on "Round 4" ends up on "Round 5"', () => {
    const result = renumberWaterfallDefaults(setupOf({ qualRoundsOverride: '4' }), 37);
    const info = infoWithRenamedRounds(
      {
        ...createDefaultInfo(),
        roundNotes: { 'Round 4': 'powers off', 'Round 4 - Upper': 'typed' },
        gameNotes: { 'Round 4': { g1: 'game one' } },
      },
      result?.renames ?? new Map(),
    );
    expect(info.roundNotes).toEqual({ 'Round 5': 'powers off', 'Round 4 - Upper': 'typed' });
    expect(info.gameNotes).toEqual({ 'Round 5': { g1: 'game one' } });
  });

  it('does nothing when the first number is the one the graph is numbered from', () => {
    expect(renumberWaterfallDefaults(setupOf({}), 37)).toBeNull();
  });

  it('never renumbers a graph that is not numbered (saved before this, or "R1" names)', () => {
    const unnumbered = setupOf({ waterfallNumberedFrom: '', qualRoundsOverride: '4' });
    expect(renumberWaterfallDefaults(unnumbered, 37)).toBeNull();
  });

  it('does nothing for another schedule logic, an empty graph or a graph that does not read', () => {
    const changed = { qualRoundsOverride: '4' };
    const other = setupOf({ scheduleLogic: 'single-elimination', ...changed });
    expect(renumberWaterfallDefaults(other, 37)).toBeNull();
    expect(renumberWaterfallDefaults(setupOf({ waterfallGraph: '', ...changed }), 37)).toBeNull();
    expect(
      renumberWaterfallDefaults(setupOf({ waterfallGraph: 'ROUNDS:\nx y z', ...changed }), 37),
    ).toBeNull();
  });

  it('waits for the roster in a group stage (the rounds come from the head count), then renumbers by it', () => {
    const groups = setupOf({
      poolingPhase: 'group-stage',
      groupSize: '4',
      waterfallGraph: QUAL_GRAPH.replace('Qual:', 'Groups:'),
    });
    expect(renumberWaterfallDefaults(groups, 0)).toBeNull();
    // 31 units in groups of 4 play 3 rounds, so the bracket's first round is still Round 4.
    expect(renumberWaterfallDefaults(groups, 31)).toBeNull();
    const more = renumberWaterfallDefaults(groups, 37);
    expect(more?.numberedFrom).toBe('6');
    expect(more?.renames.get('Round 4')).toBe('Round 6');
  });

  it('skips a shift that cannot be made whole, but moves the number on so it is not tried again', () => {
    const graph = 'ROUNDS:\nRound 5 = 8\nRound 05 = 8\nFinal = 8 FINAL\nROUTES:';
    const result = renumberWaterfallDefaults(setupOf({ waterfallGraph: graph, qualRoundsOverride: '4' }), 37);
    expect(result?.renames.size).toBe(0);
    expect(result?.graph).toBe(graph);
    expect(result?.numberedFrom).toBe('5');
  });
});

describe('withWaterfallNumbering', () => {
  it('marks a graph that has default names as numbered from the current first number', () => {
    const unmarked = setupOf({ waterfallNumberedFrom: '', qualRoundsOverride: '4' });
    expect(withWaterfallNumbering(unmarked, 37).waterfallNumberedFrom).toBe('5');
  });

  it('leaves a graph of typed names unmarked, so it is never renumbered', () => {
    const typed = setupOf({
      waterfallNumberedFrom: '',
      waterfallGraph: 'ROUNDS:\nUpper = 8\nFinal = 8 FINAL\nROUTES:',
    });
    expect(withWaterfallNumbering(typed, 37)).toBe(typed);
  });

  it('leaves another schedule logic, an empty graph and a graph that does not read as they are', () => {
    const cases: Array<Partial<PersistedSetup>> = [
      { scheduleLogic: 'single-elimination' },
      { waterfallGraph: '' },
      { waterfallGraph: 'ROUNDS:\nx y z' },
    ];
    for (const overrides of cases) {
      const setup = setupOf({ waterfallNumberedFrom: '', ...overrides });
      expect(withWaterfallNumbering(setup, 37)).toBe(setup);
    }
  });
});

describe('a numbered graph keeps its number', () => {
  const GROUPS_GRAPH = QUAL_GRAPH.replace('Qual:', 'Groups:')
    .replaceAll('Round 4', 'Round 6')
    .replaceAll('Round 5', 'Round 7');
  const numberedFromSix = setupOf({
    poolingPhase: 'group-stage',
    groupSize: '4',
    waterfallGraph: GROUPS_GRAPH,
    waterfallNumberedFrom: '6',
  });

  it('is a graph that reads: unnumbered, the same setup is marked 1 with an empty roster', () => {
    const unnumbered = { ...numberedFromSix, waterfallNumberedFrom: '' };
    expect(withWaterfallNumbering(unnumbered, 0).waterfallNumberedFrom).toBe('1');
    // ...and numbered from 4, the same graph is renumbered by 37 units (first number 6): the names are read.
    const renames = renumberWaterfallDefaults(
      { ...numberedFromSix, waterfallNumberedFrom: '4' },
      37,
    )?.renames;
    expect([...(renames ?? [])]).toEqual([
      ['Round 6', 'Round 8'],
      ['Round 7', 'Round 9'],
    ]);
  });

  it('is not re-marked by an edit while the head count is unknown (an empty roster would say 1)', () => {
    expect(withWaterfallNumbering(numberedFromSix, 0)).toBe(numberedFromSix);
    const edited = { ...numberedFromSix, waterfallGraph: GROUPS_GRAPH.replace('= 2x8', '= 2x8 BO3') };
    expect(numberingAfterEdit(numberedFromSix, edited, 0)).toEqual({ fields: {}, renames: new Map() });
  });

  it('then moves nothing when the roster comes back (37 units in groups of 4 play 5 rounds)', () => {
    expect(renumberWaterfallDefaults(numberedFromSix, 37)).toBeNull();
  });
});

describe('numberingAfterEdit', () => {
  it('renumbers when the edit moves the first number, carrying the renames', () => {
    const before = setupOf({});
    const after = { ...before, qualRoundsOverride: '4' };
    const edit = numberingAfterEdit(before, after, 37);
    expect(edit.fields.waterfallNumberedFrom).toBe('5');
    expect(edit.fields.waterfallGraph).toContain('Round 5 = 2x8');
    expect([...edit.renames]).toEqual([
      ['Round 4', 'Round 5'],
      ['Round 5', 'Round 6'],
    ]);
  });

  it('marks a graph whose text the edit changed, and not an edit of another setting', () => {
    const unmarked = setupOf({ waterfallNumberedFrom: '' });
    const otherSetting = { ...unmarked, groupSize: '5' };
    expect(numberingAfterEdit(unmarked, otherSetting, 37).fields).toEqual({});
    const graphEdit = { ...unmarked, waterfallGraph: QUAL_GRAPH.replace('= 2x8', '= 2x8 BO3') };
    expect(numberingAfterEdit(unmarked, graphEdit, 37).fields).toEqual({ waterfallNumberedFrom: '4' });
  });

  it('changes nothing for an edit that does not touch the numbering', () => {
    const before = setupOf({});
    const edit = numberingAfterEdit(before, { ...before, scoring: 'positional-points' }, 37);
    expect(edit).toEqual({ fields: {}, renames: new Map() });
  });
});
