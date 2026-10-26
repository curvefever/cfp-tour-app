// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SE_2V2V2V2,
  firstEliminationIndex,
  generate,
  seatedAndScored,
} from '../../domain/tournament/__tests__/fair-cut-fixtures';
import { withEarlierCutRule } from '../../domain/tournament/__tests__/play-through';
import { LuckyLoserStandingsPanel } from './RoundNotes';

afterEach(cleanup);

const WORKED = [
  [40, 30, 20, 10],
  [35, 30, 25, 10],
  [32, 28, 22, 18],
  [45, 25, 18, 12],
  [38, 27, 21, 14],
  [33, 29, 22, 16],
  [60, 20, 12, 8],
  [50, 30, 20],
];

describe('the lucky-loser race under the fair cut', () => {
  const base = generate('2v2v2v2 31', 31, SE_2V2V2V2);
  const index = firstEliminationIndex(base);

  it('shows a list per room size, the spare-cut tag and the spare-cut line', () => {
    const state = seatedAndScored(base, index, WORKED);
    const view = render(<LuckyLoserStandingsPanel roundIndex={index} state={state} />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('★ ROOMS OF 4 · 2–3 SPOTS');
    expect(text).toContain('★ ROOM OF 3 · 0–1 SPOT');
    expect(view.getAllByText('spare cut?')).toHaveLength(2);
    expect(text).toContain('Spare cut: ');
    expect(text).toMatch(/in the bottom 17% of rooms of 3/);
    expect(text).toMatch(/goes out\./);
  });

  it('keeps the earlier race for a tournament without cutVersion', () => {
    const state = withEarlierCutRule(seatedAndScored(base, index, WORKED));
    const view = render(<LuckyLoserStandingsPanel roundIndex={index} state={state} />);
    expect(view.container.textContent).toContain('LUCKY LOSER RACE · 2 SPOTS');
    expect(view.container.textContent).not.toContain('spare cut?');
  });
});
