// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { finalScoreKey } from '../../domain/tournament/scoring';
import type { TeamScoringRuleKey, TournamentState, TournamentTeam } from '../../domain/tournament/types';
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

/** Six 3v3 teams in round 1 (three rooms of two teams), scored by `rule`; `games` games in round 1. */
function threeVThree(rule: TeamScoringRuleKey, games = 1, count = 6): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: teams(count), title: 'Buddy Cup' }),
    createDefaultSetup({
      gameFormat: 'team-3v3',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
      teamScoringRule: rule,
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  const rounds = result.state.rounds.map((round, index) =>
    index === 0 && games > 1 ? { ...round, numGames: games } : round,
  );
  const state = { ...result.state, rounds, started: true, tournamentId: 'buddy-inputs' };
  return { id: 'buddy-inputs', state, status: 'published', tabs: ['Bracket'] };
}

/** Four 3v3 teams, the Final in play with two of them: the Final's score boxes show for game 1. */
function inTheFinal(rule: TeamScoringRuleKey): FixtureTournament {
  const { state } = threeVThree(rule, 1, 4);
  const finalIndex = state.rounds.findIndex((round) => round.isFinal);
  const assignments = [...state.assignments];
  assignments[finalIndex] = ['t1', 't2'].map((name) => ({ name, room: 1, isLucky: false }));
  return {
    id: 'buddy-inputs',
    state: { ...state, assignments, curRound: finalIndex },
    status: 'published',
    tabs: ['Bracket'],
  };
}

function boxesOfSeat(container: HTMLElement, seat: string): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>(`input[data-key^="${seat}-"]`)).map(
    (input) => input.dataset.key ?? '',
  );
}

/** The row a score box sits in: the box's wrapper (or a game's label, then its wrapper), then the row. */
function rowOf(element: Element | null | undefined): Element {
  const row = element?.closest('[class*="min-h-8"]');
  if (!row) throw new Error('no row');
  return row;
}

/** Types into a box and leaves it, as the organiser does; the state the app then holds is `committed()`. */
function renderAdmin(fixture: FixtureTournament) {
  let committed: TournamentState | null = null;
  const view = renderApp(fixture, {
    role: 'admin',
    tab: 'bracket',
    context: {
      updateState: (updater) => {
        committed = typeof updater === 'function' ? updater(fixture.state) : updater;
      },
    },
  });
  const type = (input: Element, value: string) => {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  };
  return { view, type, committed: () => committed };
}

describe('the score boxes of a team row, as admin', () => {
  it("gives each team one unlabelled box in Save your Buddy, on the defender's key, with the defender's name once", () => {
    const { view } = renderAdmin(threeVThree('designated-player'));
    expect(consoleError).not.toHaveBeenCalled();
    expect(boxesOfSeat(view.container, 'r0-rm1-p0')).toEqual(['r0-rm1-p0-m0']);
    expect(boxesOfSeat(view.container, 'r0-rm1-p1')).toEqual(['r0-rm1-p1-m0']);
    const box = view.container.querySelector('input[data-key="r0-rm1-p0-m0"]');
    expect(box?.closest('label')).toBeNull();
    // The row shows each member once: the defender is on the member line, with the shield, and not again by the box.
    const row = rowOf(box);
    expect(row.textContent?.match(/T\d[a-c]/g)).toHaveLength(3);
    expect(row.textContent?.match(/T\d[a-c]\sDefender/g)).toHaveLength(1);
    expect(row.querySelectorAll('[role="img"][aria-label="Defender"]')).toHaveLength(1);
    expect(box?.parentElement?.textContent).toBe('');
  });

  it("writes the typed score on the defender's member key", () => {
    const { view, type, committed } = renderAdmin(threeVThree('designated-player'));
    const box = view.container.querySelector('input[data-key="r0-rm1-p0-m0"]');
    if (!box) throw new Error('no box');
    type(box, '37');
    expect(committed()?.scores['r0-rm1-p0-m0']).toBe(37);
  });

  it("gives a two-game room one unlabelled G1, G2 box each on the defender's keys", () => {
    const { view } = renderAdmin(threeVThree('designated-player', 2));
    expect(boxesOfSeat(view.container, 'r0-rm1-p0')).toEqual(['r0-rm1-p0-g1-m0', 'r0-rm1-p0-g2-m0']);
    const first = view.container.querySelector('input[data-key="r0-rm1-p0-g1-m0"]');
    const labels = Array.from(first?.closest('label')?.parentElement?.querySelectorAll('label') ?? []);
    // A game's label is "G1": no member's name.
    expect(labels.map((label) => label.textContent)).toEqual(['G1', 'G2']);
    const row = rowOf(first);
    expect(row.textContent?.match(/T\d[a-c]\sDefender/g)).toHaveLength(1);
    expect(row.textContent?.match(/T\d[a-c]/g)).toHaveLength(3);
  });

  it('still gives each team three labelled boxes in Sum of members, and no member line', () => {
    const { view } = renderAdmin(threeVThree('sum-members'));
    expect(boxesOfSeat(view.container, 'r0-rm1-p0')).toEqual([
      'r0-rm1-p0-m0',
      'r0-rm1-p0-m1',
      'r0-rm1-p0-m2',
    ]);
    const labels = ['m0', 'm1', 'm2'].map(
      (member) =>
        view.container.querySelector(`input[data-key="r0-rm1-p0-${member}"]`)?.closest('label')?.textContent,
    );
    expect(labels.every((label) => /^T\d[a-c]$/.test(label ?? ''))).toBe(true);
    expect(view.queryAllByText(/T\d[a-c] · T\d[a-c] · T\d[a-c]/)).toHaveLength(0);
  });
});

describe('the Final of a team format, as admin', () => {
  it('gives each team one unlabelled box in Save your Buddy, with the members once on the line', () => {
    const { view } = renderAdmin(inTheFinal('designated-player'));
    const boxes = Array.from(view.container.querySelectorAll('input[type="number"]'));
    expect(boxes).toHaveLength(2);
    expect(boxes.map((box) => box.closest('label'))).toEqual([null, null]);
    const row = rowOf(boxes[0]);
    expect(row.textContent?.match(/T\d[a-c]/g)).toHaveLength(3);
    expect(row.textContent?.match(/T\d[a-c]\sDefender/g)).toHaveLength(1);
  });

  it("writes the typed score on the defender's Final key", () => {
    const { view, type, committed } = renderAdmin(inTheFinal('designated-player'));
    const box = view.container.querySelector('input[type="number"]');
    if (!box) throw new Error('no box');
    type(box, '12');
    expect(committed()?.finalScores[finalScoreKey(1, 't1', 0)]).toBe(12);
  });

  it('still gives each team three labelled boxes in Sum of members', () => {
    const { view } = renderAdmin(inTheFinal('sum-members'));
    const boxes = Array.from(view.container.querySelectorAll('input[type="number"]'));
    expect(boxes).toHaveLength(6);
    expect(boxes.every((box) => /^T\d[a-c]$/.test(box.closest('label')?.textContent ?? ''))).toBe(true);
  });
});
