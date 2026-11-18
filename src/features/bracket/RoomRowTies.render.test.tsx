// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { scoreRooms } from '../../domain/tournament/__tests__/fair-cut-fixtures';
import { pressNextRound, scoreCurrentRound } from '../../domain/tournament/__tests__/play-through';
import { generated } from '../../domain/tournament/__tests__/test-fixtures';
import { SHARED_TIE_MARK } from '../../domain/tournament/scoring';
import type { TournamentState } from '../../domain/tournament/types';
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

/**
 * FFA 24 in rooms of 8, single elimination: the first elimination round (Round 3) sends places 1 to 6 on, gives place 7
 * a lucky-loser chance and cuts place 8. Its Room A is scored with `scores` (seat by seat) and the tie at `tieScore`
 * is left alone, picked (the unit at seat `picks[1]` first) or shared by the units at the two seats.
 */
function roomAStripes(
  scores: number[],
  tieScore: number,
  picks: [number, number],
  decision: 'pending' | 'picked' | 'shared',
): string[] {
  let state: TournamentState = {
    ...generated(24, { scheduleLogic: 'single-elimination', poolingPhase: 'none' }),
    started: true,
  };
  while (state.rounds[state.curRound].isNoElim) state = pressNextRound(scoreCurrentRound(state, 0));
  const round = state.curRound;
  const seats = state.assignments[round].filter((entry) => entry.room === 1).map((entry) => entry.name);
  const key = `r${round}-rm1-s${tieScore}`;
  const resolutions = {
    pending: {},
    picked: { [key]: [seats[picks[1]]] },
    shared: { [key]: [SHARED_TIE_MARK, seats[picks[0]], seats[picks[1]]] },
  }[decision];
  const scored = { ...scoreRooms(state, round, [scores]), tieResolutions: resolutions };
  const view = renderApp(
    { id: 'ties', state: scored, status: 'published', tabs: ['Bracket'] },
    { role: 'viewer', tab: 'bracket' },
  );
  unfoldEverything(view.container);
  expect(consoleError).not.toHaveBeenCalled();
  // The first card with a stripe is Room A of the round in play: the rounds before it are pooling rounds with none.
  const card = roomRowsOnPage(view.container).find((room) =>
    /\| (green|red|dashed|yellow|neutral) \|/.test(room),
  );
  return (card ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.split(' | ').slice(0, 2).join(' '));
}

describe('a tie across a line of a room in the Bracket: the rows take the place the room gives them', () => {
  it('a tie for 6th and 7th: both rows wait while it is pending, one goes on once picked, both go on once shared', () => {
    const scores = [10, 9, 8, 7, 6, 5, 5, 1];
    const front = ['1 green', '2 green', '3 green', '4 green', '5 green'];
    expect(roomAStripes(scores, 5, [5, 6], 'pending')).toEqual([...front, '6 dashed', '7 dashed', '8 red']);
    expect(roomAStripes(scores, 5, [5, 6], 'picked')).toEqual([...front, '6 green', '7 dashed', '8 red']);
    expect(roomAStripes(scores, 5, [5, 6], 'shared')).toEqual([...front, '=6 green', '=6 green', '8 red']);
  });

  it('a tie for 7th and 8th: both rows wait until it is decided, then the pick is out and the other a chance, or both share the chance', () => {
    const scores = [10, 9, 8, 7, 6, 5, 4, 4];
    const front = ['1 green', '2 green', '3 green', '4 green', '5 green', '6 green'];
    expect(roomAStripes(scores, 4, [6, 7], 'pending')).toEqual([...front, '7 dashed', '8 dashed']);
    expect(roomAStripes(scores, 4, [6, 7], 'picked')).toEqual([...front, '7 dashed', '8 red']);
    expect(roomAStripes(scores, 4, [6, 7], 'shared')).toEqual([...front, '=7 dashed', '=7 dashed']);
  });
});
