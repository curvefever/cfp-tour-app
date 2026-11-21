// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bracketLogicOf } from '../../../domain/tournament/app-written-bracket';
import {
  afterFiveAbsent,
  afterSevenJoined,
  afterThreeAbsent,
  built,
} from '../../../domain/tournament/__tests__/layered-test-support';
import { checkLayeredPlan } from '../../../domain/tournament/layered-replan';
import { layeredKeptPlayOf, layeredPlayOf } from '../../../domain/tournament/rule-versions';
import type { TournamentState } from '../../../domain/tournament/types';
import { LayeredPlanCard } from './LayeredPlanCard';

let current: TournamentState;
/** What the card handed to `updateState`, in order. */
const saved: TournamentState[] = [];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: current, updateState: (next: TournamentState) => saved.push(next) }),
}));

beforeEach(() => {
  saved.length = 0;
});

afterEach(cleanup);

const card = () => document.getElementById('layered-plan-card');

describe('the card for a new plan', () => {
  it('is not shown while the plan in use is the plan: 28 play of 31, or nothing absent yet', () => {
    current = built(31);
    const { unmount } = render(<LayeredPlanCard state={current} />);
    expect(card()).toBeNull();
    unmount();
    current = afterThreeAbsent();
    const again = render(<LayeredPlanCard state={current} />);
    expect(card()).toBeNull();
    again.unmount();
    // 26 play: the plan would only move the first Lower rooms (7+7 in place of 8+7), which is not offered.
    current = afterFiveAbsent();
    render(<LayeredPlanCard state={current} />);
    expect(card()).toBeNull();
  });

  it('is not shown for a bracket that is not a layered one', () => {
    current = {
      ...afterSevenJoined(),
      gamemodeConfig: { ...afterSevenJoined().gamemodeConfig, layeredVersion: undefined },
    };
    render(<LayeredPlanCard state={current} />);
    expect(card()).toBeNull();
  });

  it('shows the plan in use beside the new one, each with its line and its rounds by levels', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    expect(screen.getByText('A NEW PLAN FOR THE BRACKET')).toBeTruthy();
    expect(card()?.textContent).toContain('35 play now');
    expect(card()?.textContent).toContain('the plan in use was made for 28 who play');
    const inUse = within(document.getElementById('layered-plan-in-use') as HTMLElement);
    const next = within(document.getElementById('layered-plan-new') as HTMLElement);
    expect(inUse.getByText(/28 expected to play · 23 in the bracket/)).toBeTruthy();
    expect(next.getByText(/35 expected to play · 29 in the bracket/)).toBeTruthy();
    expect(inUse.getByText('The plan in use')).toBeTruthy();
    expect(next.getByText('The new plan')).toBeTruthy();
    // One grid and one set of phone blocks per plan: the plans sit beside each other on a wide screen, one above the other on a phone.
    expect(document.querySelectorAll('#layered-plan-card [data-grid="wide"]')).toHaveLength(2);
    expect(document.querySelectorAll('#layered-plan-card [data-grid="phone"]')).toHaveLength(2);
    expect(within(card() as HTMLElement).getAllByText('Semi-Final A').length).toBeGreaterThan(0);
  });

  it('has the two buttons and the typed numbers, without "Expected to play"', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    expect(screen.getByRole('button', { name: 'Use the new plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep the current plan' })).toBeTruthy();
    expect(screen.queryByLabelText('Expected to play (optional)')).toBeNull();
    for (const label of [
      'In the bracket (optional)',
      'Bracket rounds (optional)',
      'Levels (optional)',
      'Top level (optional)',
    ]) {
      expect(screen.getByLabelText(label), label).toBeTruthy();
    }
    expect(screen.getByLabelText('The other half of Semi-Final A')).toBeTruthy();
  });
});

describe('"Use the new plan"', () => {
  it('saves the plan for 35 through the state, keeping the layered mark, and nothing else is saved', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use the new plan' }));
    expect(saved).toHaveLength(1);
    expect(layeredPlayOf(saved[0])).toBe(35);
    expect(bracketLogicOf(saved[0])).toBe('layered');
    expect(checkLayeredPlan(saved[0]).kind).toBe('current');
  });

  it('takes a typed number into the plan and the stored settings', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    fireEvent.change(screen.getByLabelText('Bracket rounds (optional)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use the new plan' }));
    expect(saved[0].settings?.layeredRounds).toBe('5');
    expect(bracketLogicOf(saved[0])).toBe('layered');
  });

  it('says why a typed number cannot be used, with the numbers that can, and does not save', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    fireEvent.change(screen.getByLabelText('The top places of each room in Round 4 - Lower'), {
      target: { value: '7' },
    });
    expect(document.getElementById('layered-plan-new')?.textContent).toContain(
      'The top 7 of each room cannot be used in Round 4 - Lower',
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use the new plan' }).disabled).toBe(true);
    fireEvent.click(
      within(document.getElementById('layered-typed-top-counts') as HTMLElement).getByRole('button', {
        name: 'Clear',
      }),
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use the new plan' }).disabled).toBe(false);
    expect(saved).toHaveLength(0);
  });
});

describe('"Keep the current plan"', () => {
  it('saves the number it was kept at and changes no round', () => {
    current = afterSevenJoined();
    render(<LayeredPlanCard state={current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the current plan' }));
    expect(saved).toHaveLength(1);
    expect(layeredKeptPlayOf(saved[0])).toBe(35);
    expect(saved[0].rounds).toEqual(current.rounds);
  });

  it('is gone once the plan is kept: the card is not shown for the kept state, after a reload too', () => {
    current = JSON.parse(
      JSON.stringify({
        ...afterSevenJoined(),
        gamemodeConfig: { ...afterSevenJoined().gamemodeConfig, layeredKeptPlay: 35 },
      }),
    ) as TournamentState;
    render(<LayeredPlanCard state={current} />);
    expect(card()).toBeNull();
  });
});
