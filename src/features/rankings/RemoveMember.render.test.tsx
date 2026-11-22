// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FixtureTournament } from '../../../e2e/screens/fixtures';
import { getDefenderIndex } from '../../domain/tournament/scoring';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState, TournamentTeam } from '../../domain/tournament/types';
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

function teams(): TournamentTeam[] {
  return Array.from({ length: 8 }, (_, index) => ({
    teamId: `t${index + 1}`,
    teamName: `Team ${index + 1}`,
    members: ['a', 'b', 'c'].map((member) => ({ name: `T${index + 1}${member}` })),
  }));
}

/** An 8-team 3v3 Save your Buddy single elimination, started. */
function sybTournament(): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: 8, players: teams(), title: 'Buddy Cup' }),
    createDefaultSetup({
      gameFormat: 'team-3v3',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      teamScoringRule: 'designated-player',
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  const state: TournamentState = { ...result.state, started: true, tournamentId: 'buddy-cup' };
  return { id: 'buddy-cup', state, status: 'published', tabs: ['Rankings'] };
}

let consoleError: MockInstance<typeof console.error>;
let alert: MockInstance<typeof window.alert>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  consoleError.mockRestore();
});

describe('the Remove member button of Manage teams', () => {
  it('moves the defender mark to the next member and says so', () => {
    const updateState = vi.fn();
    const view = renderApp(sybTournament(), { role: 'admin', tab: 'rankings', context: { updateState } });
    fireEvent.click(view.getByLabelText('Remove T1a'));
    expect(alert).toHaveBeenCalledWith('T1a was removed. T1b is now the defender of Team 1.');
    const next = updateState.mock.calls.at(-1)?.[0] as TournamentState;
    expect(getDefenderIndex(next, 't1', next.curRound)).toBe(1);
    expect((next.players as TournamentTeam[])[0].members[0]).toBeNull();
  });

  it('says nothing when a teammate of the defender is removed', () => {
    const updateState = vi.fn();
    const view = renderApp(sybTournament(), { role: 'admin', tab: 'rankings', context: { updateState } });
    fireEvent.click(view.getByLabelText('Remove T1c'));
    expect(alert).not.toHaveBeenCalled();
    const next = updateState.mock.calls.at(-1)?.[0] as TournamentState;
    expect(getDefenderIndex(next, 't1', next.curRound)).toBe(0);
  });

  it('says when the team has no member left', () => {
    const state = sybTournament().state;
    const team = (state.players as TournamentTeam[])[0];
    const alone: TournamentState = {
      ...state,
      players: [
        { ...team, members: [team.members[0], null, null] },
        ...state.players.slice(1),
      ] as TournamentState['players'],
    };
    const updateState = vi.fn();
    const view = renderApp(
      { ...sybTournament(), state: alone },
      { role: 'admin', tab: 'rankings', context: { updateState } },
    );
    fireEvent.click(view.getByLabelText('Remove T1a'));
    expect(alert).toHaveBeenCalledWith('T1a was removed. Team 1 has no member left.');
  });

  it('does not remove anything when the confirm is declined', () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => false);
    const updateState = vi.fn();
    const view = renderApp(sybTournament(), { role: 'admin', tab: 'rankings', context: { updateState } });
    fireEvent.click(view.getByLabelText('Remove T1a'));
    expect(updateState).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });
});
