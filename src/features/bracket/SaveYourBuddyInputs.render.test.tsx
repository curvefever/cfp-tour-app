// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TeamScoringRuleKey, TournamentTeam } from '../../domain/tournament/types';
import type { FixtureTournament } from '../../../e2e/screens/fixtures';
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

function teams(count: number): TournamentTeam[] {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

/** Six 3v3 teams in round 1 (three rooms of two teams), scored by `rule`. */
function threeVThree(rule: TeamScoringRuleKey): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 6, players: teams(6), title: 'Buddy Cup' }),
    createDefaultSetup({
      gameFormat: 'team-3v3',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      teamScoringRule: rule,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  const state = { ...result.state, started: true, tournamentId: 'buddy-inputs' };
  return { id: 'buddy-inputs', state, status: 'published', tabs: ['Bracket'] };
}

function boxesOfSeat(container: HTMLElement, seat: string): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>(`input[data-key^="${seat}-m"]`)).map(
    (input) => input.dataset.key ?? '',
  );
}

describe('the score boxes of a team row, as admin', () => {
  it('gives each team one box in Save your Buddy, named after the defender, with the members on the line', () => {
    const view = renderApp(threeVThree('designated-player'), { role: 'admin', tab: 'bracket' });
    expect(consoleError).not.toHaveBeenCalled();
    expect(boxesOfSeat(view.container, 'r0-rm1-p0')).toEqual(['r0-rm1-p0-m0']);
    expect(boxesOfSeat(view.container, 'r0-rm1-p1')).toEqual(['r0-rm1-p1-m0']);
    const label = view.container.querySelector('input[data-key="r0-rm1-p0-m0"]')?.closest('label');
    expect(label?.textContent).toMatch(/^T\d[a-c] 🛡/);
    // The teammates stay visible on the member line while the box shows.
    expect(view.queryAllByText(/T\d[a-c] 🛡 · T\d[a-c] · T\d[a-c]/).length).toBeGreaterThan(0);
  });

  it('still gives each team three boxes in Sum of members, and no member line', () => {
    const view = renderApp(threeVThree('sum-members'), { role: 'admin', tab: 'bracket' });
    expect(boxesOfSeat(view.container, 'r0-rm1-p0')).toEqual([
      'r0-rm1-p0-m0',
      'r0-rm1-p0-m1',
      'r0-rm1-p0-m2',
    ]);
    expect(view.queryAllByText(/T\d[a-c] · T\d[a-c] · T\d[a-c]/)).toHaveLength(0);
  });
});
