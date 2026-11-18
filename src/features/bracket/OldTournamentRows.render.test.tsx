// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { loadStored } from '../../domain/tournament/__tests__/old-tournaments-pins';
import { roomRowsOnPage, unfoldEverything } from '../../test-support/bracket-rows';
import { renderApp } from '../../test-support/test-app';
import { OLD_TOURNAMENT_ROWS } from './old-tournament-rows-pins';

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

function stored(id: string): unknown {
  return JSON.parse(readFileSync(`src/domain/tournament/__tests__/old-tournaments/${id}.json`, 'utf8'));
}

/** What the Bracket of a finished old tournament draws in every room, each folded column opened. */
function rowsOfOldBracket(id: string): string[] {
  const state = loadStored(stored(id));
  const view = renderApp(
    { id, state, status: 'finished', tabs: ['Bracket'] },
    { role: 'viewer', tab: 'bracket' },
  );
  unfoldEverything(view.container);
  expect(consoleError).not.toHaveBeenCalled();
  return roomRowsOnPage(view.container);
}

/**
 * The only guard of how the rooms of the old tournaments look: the unit, place, result stripe and marks of every row of
 * every room (A3's pins cover the standings and Rankings, not the rows). The tournaments hold no absentee, so the rows
 * of an absentee are pinned by the other bracket render tests.
 */
describe('the rows of every room of the old tournaments in the Bracket', () => {
  it.each([
    ['18 Oct 2026, 2v2v2v2 Survival Teams', '1792339397443'],
    ['20 Oct 2026, FFA test run', '1792489989400'],
    ['1 Nov 2026, 4v4 Classic Teams', '1793555835749'],
  ])('%s (%s)', (_name, id) => {
    expect(rowsOfOldBracket(id)).toEqual(OLD_TOURNAMENT_ROWS[id]);
  });

  it('draws a result stripe on the rows of a per-room round and none in a pooling room', () => {
    const rooms = Object.values(OLD_TOURNAMENT_ROWS).flat();
    const stripes = (room: string) =>
      room
        .split('\n')
        .slice(1)
        .map((line) => line.split(' | ')[1]);
    expect(rooms.some((room) => stripes(room).includes('red'))).toBe(true);
    expect(rooms.some((room) => stripes(room).includes('green'))).toBe(true);
    expect(rooms.some((room) => stripes(room).every((tone) => tone === '-'))).toBe(true);
  });
});
