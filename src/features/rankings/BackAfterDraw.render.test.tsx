// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterRound1 } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import type { TournamentState } from '../../domain/tournament/types';
import { renderApp } from '../shell/test-app';

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
  id: 'back-after-draw',
  state: { ...state, tournamentId: 'back-after-draw' },
  status: 'published' as const,
  tabs: ['Rankings', 'Bracket'],
});

/** The letter of the room card of the round in play that shows `name` on the Bracket. */
function roomLetterOf(view: ReturnType<typeof renderApp>, name: string): string | undefined {
  // The unit is in every round it played: the last card is the round in play.
  let node: HTMLElement | null = view.getAllByText(name, { exact: true }).at(-1) ?? null;
  for (; node; node = node.parentElement) {
    const letter = /Room ([A-Z])/.exec(node.textContent ?? '')?.[1];
    if (letter) return letter;
  }
  return undefined;
}

describe('a unit marked back after the draw', () => {
  // 31 players, rooms 8, 8, 8, 7 in round 2; six units absent from round 1, spread over the rooms.
  const state = afterRound1(
    [1, 2].flatMap((room) => [0, 1, 2].map((position) => [room, position] as [number, number])),
    3,
  );
  const absentees = [1, 2].flatMap((room) =>
    [0, 1, 2].map((position) => state.assignments[0].filter((entry) => entry.room === room)[position].name),
  );
  const roomOf = (name: string) => state.assignments[1].find((entry) => entry.name === name)?.room ?? 0;
  const sevenRoom = state.rounds[1].rooms.indexOf(7) + 1;
  const sizeOf = (room: number) => state.assignments[1].filter((entry) => entry.room === room).length;
  // An absentee alone in a room of 8: the room of 7 is the only room under the largest size, and it has one absentee too.
  const name = absentees.find(
    (candidate) =>
      roomOf(candidate) !== sevenRoom &&
      sizeOf(roomOf(candidate)) === 8 &&
      absentees.filter((other) => roomOf(other) === roomOf(candidate)).length === 1,
  );

  it('moves alone to the room expected to be smaller: the alert names the room and the Bracket shows the unit there', () => {
    if (!name) throw new Error('no absentee alone in a room of 8');
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    let changed: TournamentState = state;
    const rankings = renderApp(fixtureOf(state), {
      role: 'admin',
      tab: 'rankings',
      context: {
        updateState: (value) => {
          changed = typeof value === 'function' ? value(state) : value;
        },
      },
    });
    const toggle = rankings.getByRole('button', { name: `Confirmed: ${name}` });
    expect(toggle.getAttribute('title')).toMatch(/^Absent in .+ — click when back$/);
    fireEvent.click(toggle);

    const room = 'ABCD'[sevenRoom - 1];
    expect(alert).toHaveBeenCalledWith(`${name} is back: moved to Room ${room}.`);
    expect(changed.assignments[1].find((entry) => entry.name === name)?.room).toBe(sevenRoom);
    cleanup();

    const before = renderApp(fixtureOf(state), { role: 'admin', tab: 'bracket' });
    expect(roomLetterOf(before, name)).toBe('ABCD'[roomOf(name) - 1]);
    cleanup();
    const after = renderApp(fixtureOf(changed), { role: 'admin', tab: 'bracket' });
    expect(roomLetterOf(after, name)).toBe(room);
  });

  it('says nothing in a tournament before the draw: the click only turns the toggle', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const inRoundOne: TournamentState = { ...state, curRound: 0, assignments: [state.assignments[0]] };
    const absent = absentees[0];
    const view = renderApp(fixtureOf(inRoundOne), {
      role: 'admin',
      tab: 'rankings',
      context: { updateState: () => {} },
    });
    fireEvent.click(view.getByRole('button', { name: `Confirmed: ${absent}` }));
    expect(alert).not.toHaveBeenCalled();
  });
});
