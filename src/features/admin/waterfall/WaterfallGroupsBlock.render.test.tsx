// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groupSizesOf } from '../../../domain/tournament/group-exit';
import { GROUPS_LABEL } from '../../../domain/tournament/waterfall-bracket';
import { cutoffTieHeading } from '../../bracket/cutoff-tie-heading';
import { setupDerived } from '../setup/setup-derived';
import { groupsLineExitText } from '../setup/group-exit-help';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';
import { describeRankLabels, sourceName, standingsSourceName } from './waterfall-format';

afterEach(cleanup);

const GRAPH = (line: string) => `
ROUNDS:
R1 = 2x2
R1C = 2x2
R2 = 2x2
Final = 2 FINAL

ROUTES:
${line}
R1.A: 1->R2, 2->eliminated
R1.B: 1->R2, 2->eliminated
R1C.A: 1->R2, 2->eliminated
R1C.B: 1->R2, 2->eliminated
R2.A: 1->Final, 2->eliminated
R2.B: 1->Final, 2->eliminated
`;

const ROOM = { min: 2, max: 2, ideal: 2 };

function editor(props: Partial<Parameters<typeof WaterfallGraphEditor>[0]> & { text: string }) {
  return render(<WaterfallGraphEditor entrantCount={null} onChange={() => {}} roomSize={ROOM} {...props} />);
}

describe('the Groups block of the graph editor', () => {
  it('shows the groups header and a label for every routed rank: 13 teams in groups of 4, fair cut', () => {
    editor({
      text: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
      entrantCount: 13,
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: groupSizesOf(13, 4),
      groupExit: 'fair-cut',
    });
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent === 'Players registered: 13 · groups: 5, 4, 4 · sent on: 8 · eliminated: 5',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('rank-labels').textContent).toBe(
      '1–3 Group winners · 4–6 Runners-up · 7 3rd, group of 5 · 8 Best of: 4th of the group of 5, 3rds of the groups of 4',
    );
  });

  it('12 teams in groups of 4, fair cut: the best 3rds', () => {
    editor({
      text: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: groupSizesOf(12, 4),
      groupExit: 'fair-cut',
    });
    expect(screen.getByTestId('rank-labels').textContent).toBe(
      '1–3 Group winners · 4–6 Runners-up · 7–8 Best 3rds',
    );
  });

  it('per group 2 over 4 groups: winners then runners-up', () => {
    editor({
      text: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
      entrantCount: 16,
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: groupSizesOf(16, 4),
      groupExit: 'per-group',
    });
    expect(screen.getByTestId('rank-labels').textContent).toBe('1–4 Group winners · 5–8 Runners-up');
  });

  it('names the block Groups, and the slots carry their label', () => {
    editor({
      text: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: groupSizesOf(12, 4),
      groupExit: 'fair-cut',
    });
    expect(screen.getAllByText('Groups').length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Groups, rank 4 \(Runners-up\), to R1/)).toBeTruthy();
    expect(screen.queryByText('Qualification table')).toBeNull();
  });

  it('asks for a roster while the groups are not known', () => {
    editor({
      text: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: null,
    });
    expect(screen.getByTestId('rank-labels').textContent).toBe('Load a roster to see the groups.');
    expect(screen.getByText(/load a roster to see the groups/)).toBeTruthy();
  });

  it('is the Qualification table block, with no labels, under a qualification table', () => {
    editor({
      text: GRAPH('Qual: 1-4->R1, 5-8->R1C'),
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'qual',
    });
    expect(screen.getAllByText('Qualification table').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('rank-labels')).toBeNull();
    expect(screen.queryByText('Groups')).toBeNull();
  });

  it('offers to switch a Qual line left over from a qualification table to a Groups line', () => {
    editor({
      text: GRAPH('Qual: 1-4->R1, 5-8->R1C'),
      entrantCount: 12,
      standingsSource: true,
      standingsKind: 'groups',
      groupSizes: groupSizesOf(12, 4),
    });
    const alert = screen.getByText(
      /has a Qual line, but this tournament's pooling phase needs a Groups line/,
    );
    expect(within(alert.closest('div') as HTMLElement).getByRole('button').textContent).toBe(
      'Use it as the Groups line',
    );
  });
});

describe('the helpers behind the Groups block and the banner', () => {
  it('names the source by its kind', () => {
    expect(standingsSourceName(undefined)).toBe('Qualification table');
    expect(standingsSourceName('groups')).toBe('Groups');
    expect(sourceName('Qual', 'groups')).toBe('Groups');
    expect(sourceName('R1', 'groups')).toBe('R1');
  });

  it('reads runs of equal labels, leaving blank ones out', () => {
    expect(describeRankLabels(['A', 'A', 'B', '', ''])).toBe('1–2 A · 3 B');
    expect(describeRankLabels([])).toBe('');
  });

  it('the banner heading names the destinations of a Groups band tie', () => {
    expect(cutoffTieHeading('group-band-4', {}, 'R1 and R1C', '1.5 pts per match')).toBe(
      '⚖ Groups tie between R1 and R1C (1.5 pts per match)',
    );
    expect(cutoffTieHeading('qual-band-9', {}, 'R1 and R1C', '7 pts')).toBe(
      '⚖ Qualification tie between R1 and R1C (7 pts)',
    );
    expect(cutoffTieHeading('group-exit-cutoff', {}, null, '7 pts')).toBe(
      '⚖ Groups: tie for the last spot (7 pts)',
    );
    expect(cutoffTieHeading('group-cutoff-B', { groupLabel: 'B' }, null, '7 pts')).toBe(
      '⚖ Group B qualification tie at the cut-off (7 pts)',
    );
  });

  it('Setup shows the value the Groups line implies, read only', () => {
    expect(groupsLineExitText({ total: 0, perGroup: false, groupCount: 3 })).toMatch(/not set yet/);
    expect(groupsLineExitText({ total: 8, perGroup: false, groupCount: 3 })).toBe(
      '8, set by the Groups line',
    );
    expect(groupsLineExitText({ total: 8, perGroup: true, groupCount: 4 })).toBe('2, set by the Groups line');
    expect(groupsLineExitText({ total: 8, perGroup: true, groupCount: 3 })).toMatch(/route a multiple of 3/);
    expect(groupsLineExitText({ total: 8, perGroup: true, groupCount: null })).toMatch(/load a roster/);
  });

  it('the derived Setup values follow the pooling phase and the roster', () => {
    const state = createDefaultTournamentState({ confirmedCount: 13 });
    const groups = createDefaultSetup({
      scheduleLogic: 'waterfall-bracket',
      poolingPhase: 'group-stage',
      groupSize: '4',
      waterfallGraph: GRAPH('Groups: 1-4->R1, 5-8->R1C'),
    });
    const derived = setupDerived(groups, state, '2');
    expect(derived.waterfallStandingsKind).toBe('groups');
    expect(derived.derivedAdvance).toBe(8);
    expect(derived.waterfallGroupSizes).toEqual([5, 4, 4]);
    const qual = setupDerived({ ...groups, poolingPhase: 'qual-table' }, state, '2');
    expect(qual.waterfallStandingsKind).toBe('qual');
    expect(qual.waterfallGroupSizes).toBeNull();
    expect(GROUPS_LABEL).toBe('Groups');
  });
});
