import { describe, expect, it } from 'vitest';
import { buildState } from '../../domain/tournament/__tests__/play-through';
import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { groupExitShape } from '../../domain/tournament/group-exit';
import { describeStandings } from '../../domain/tournament/standings-display';
import type { PersistedSetup, TournamentState } from '../../domain/tournament/types';
import { standingsExitLines } from '../bracket/exit-lines';
import { settingsRecapGroups } from '../admin/settings-recap';
import { groupExitHelpLine } from '../admin/setup/group-exit-help';
import { schedulePreviewRows } from '../admin/setup/schedule-preview-rows';
import { groupExitCutSentence, groupExitHelp } from './group-exit-text';
import { standingsExplanation } from './standings-text';

const GROUPS = {
  gameFormat: 'team-4v4',
  poolingPhase: 'group-stage',
  groupSize: '4',
  oddCountStrategy: 'bye',
  scheduleLogic: 'single-elimination',
} as const;

function groupState(setup: Partial<PersistedSetup>, count = 13): TournamentState {
  const state = buildState({ label: 'exit-text', count, teams: true, setup: { ...GROUPS, ...setup } });
  if (!state) throw new Error('generation failed');
  return state;
}

const EVEN_8 = { groupExit: 'even-split', qualAdv: '8' } as const;
const FAIR_8 = { groupExit: 'fair-cut', qualAdv: '8' } as const;

describe('groupExitHelp: the Setup help line from the shape', () => {
  const help = (sizes: number[], mode: 'even-split' | 'fair-cut', total: number) =>
    groupExitHelp(
      groupExitShape(sizes, mode, total),
      sizes,
      sizes.reduce((a, b) => a + b, 0),
      'teams',
    );

  it('5, 4, 4 with 8 advancing', () => {
    expect(help([5, 4, 4], 'even-split', 8)).toBe(
      '13 teams in groups of 5, 4, 4: the top 2 of each group go through, then the best 2 third places.',
    );
    expect(help([5, 4, 4], 'fair-cut', 8)).toBe(
      '13 teams in groups of 5, 4, 4: the top 3 of the group of 5 and the top 2 of each group of 4 go through, then 1 spot for the best next in line.',
    );
  });

  it('5, 5, 4 with 8 and 6 advancing', () => {
    expect(help([5, 5, 4], 'fair-cut', 8)).toBe(
      '14 teams in groups of 5, 5, 4: the top 2 of each group go through, then 2 spots for the best next in line.',
    );
    expect(help([5, 4, 4], 'even-split', 6)).toBe(
      '13 teams in groups of 5, 4, 4: the top 2 of each group go through.',
    );
    expect(help([5, 4, 4], 'fair-cut', 6)).toBe(
      '13 teams in groups of 5, 4, 4: the top 2 of the group of 5 and the top 1 of each group of 4 go through, then 2 spots for the best next in line.',
    );
  });

  it('names groups of one size by their number', () => {
    expect(help([4, 4, 4, 4], 'fair-cut', 8)).toBe(
      '16 teams in 4 groups of 4: the top 2 of each group go through.',
    );
  });
});

describe('groupExitHelpLine', () => {
  const setup = (groupExit: PersistedSetup['groupExit'], qualAdv: string, groupSize = '4') => ({
    groupExit,
    qualAdv,
    groupSize,
  });

  it('is nothing per group, without a roster, or while a field is not a number', () => {
    expect(groupExitHelpLine(setup('per-group', '8'), 13, 'teams')).toBeNull();
    expect(groupExitHelpLine(setup('fair-cut', '8'), null, 'teams')).toBeNull();
    expect(groupExitHelpLine(setup('fair-cut', ''), 13, 'teams')).toBeNull();
    expect(groupExitHelpLine(setup('fair-cut', '8', '9'), 13, 'teams')).toBeNull();
  });

  it('is what the roster would do, or why generation would refuse it', () => {
    expect(groupExitHelpLine(setup('fair-cut', '8'), 13, 'teams')).toEqual({
      text: '13 teams in groups of 5, 4, 4: the top 3 of the group of 5 and the top 2 of each group of 4 go through, then 1 spot for the best next in line.',
      refused: false,
    });
    const refused = groupExitHelpLine(setup('fair-cut', '2'), 13, 'teams');
    expect(refused?.refused).toBe(true);
    expect(refused?.text).toMatch(/3 groups \(5, 4, 4\)/);
  });

  it('reads more than the roster as everyone, which no group stage can send', () => {
    expect(groupExitHelpLine(setup('fair-cut', '99'), 13, 'teams')?.refused).toBe(true);
  });
});

describe('the Groups explanation, in each mode', () => {
  const cut = (setup: Partial<PersistedSetup>, phase?: 'final') => {
    const state = groupState(setup);
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    return standingsExplanation(state, phase ? { ...display, phase } : display)[3];
  };

  it('even split names the leftover places', () => {
    expect(cut(EVEN_8)).toContain('The top 2 of each group go through, and the best 2 third places.');
  });

  it('fair cut names the total and the places of each size', () => {
    expect(cut(FAIR_8)).toContain(
      '8 go through: the top 3 of the group of 5 and the top 2 of each group of 4, then the best next in line.',
    );
  });

  it('says qualified once the groups are over', () => {
    expect(cut(EVEN_8, 'final')).toContain('The top 2 of each group qualified, and the best 2 third places.');
    expect(cut(FAIR_8, 'final')).toContain('8 qualified: the top 3 of the group of 5');
  });

  it('per group is unchanged', () => {
    expect(cut({ qualifiersPerGroup: '2' })).toContain('The top 2 of each group go through.');
  });

  it('with nothing left over it is just the top places', () => {
    expect(groupExitCutSentence(groupExitShape([5, 4, 4], 'even-split', 6), 'go through')).toBe(
      'The top 2 of each group go through.',
    );
  });
});

describe('the exit pop-up of a group table, in each mode', () => {
  const lines = (setup: Partial<PersistedSetup>) => {
    const state = groupState(setup);
    const display = describeStandings(state);
    if (!display) throw new Error('no standings');
    return standingsExitLines(display.tables[0], display, bracketRoundLabels(state));
  };

  it('even split: the direct places, the best of the next place, the rest out', () => {
    const result = lines(EVEN_8);
    const destination = result[0].where;
    expect(result.map((line) => [line.places, line.where])).toEqual([
      ['1–2 (each group)', destination],
      ['3rd: best 2 of 3', destination],
      ['rest', 'out'],
    ]);
  });

  it('fair cut: the direct places of each size, then its chance places and spots', () => {
    const result = lines(FAIR_8);
    const destination = result[0].where;
    expect(result.map((line) => [line.places, line.where])).toEqual([
      ['1–3 (group of 5)', destination],
      ['1–2 (each group of 4)', destination],
      ['4th (group of 5)', `${destination}, 0–1 spot`],
      ['3rd (each group of 4)', `${destination}, 0–1 spot`],
      ['rest', 'out'],
    ]);
  });

  it('per group is unchanged', () => {
    expect(lines({ qualifiersPerGroup: '2' }).map((line) => line.places)).toEqual(['1–2 (each group)', '3+']);
  });
});

describe('the settings recap of a group stage', () => {
  const items = (setup: Partial<PersistedSetup>) =>
    settingsRecapGroups(groupState(setup)).flatMap((group) => group.items);

  it('shows the mode and the total it sends on', () => {
    expect(items(FAIR_8)).toEqual(
      expect.arrayContaining([
        { label: 'Teams out of the groups', value: 'Advance to bracket — fair cut' },
        { label: 'Advance to bracket', value: '8 in all' },
      ]),
    );
    expect(items(EVEN_8)).toContainEqual({
      label: 'Teams out of the groups',
      value: 'Advance to bracket — even split',
    });
  });

  it('shows the qualifiers per group, as before, when it is so many per group', () => {
    expect(items({ qualifiersPerGroup: '2' })).toEqual(
      expect.arrayContaining([
        { label: 'Teams out of the groups', value: 'Qualifiers per group' },
        { label: 'Qualifiers per group', value: '2' },
      ]),
    );
  });
});

describe('the schedule preview of a group stage', () => {
  const exitRow = (setup: Partial<PersistedSetup>) =>
    schedulePreviewRows(groupState(setup), 'teams').find((row) => row.detail.includes('groups of'));

  it('holds the exit in the last group round, in the help line words', () => {
    expect(exitRow(FAIR_8)?.detail).toContain(
      'groups of 5, 4, 4: the top 3 of the group of 5 and the top 2 of each group of 4 advance, then 1 spot for the best next in line',
    );
    expect(exitRow(EVEN_8)?.detail).toContain(
      'groups of 5, 4, 4: the top 2 of each group advance, then the best 2 third places',
    );
    expect(exitRow({ qualifiersPerGroup: '2' })?.detail).toContain(
      'groups of 5, 4, 4: the top 2 of each group advance',
    );
  });
});
