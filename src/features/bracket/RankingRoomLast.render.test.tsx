// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fixtureTournaments, type FixtureTournament } from '../../../e2e/screens/fixtures';
import {
  indexOf,
  pressed,
  resolveEveryTie,
  scoreRound,
} from '../../domain/tournament/__tests__/dependency-play-fixtures';
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

/** FFA 31, upper and lower bracket: Round 4 is drawn, scored in both rooms and not sent on. */
function roundFourScored(): FixtureTournament {
  const fixture = fixtureTournaments().find((entry) => entry.id === 'upper-lower-31');
  if (!fixture) throw new Error('no upper-lower-31 fixture');
  let state = pressed(fixture.state);
  for (const label of ['Round 4 - Upper', 'Round 4 - Lower']) {
    const index = indexOf(state, label);
    state = resolveEveryTie(scoreRound(resolveEveryTie(scoreRound(state, index), index), index), index);
  }
  return { ...fixture, state };
}

const COLUMN = ['Semi-Final A', 'Round 5 - Lower', 'Round 5 - Ranking'];

/** The title bars of the column, in the order the page lists them. */
function barsOf(fixture: FixtureTournament) {
  const view = renderApp(fixture, { role: 'viewer', tab: 'bracket' });
  expect(consoleError).not.toHaveBeenCalled();
  return view
    .getAllByRole('heading', { level: 2 })
    .filter((heading) => COLUMN.includes(heading.textContent ?? ''))
    .map((heading) => ({ title: heading.textContent ?? '', text: heading.parentElement?.textContent ?? '' }));
}

describe('a column holding a ranking room, on the Bracket', () => {
  it('lists the ranking room after the other rounds, and its expected draw keeps the EXPECTED tag', () => {
    const bars = barsOf(roundFourScored());
    expect(bars.map((bar) => bar.title)).toEqual(COLUMN);
    for (const bar of bars) expect(bar.text, bar.title).toContain('EXPECTED');
  });

  it('lists it last once drawn too, with NOW on every round of the column', () => {
    const drawn = { ...roundFourScored() };
    drawn.state = pressed(drawn.state);
    const bars = barsOf(drawn);
    expect(bars.map((bar) => bar.title)).toEqual(COLUMN);
    expect(bars.find((bar) => bar.title === 'Round 5 - Ranking')?.text).toContain('NOW');
    expect(bars.find((bar) => bar.title === 'Round 5 - Lower')?.text).toContain('NOW');
    for (const bar of bars) expect(bar.text, bar.title).not.toContain('EXPECTED');
  });
});
