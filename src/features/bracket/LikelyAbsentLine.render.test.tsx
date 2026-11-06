// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterRound1 } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import type { TournamentState } from '../../domain/tournament/types';
import { renderApp } from '../shell/test-app';
import { likelyAbsentChips } from './likely-absent-line';

vi.mock('../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));
vi.mock('../auth/server/session-check.server-fns', () => ({ checkSession: () => Promise.resolve('valid') }));
vi.mock('../version/build-id.server-fns', async () => {
  const { TOUR_BUILD_ID } = await import('../version/build-id');
  return { getLiveBuild: () => Promise.resolve(TOUR_BUILD_ID) };
});

window.matchMedia ??= (query) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fixtureOf = (state: TournamentState) => ({
  id: 'likely-absent-line',
  state: { ...state, tournamentId: 'likely-absent-line' },
  status: 'published' as const,
  tabs: ['Bracket'],
});

// 31 players, rooms 8, 8, 8, 7 in round 2; six units absent from round 1, spread over the rooms.
const state = afterRound1(
  [1, 2].flatMap((room) => [0, 1, 2].map((position) => [room, position] as [number, number])),
  3,
);
const chips = likelyAbsentChips(state);

function bracketOf(
  shown: TournamentState,
  role: 'admin' | 'viewer',
  onUpdate?: (next: TournamentState) => void,
) {
  return renderApp(fixtureOf(shown), {
    role,
    tab: 'bracket',
    context: {
      updateState: (value) => onUpdate?.(typeof value === 'function' ? value(shown) : value),
    },
  });
}

describe('the likely-absent line on the Bracket', () => {
  it('shows the names and the count beside Next Round to the organiser', () => {
    expect(chips).toHaveLength(6);
    const view = bracketOf(state, 'admin');
    expect(view.getByText('Likely absent (6)')).toBeTruthy();
    for (const chip of chips)
      expect(view.getByRole('button', { name: `Mark ${chip.label} back` })).toBeTruthy();
    expect(view.getByRole('button', { name: '6 likely absent ↑' })).toBeTruthy();
  });

  it('a click on a name does what the Players tab’s "?" does: the same alert, the unit moved, and the line drops it', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    let changed: TournamentState = state;
    const view = bracketOf(state, 'admin', (next) => {
      changed = next;
    });
    // The unit alone in a room of 8 moves to the room of 7, as on the Players tab (BackAfterDraw.render.test.tsx).
    const sevenRoom = state.rounds[1].rooms.indexOf(7) + 1;
    const roomOf = (unit: string) => state.assignments[1].find((entry) => entry.name === unit)?.room;
    const mover = chips.find((chip) => {
      const room = roomOf(chip.unit);
      const absentInRoom = chips.filter((other) => roomOf(other.unit) === room).length;
      return room !== sevenRoom && state.rounds[1].rooms[(room ?? 1) - 1] === 8 && absentInRoom === 1;
    });
    if (!mover) throw new Error('no likely absentee in a room of 8');
    fireEvent.click(view.getByRole('button', { name: `Mark ${mover.label} back` }));

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toMatch(new RegExp(`^${mover.label} is back: moved to Room [A-D]\\.$`));
    expect(likelyAbsentChips(changed).map((chip) => chip.unit)).not.toContain(mover.unit);
    expect(likelyAbsentChips(changed)).toHaveLength(5);
    cleanup();

    const after = bracketOf(changed, 'admin');
    expect(after.getByText('Likely absent (5)')).toBeTruthy();
    expect(after.queryByRole('button', { name: `Mark ${mover.label} back` })).toBeNull();
    expect(after.getByRole('button', { name: '5 likely absent ↑' })).toBeTruthy();
  });

  it('shows a viewer neither the line nor the count', () => {
    const view = bracketOf(state, 'viewer');
    expect(view.queryByText(/Likely absent/)).toBeNull();
    expect(view.queryByRole('button', { name: /likely absent/ })).toBeNull();
  });

  it('shows neither when nobody is likely absent', () => {
    const view = bracketOf(afterRound1([], 3), 'admin');
    expect(view.queryByText(/Likely absent/)).toBeNull();
    expect(view.queryByRole('button', { name: /likely absent/ })).toBeNull();
  });

  it('shows neither in a version 2 tournament', () => {
    const view = bracketOf(
      afterRound1(
        [1, 2].flatMap((room) => [0, 1, 2].map((position) => [room, position] as [number, number])),
        2,
      ),
      'admin',
    );
    expect(view.queryByText(/Likely absent/)).toBeNull();
    expect(view.queryByRole('button', { name: /likely absent/ })).toBeNull();
  });
});
