// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterRoundOne, pickAbsent, roomsOf } from '../../domain/tournament/__tests__/absentee-fixtures';
import { pressed } from '../../domain/tournament/__tests__/dependency-play-fixtures';
import { swiss } from '../../domain/tournament/__tests__/swiss-source-fixtures';
import type { TournamentState } from '../../domain/tournament/types';
import { renderApp } from '../../test-support/test-app';
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

/** A Swiss of 14 with three likely absentees in round 2: two share a room, the third faces a present unit. */
function roundTwo(): { state: TournamentState; sharing: string[]; facing: string } {
  const start = swiss(14, { gameFormat: 'individual-1v1' });
  const units = pickAbsent(start, 3);
  const state = pressed(afterRoundOne(start, units));
  const sharing = roomsOf(state.assignments[1]).find((room) =>
    room.every((name) => units.includes(name)),
  ) as string[];
  return {
    state: { ...state, tournamentId: 'return-question' },
    sharing,
    facing: units.find((name) => !sharing.includes(name)) as string,
  };
}

const fixtureOf = (state: TournamentState) => ({
  id: 'return-question',
  state,
  status: 'published' as const,
  tabs: ['Rankings'],
});

describe('the toggle of a paired absentee that comes back', () => {
  it('asks before it moves anything, and moves on a yes', () => {
    const { state, sharing } = roundTwo();
    const [unit, partner] = sharing;
    const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    const updates: TournamentState[] = [];
    const view = renderApp(fixtureOf(state), {
      role: 'admin',
      tab: 'rankings',
      context: { updateState: (value) => updates.push(typeof value === 'function' ? value(state) : value) },
    });
    fireEvent.click(view.getByRole('button', { name: `Confirmed: ${unit}` }));
    expect(confirm).toHaveBeenCalledOnce();
    const question = confirm.mock.calls[0][0] as string;
    expect(question).toMatch(
      new RegExp(
        `^${unit} is back, but ${partner} in Room [A-G] is also likely absent\. Move ${unit} to Room [A-G] to play .+\?$`,
      ),
    );
    // The click marked it back, then the "yes" moved it: two updates, the second changes the room.
    expect(updates).toHaveLength(2);
    const room = (value: TournamentState) => value.assignments[1].find((entry) => entry.name === unit)?.room;
    expect(room(updates[0])).toBe(room(state));
    expect(room(updates[1])).not.toBe(room(state));
  });

  it('moves nobody on a no, and says the unit stays', () => {
    const { state, sharing } = roundTwo();
    const [unit] = sharing;
    vi.spyOn(window, 'confirm').mockImplementation(() => false);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const updates: TournamentState[] = [];
    const view = renderApp(fixtureOf(state), {
      role: 'admin',
      tab: 'rankings',
      context: { updateState: (value) => updates.push(typeof value === 'function' ? value(state) : value) },
    });
    fireEvent.click(view.getByRole('button', { name: `Confirmed: ${unit}` }));
    expect(updates).toHaveLength(1);
    expect(alert).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${unit} is back and stays in Room [A-G]\.$`)),
    );
  });
});
