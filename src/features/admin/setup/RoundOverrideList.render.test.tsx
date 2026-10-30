// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FixtureTournament } from '../../../../e2e/screens/fixtures';
import { generateTournament } from '../../../domain/tournament/generation';
import { createTournamentRuntime } from '../../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { renderApp } from '../../shell/test-app';

vi.mock('../../sync/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sync/firebase-client')>()),
  subscribePresence: () => () => {},
  subscribeServerClockOffset: () => () => {},
}));
vi.mock('../../presence/presence.server-fns', () => ({ setSetupPresence: () => Promise.resolve(null) }));
vi.mock('../../auth/server/session-check.server-fns', () => ({
  checkSession: () => Promise.resolve('valid'),
}));
vi.mock('../../version/build-id.server-fns', async () => {
  const { TOUR_BUILD_ID } = await import('../../version/build-id');
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

const SETUP = {
  gameFormat: 'individual-1v1',
  scheduleLogic: 'single-elimination',
  poolingPhase: 'none',
  bracketBestOf: '3',
  matchOverrides: 'Round 3: GAMES 2\nRound 99: BO5',
} satisfies Partial<PersistedSetup>;

/** A 1v1 single elimination of 37 players, drawn and not started: Round 3 plays 2 games over the stage's Best of 3. */
function drawn(): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: 37,
      players: Array.from({ length: 37 }, (_, index) => `P${index + 1}`),
      title: 'Override Cup',
    }),
    createDefaultSetup(SETUP),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  return {
    id: 'override-cup',
    state: { ...result.state, tournamentId: 'override-cup' },
    status: 'published',
    tabs: ['Admin'],
  };
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

function list(fixture: FixtureTournament, context: Parameters<typeof renderApp>[1]['context'] = {}) {
  const view = renderApp(fixture, { role: 'admin', tab: 'admin', context });
  return within(view.getByText('Round formats').parentElement?.parentElement as HTMLElement);
}

describe('the round format list of the Setup', () => {
  it('lists the rounds of the drawn schedule, the stage format as the first option, and the override a round has', () => {
    const rows = list(drawn());
    for (const name of ['Round 1', 'Round 3', 'Round 4', 'Semis', 'Final']) {
      expect(rows.getByLabelText(name)).toBeTruthy();
    }
    const round3 = rows.getByLabelText<HTMLSelectElement>('Round 3');
    expect(round3.value).toBe('2');
    const round4 = rows.getByLabelText<HTMLSelectElement>('Round 4');
    expect(round4.value).toBe('');
    expect(within(round4).getAllByRole('option')[0].textContent).toBe('Stage format (Best of 3)');
    expect(
      within(rows.getByLabelText<HTMLSelectElement>('Round 1')).getAllByRole('option')[0].textContent,
    ).toBe('Stage format (Single game)');
    expect(
      within(rows.getByLabelText<HTMLSelectElement>('Final')).getAllByRole('option')[0].textContent,
    ).toBe('Stage format (3 games (sum))');
  });

  it('lists an override that no round has as an orphan with a remove button', () => {
    const rows = list(drawn());
    expect(rows.getByText('Round 99 · not in the schedule')).toBeTruthy();
    expect(rows.getByRole('button', { name: 'Remove the override of Round 99' })).toBeTruthy();
    expect(rows.queryByLabelText('Round 99')).toBeNull();
  });

  it('writes the override to the Setup and plays the drawn round in it at once', () => {
    const fixture = drawn();
    const updateSetup = vi.fn();
    const updateState = vi.fn();
    const rows = list(fixture, { updateSetup, updateState });
    fireEvent.change(rows.getByLabelText('Round 4'), { target: { value: 'bo5' } });
    const setup = (updateSetup.mock.calls[0][0] as (current: PersistedSetup) => PersistedSetup)(
      createDefaultSetup(SETUP),
    );
    expect(setup.matchOverrides).toBe('Round 3: GAMES 2\nRound 99: BO5\nRound 4: BO5');
    const next = (updateState.mock.calls[0][0] as (current: TournamentState) => TournamentState)(
      fixture.state,
    );
    const round = (state: TournamentState, number: number) => state.rounds.find((r) => r.roundNum === number);
    expect(round(next, 4)).toMatchObject({ bestOf: 5, numGames: 5 });
    expect(round(next, 5)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(next.gamemodeConfig.matchOverrides).toMatchObject({ 'Round 4': 'BO5', 'Round 3': 'GAMES 2' });
    expect(next.settings?.matchOverrides).toContain('Round 4: BO5');
  });

  it("removes a round's line when the stage format is chosen again, and an orphan's with Remove", () => {
    const fixture = drawn();
    const updateSetup = vi.fn();
    const updateState = vi.fn();
    const rows = list(fixture, { updateSetup, updateState });
    const apply = (call: number) =>
      (updateSetup.mock.calls[call][0] as (current: PersistedSetup) => PersistedSetup)(
        createDefaultSetup(SETUP),
      );
    fireEvent.change(rows.getByLabelText('Round 3'), { target: { value: '' } });
    expect(apply(0).matchOverrides).toBe('Round 99: BO5');
    fireEvent.click(rows.getByRole('button', { name: 'Remove the override of Round 99' }));
    expect(apply(1).matchOverrides).toBe('Round 3: GAMES 2');
    const next = (updateState.mock.calls[1][0] as (current: TournamentState) => TournamentState)(
      fixture.state,
    );
    expect(next.gamemodeConfig.matchOverrides).toEqual({ 'Round 3': 'GAMES 2' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('is not shown once the tournament has started', () => {
    const fixture = drawn();
    const view = renderApp(
      { ...fixture, state: { ...fixture.state, started: true } },
      { role: 'admin', tab: 'admin' },
    );
    expect(view.queryByText('Round formats')).toBeNull();
  });
});

describe('the stage selects of the Setup', () => {
  it('lists the stages of single elimination, with the elimination rounds prefilled', () => {
    const view = renderApp(drawn(), { role: 'admin', tab: 'admin' });
    expect((view.getByLabelText('Pooling rounds') as HTMLSelectElement).value).toBe('1');
    expect((view.getByLabelText('Elimination rounds') as HTMLSelectElement).value).toBe('bo3');
    expect((view.getByLabelText('Semis format') as HTMLSelectElement).value).toBe('1');
    expect(view.queryByLabelText('Losers rounds')).toBeNull();
  });

  it('lists the match selects in play order: pooling, elimination, Semis size and format, then the Final', () => {
    const view = renderApp(drawn(), { role: 'admin', tab: 'admin' });
    const ids = [
      'cfg-pooling-games',
      'cfg-bracket-games',
      'cfg-semis-override',
      'cfg-semis-games',
      'cfg-finals-games',
    ];
    const found = [...view.container.querySelectorAll<HTMLElement>(ids.map((id) => `#${id}`).join(','))];
    expect(found.map((element) => element.id)).toEqual(ids);
  });

  it('plays the drawn schedule in a stage format at once', () => {
    const fixture = drawn();
    const updateSetup = vi.fn();
    const updateState = vi.fn();
    const view = renderApp(fixture, { role: 'admin', tab: 'admin', context: { updateSetup, updateState } });
    fireEvent.change(view.getByLabelText('Pooling rounds'), { target: { value: 'bo3' } });
    const setup = (updateSetup.mock.calls[0][0] as (current: PersistedSetup) => PersistedSetup)(
      createDefaultSetup(SETUP),
    );
    expect(setup).toMatchObject({ poolingBestOf: '3', poolingGames: '1' });
    const next = (updateState.mock.calls[0][0] as (current: TournamentState) => TournamentState)(
      fixture.state,
    );
    expect(next.rounds[0]).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(next.gamemodeConfig).toMatchObject({ poolingBestOf: 3, bracketBestOf: 3 });
    expect(next.settings).toMatchObject({ poolingBestOf: '3' });
  });

  it('names the first stage after the schedule and offers the losers rounds in a double elimination', () => {
    const result = generateTournament(
      createDefaultTournamentState({
        confirmedCount: 37,
        players: Array.from({ length: 37 }, (_, index) => `P${index + 1}`),
        title: 'Shared Cup',
      }),
      createDefaultSetup({
        gameFormat: 'ffa-individual',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'none',
      }),
      createTournamentRuntime(),
    );
    if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
    const view = renderApp(
      { id: 'shared-cup', state: result.state, status: 'published', tabs: ['Admin'] },
      { role: 'admin', tab: 'admin' },
    );
    expect(view.getByLabelText('Winners rounds')).toBeTruthy();
    expect(view.getByLabelText('Losers rounds')).toBeTruthy();
    expect(view.queryByLabelText('Elimination rounds')).toBeNull();
  });
});
