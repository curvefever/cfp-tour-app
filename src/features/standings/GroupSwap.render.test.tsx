// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { scoreKeysForPosition } from '../../domain/tournament/scoring';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import { scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { loadedState, type FixtureTournament } from '../../../e2e/screens/fixtures';
import { testAppContext, type AppRole } from '../shell/test-app';
import { TournamentContext } from '../tournament/TournamentProvider';
import { StandingsView } from './StandingsView';

let refusal: string | null = null;
vi.mock('../../domain/tournament/group-swap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../domain/tournament/group-swap')>();
  return {
    ...actual,
    swapBetweenGroups: (...args: Parameters<typeof actual.swapBetweenGroups>) =>
      refusal ? { ok: false as const, error: refusal } : actual.swapBetweenGroups(...args),
  };
});

window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

function drawn(count: number, poolingPhase: 'group-stage' | 'qual-table' = 'group-stage'): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({
      gameFormat: 'individual-1v1',
      poolingPhase,
      groupSize: '4',
      qualifiersPerGroup: '2',
      scheduleLogic: 'single-elimination',
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error('fixture failed');
  return result.state;
}

const fixtureOf = (state: TournamentState): FixtureTournament => ({
  id: 'swap-cup',
  state,
  status: 'published',
  tabs: ['Groups'],
});

/** The Round 1 seats of a room, in order. */
const seat = (state: TournamentState, room: number, position: number) =>
  state.assignments[0].filter((entry) => entry.room === room)[position].name;

/** Scores rooms 1 and 3 of the round in play: the first seat 30, the second 20. */
function scoredRoomsOneAndThree(state: TournamentState): TournamentState {
  const scores = { ...state.scores };
  for (const room of [1, 3]) {
    for (const position of [0, 1]) {
      for (const key of scoreKeysForPosition({ roundIndex: 0, room, position })) {
        scores[key] = position === 0 ? 30 : 20;
      }
    }
  }
  return { ...state, scores };
}

let latest: TournamentState;

function Harness({
  initial,
  role,
  readOnly,
}: {
  initial: TournamentState;
  role: AppRole;
  readOnly?: boolean;
}) {
  const [state, setState] = useState(initial);
  latest = state;
  const base = testAppContext(fixtureOf(initial), role, 'standings');
  return (
    <TournamentContext.Provider
      value={{
        ...base,
        state,
        readOnly: readOnly ?? false,
        updateState: (updater) =>
          setState((current) => (typeof updater === 'function' ? updater(current) : updater)),
      }}
    >
      <StandingsView />
    </TournamentContext.Provider>
  );
}

function show(state: TournamentState, role: AppRole = 'admin', readOnly = false) {
  const initial = loadedState(fixtureOf(state));
  latest = initial;
  return render(<Harness initial={initial} readOnly={readOnly} role={role} />);
}

/** The table's button for a unit (the phone list repeats it later in the page). */
const unitButton = (name: string) => screen.getAllByRole('button', { name: new RegExp(`\\b${name}\\b`) })[0];

const toggle = () => screen.queryByRole('button', { name: '⇄ Swap groups' });

let confirm: MockInstance<typeof window.confirm>;
beforeEach(() => {
  refusal = null;
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Swap groups toggle on the Standings tab', () => {
  it('is shown to an admin before the start and during Round 1', () => {
    show(drawn(13));
    expect(toggle()).not.toBeNull();
    cleanup();
    show({ ...drawn(13), started: true });
    expect(toggle()).not.toBeNull();
  });

  it('is not shown to a viewer, on a finished tournament, without a group stage, or after Round 2 is drawn', () => {
    show({ ...drawn(13), started: true }, 'viewer');
    expect(toggle()).toBeNull();
    cleanup();
    show({ ...drawn(13), started: true }, 'admin', true);
    expect(toggle()).toBeNull();
    cleanup();
    show(drawn(13, 'qual-table'));
    expect(toggle()).toBeNull();
    cleanup();
    const advanced = advanceTournamentRound(scoreCurrentRound({ ...drawn(13), started: true }, 0));
    if (advanced.status !== 'advanced') throw new Error(advanced.status);
    show(advanced.state);
    expect(toggle()).toBeNull();
  });

  it('turns the names into buttons only while it is on', () => {
    show(drawn(13));
    expect(screen.queryByText(/Pick two players of different groups/)).toBeNull();
    expect(unitButton('P1').hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(toggle()!);
    expect(
      screen.getByText(
        /Pick two players of different groups\. Generating the schedule again or a roster change draws new groups\./,
      ),
    ).not.toBeNull();
    expect(unitButton('P1').hasAttribute('aria-pressed')).toBe(true);
    fireEvent.click(toggle()!);
    expect(unitButton('P1').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('picking two units', () => {
  const state = drawn(13);
  const [a, b] = state.groups;

  it('marks the first, moves the mark within its group, and swaps with a unit of another group', () => {
    show(state);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(a.members[0]));
    expect(unitButton(a.members[0]).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(unitButton(a.members[1]));
    expect(unitButton(a.members[0]).getAttribute('aria-pressed')).toBe('false');
    expect(unitButton(a.members[1]).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(unitButton(b.members[2]));
    expect(latest.groups[0].members[1]).toBe(b.members[2]);
    expect(latest.groups[1].members[2]).toBe(a.members[1]);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('unmarks a unit clicked twice', () => {
    show(state);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(a.members[0]));
    fireEvent.click(unitButton(a.members[0]));
    expect(unitButton(a.members[0]).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('a swap during Round 1', () => {
  const started = scoredRoomsOneAndThree({ ...drawn(13), started: true });
  const names = {
    first: seat(started, 1, 0),
    firstOpponent: seat(started, 1, 1),
    second: seat(started, 3, 1),
    secondOpponent: seat(started, 3, 0),
  };

  it('asks first, naming the matches whose results go, and swaps on a yes', () => {
    show(started);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(names.first));
    fireEvent.click(unitButton(names.second));
    expect(confirm).toHaveBeenCalledWith(
      `Swapping ${names.first} and ${names.second} clears the Round 1 results of ${names.first} v ${names.firstOpponent} and ${names.secondOpponent} v ${names.second}. Swap?`,
    );
    expect(Object.keys(latest.scores).filter((key) => key.startsWith('r0-rm1-'))).toEqual([]);
    expect(latest.groups.flatMap((group) => group.members)).toContain(names.first);
  });

  it('leaves everything as it was on a no', () => {
    confirm.mockReturnValue(false);
    show(started);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(names.first));
    fireEvent.click(unitButton(names.second));
    expect(latest.scores).toEqual(started.scores);
    expect(latest.groups).toEqual(started.groups);
  });

  it('does not ask when the two units have no result to lose', () => {
    const unscored = { ...drawn(13), started: true };
    show(unscored);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(names.first));
    fireEvent.click(unitButton(names.second));
    expect(confirm).not.toHaveBeenCalled();
    expect(latest.groups).not.toEqual(unscored.groups);
  });
});

describe('a refused swap', () => {
  it('shows the refusal and keeps the mark', () => {
    refusal = 'Round 2 is drawn — groups are fixed from here.';
    const state = drawn(13);
    show(state);
    fireEvent.click(toggle()!);
    fireEvent.click(unitButton(state.groups[0].members[0]));
    fireEvent.click(unitButton(state.groups[1].members[0]));
    expect(screen.getByText(refusal)).not.toBeNull();
    expect(latest.groups).toEqual(state.groups);
    act(() => {});
  });
});
