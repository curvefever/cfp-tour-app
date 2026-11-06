// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { r1WithFiveAbsent } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
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

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

/** The result stripe classes of the row of `name` in the room card that shows ABS (R1's room A; the warm-up rounds have none). */
function stripeOf(container: HTMLElement, name: string): string {
  const rows = [...container.querySelectorAll<HTMLElement>('div.min-h-8')].filter(
    (row) =>
      row.parentElement?.textContent?.includes('ABS') &&
      [...row.querySelectorAll('span')].some((span) => span.textContent === name),
  );
  expect(rows).toHaveLength(1);
  return rows[0].querySelector('span[aria-hidden="true"].w-1')?.className ?? '';
}

describe('an absentee of a Custom bracket room in the Bracket', () => {
  it('shows the overflow absentee with the red stripe and the other absentees with their band’s', () => {
    const state = { ...r1WithFiveAbsent(), tournamentId: 'absentees' };
    const roomA = state.assignments[state.curRound].filter((entry) => entry.room === 1).map((e) => e.name);
    const view = renderApp(
      { id: 'absentees', state, status: 'published', tabs: ['Bracket'] },
      { role: 'viewer', tab: 'bracket' },
    );
    expect(consoleError).not.toHaveBeenCalled();
    expect(stripeOf(view.container, roomA[3])).toContain('bg-cfp-red');
    for (const name of roomA.slice(4)) expect(stripeOf(view.container, name)).toContain('bg-cfp-yellow');
    for (const name of roomA.slice(0, 3)) expect(stripeOf(view.container, name)).toContain('bg-cfp-green');
  });
});
