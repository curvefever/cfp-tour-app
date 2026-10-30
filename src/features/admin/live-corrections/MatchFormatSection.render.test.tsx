// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FixtureTournament } from '../../../../e2e/screens/fixtures';
import { generateTournament } from '../../../domain/tournament/generation';
import { createTournamentRuntime } from '../../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { advanceTournamentRound } from '../../../domain/tournament/transitions';
import type { TournamentState } from '../../../domain/tournament/types';
import { scoreCurrentRound } from '../../../domain/tournament/__tests__/play-through';
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

/** A 1v1 single elimination of 37 players, no pooling, played to the Semis. */
function inSemis(): FixtureTournament {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: 37,
      players: Array.from({ length: 37 }, (_, index) => `P${index + 1}`),
      title: 'Match Cup',
    }),
    createDefaultSetup({
      gameFormat: 'individual-1v1',
      scheduleLogic: 'single-elimination',
      poolingPhase: 'none',
    }),
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  let state: TournamentState = { ...result.state, started: true, tournamentId: 'match-cup' };
  while (!state.rounds[state.curRound].isSemis) {
    const advanced = advanceTournamentRound(scoreCurrentRound(state, 0));
    if (advanced.status !== 'advanced') throw new Error(`stopped at round ${state.curRound}`);
    state = advanced.state;
  }
  return { id: 'match-cup', state, status: 'published', tabs: ['Admin'] };
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

describe('the Match format section of "Correct current round"', () => {
  it('lists the Semis and the Final prefilled, and saves a Best of 3 for the Final', () => {
    const updateState = vi.fn();
    const view = renderApp(inSemis(), { role: 'admin', tab: 'admin', context: { updateState } });
    const section = within(view.getByText('Match format').closest('div') as HTMLElement);
    const semis = section.getByLabelText<HTMLSelectElement>('Semis format');
    const finals = section.getByLabelText<HTMLSelectElement>('Final format');
    expect(semis.value).toBe('1');
    expect(finals.value).toBe('3');
    expect(semis.disabled).toBe(false);
    const save = section.getByRole<HTMLButtonElement>('button', { name: 'Save match format' });
    expect(save.disabled).toBe(true);

    fireEvent.change(finals, { target: { value: 'bo3' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(updateState).toHaveBeenCalledTimes(1);
    const saved = updateState.mock.calls[0][0] as TournamentState;
    expect(saved.rounds.find((round) => round.isFinal)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(saved.settings).toMatchObject({ finalsBestOf: '3' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('disables the Semis format once the Final is in play, and still lets the Final change', () => {
    const semis = inSemis();
    const advanced = advanceTournamentRound(scoreCurrentRound(semis.state, 0));
    if (advanced.status !== 'advanced') throw new Error('could not reach the Final');
    const view = renderApp({ ...semis, state: advanced.state }, { role: 'admin', tab: 'admin' });
    const section = within(view.getByText('Match format').closest('div') as HTMLElement);
    expect(section.getByLabelText<HTMLSelectElement>('Semis format').disabled).toBe(true);
    expect(section.getByLabelText<HTMLSelectElement>('Final format').disabled).toBe(false);
  });

  it('lists the stages and only the rounds not finished, the stage format as the first option of a round', () => {
    const view = renderApp(inSemis(), { role: 'admin', tab: 'admin' });
    const section = within(view.getByText('Match format').closest('div') as HTMLElement);
    for (const label of [
      'Pooling rounds format',
      'Elimination rounds format',
      'Semis format',
      'Final format',
    ]) {
      expect(section.getByLabelText(label)).toBeTruthy();
    }
    expect(section.getByLabelText<HTMLSelectElement>('Pooling rounds format').disabled).toBe(true);
    expect(section.queryByLabelText('Round 1')).toBeNull();
    expect(section.queryByLabelText('Round 4')).toBeNull();
    const semis = section.getByLabelText<HTMLSelectElement>('Semis');
    expect(semis.value).toBe('');
    expect(within(semis).getAllByRole('option')[0].textContent).toBe('Stage format (Single game)');
    expect(
      within(section.getByLabelText<HTMLSelectElement>('Final')).getAllByRole('option')[0].textContent,
    ).toBe('Stage format (3 games (sum))');
  });

  it('saves a round row as an override, and a stage together with it', () => {
    const updateState = vi.fn();
    const view = renderApp(inSemis(), { role: 'admin', tab: 'admin', context: { updateState } });
    const section = within(view.getByText('Match format').closest('div') as HTMLElement);
    const save = section.getByRole<HTMLButtonElement>('button', { name: 'Save match format' });
    fireEvent.change(section.getByLabelText('Semis'), { target: { value: 'bo3' } });
    fireEvent.change(section.getByLabelText('Final format'), { target: { value: 'bo5' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const saved = updateState.mock.calls[0][0] as TournamentState;
    expect(saved.rounds.find((round) => round.isSemis)).toMatchObject({ bestOf: 3, numGames: 3 });
    expect(saved.rounds.find((round) => round.isFinal)).toMatchObject({ bestOf: 5, numGames: 5 });
    expect(saved.gamemodeConfig).toMatchObject({ finalsBestOf: 5, matchOverrides: { Semis: 'BO3' } });
    expect(saved.settings).toMatchObject({ finalsBestOf: '5', matchOverrides: 'Semis: BO3' });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('shows the refusal of a round and saves nothing', () => {
    const updateState = vi.fn();
    const semis = inSemis();
    const typed = {
      ...semis.state,
      scores: { ...semis.state.scores, [`r${semis.state.curRound}-rm1-p0-g3`]: 9 },
    };
    const best = {
      ...typed,
      rounds: typed.rounds.map((round) => (round.isSemis ? { ...round, bestOf: 3, numGames: 3 } : round)),
    };
    const view = renderApp(
      { ...semis, state: best },
      { role: 'admin', tab: 'admin', context: { updateState } },
    );
    const section = within(view.getByText('Match format').closest('div') as HTMLElement);
    fireEvent.change(section.getByLabelText('Semis'), { target: { value: '2' } });
    fireEvent.click(section.getByRole('button', { name: 'Save match format' }));
    expect(section.getByText(/already has scores for game 3/)).toBeTruthy();
    expect(updateState).not.toHaveBeenCalled();
  });
});
