// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { r1WithFiveAbsent } from '../../domain/tournament/__tests__/absentee-bracket-fixture';
import { markBack } from '../../domain/tournament/likely-absentees';
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

afterEach(cleanup);

const fixtureOf = (state: ReturnType<typeof r1WithFiveAbsent>) => ({
  id: 'absentees',
  state: { ...state, tournamentId: 'absentees' },
  status: 'published' as const,
  tabs: ['Rankings'],
});

describe('the confirmation toggle of the Players tab', () => {
  const state = r1WithFiveAbsent();
  const room = state.assignments[state.curRound]
    .filter((entry) => entry.room === 1)
    .map((entry) => entry.name);
  const [present, absent] = [room[0], room[4]];
  const toggle = (view: ReturnType<typeof renderApp>, name: string) =>
    view.getByRole('button', { name: `Confirmed: ${name}` });

  it('reads "?" with its title for a unit absent from the round in play, and ✓ for one that played', () => {
    const view = renderApp(fixtureOf(state), { role: 'admin', tab: 'rankings' });
    expect(toggle(view, absent).textContent).toBe('?');
    expect(toggle(view, absent).getAttribute('title')).toBe('Absent in R1 — click when back');
    expect(toggle(view, present).textContent).toBe('✓');
    expect((toggle(view, present) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads ✓ with "Back from" once the unit is marked back, and stays clickable to undo', () => {
    const view = renderApp(fixtureOf(markBack(state, absent)), { role: 'admin', tab: 'rankings' });
    expect(toggle(view, absent).textContent).toBe('✓');
    expect(toggle(view, absent).getAttribute('title')).toBe('Back from R1 — click to undo');
    expect((toggle(view, absent) as HTMLButtonElement).disabled).toBe(false);
  });
});
