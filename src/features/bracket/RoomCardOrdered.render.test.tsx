// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { pressNextRound, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { scoreRooms } from '../../domain/tournament/__tests__/fair-cut-fixtures';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { isRoundReached } from '../../domain/tournament/round-columns';
import type { TournamentState } from '../../domain/tournament/types';
import { goBack } from '../../domain/tournament/go-back';
import { roomRowsOnPage, unfoldEverything } from '../../test-support/bracket-rows';
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

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

/** FFA 24 in rooms of 8, no pooling: Round 3 (the first elimination round, index 2) is drawn and fully scored while Round 2 is in play. */
function roundThreeScored(): TournamentState {
  let state: TournamentState = {
    ...generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
    started: true,
  };
  for (let press = 0; press < 2; press += 1) state = pressNextRound(scoreCurrentRound(state, 0));
  const room = [5, 9, 3, 7, 1, 8, 2, 4];
  return scoreRooms(state, state.curRound, [room, room, room]);
}

/** The lines of Round 3's Room A (the third card named Room A on the page): place | stripe | unit | rest. */
function roundThreeRoomA(state: TournamentState): string[] {
  const view = renderApp(
    { id: 'ordered', state, status: 'published', tabs: ['Bracket'] },
    { role: 'viewer', tab: 'bracket' },
  );
  unfoldEverything(view.container);
  expect(consoleError).not.toHaveBeenCalled();
  const cards = roomRowsOnPage(view.container).filter((card) => card.startsWith('Room A\n'));
  return cards[2].split('\n').slice(1);
}

const placeOf = (line: string) => line.split(' | ')[0];
const stripeOf = (line: string) => line.split(' | ')[1];
const nameOf = (line: string) => line.split(' | ')[2];

describe('a room with every score entered, in a round that is reached or not', () => {
  it('shows the places and the order of the scores in a round that is reached', () => {
    const state = roundThreeScored();
    expect(isRoundReached(state, 2)).toBe(true);
    const lines = roundThreeRoomA(state);
    expect(lines.map(placeOf)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    // Listed best score first, not in seat order, and each row carries its band's colour.
    const seats = state.assignments[2].filter((entry) => entry.room === 1).map((entry) => entry.name);
    expect(lines.map(nameOf)).toEqual([1, 5, 3, 0, 7, 2, 6, 4].map((seat) => seats[seat]));
    expect(lines.map(stripeOf)).toEqual(Array(6).fill('green').concat(['dashed', 'red']));
  });

  it('keeps the seat order, with no place, in a round after the one in play (Previous keeps its scores), every row undecided', () => {
    const state = goBack(roundThreeScored());
    expect(state.curRound).toBe(1);
    expect(isRoundReached(state, 2)).toBe(false);
    const lines = roundThreeRoomA(state);
    const seats = state.assignments[2].filter((entry) => entry.room === 1).map((entry) => entry.name);
    expect(lines.map(nameOf)).toEqual(seats);
    expect(lines.map(placeOf)).toEqual(Array(8).fill(''));
    expect(lines.map(stripeOf)).toEqual(Array(8).fill('dashed'));
  });
});
