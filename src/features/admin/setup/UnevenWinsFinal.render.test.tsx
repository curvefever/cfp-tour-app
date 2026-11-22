// @vitest-environment jsdom
import { cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FixtureTournament } from '../../../../e2e/screens/fixtures';
import { generateTournament } from '../../../domain/tournament/generation';
import { createTournamentRuntime } from '../../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { renderApp } from '../../../test-support/test-app';

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

const SWISS = {
  gameFormat: 'individual-1v1',
  scheduleLogic: 'upper-lower',
  poolingPhase: 'swiss',
  oddCountStrategy: 'bye',
  qualAdv: '8',
} satisfies Partial<PersistedSetup>;

function drawn(setup: Partial<PersistedSetup>): FixtureTournament {
  const form = createDefaultSetup({ ...SWISS, ...setup });
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: form.gameFormat === 'ffa-individual' ? 31 : 13,
      players: Array.from(
        { length: form.gameFormat === 'ffa-individual' ? 31 : 13 },
        (_, index) => `P${index + 1}`,
      ),
      title: 'Uneven Cup',
    }),
    form,
    createTournamentRuntime(),
  );
  if (result.status !== 'generated') throw new Error(`generation failed: ${result.message}`);
  const state: TournamentState = { ...result.state, tournamentId: 'uneven-cup' };
  return { id: 'uneven-cup', state, status: 'published', tabs: ['Admin'] };
}

let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  consoleError.mockRestore();
});

const finalsSelect = (view: ReturnType<typeof renderApp>) =>
  view.getByLabelText('Finals format') as HTMLSelectElement;
const optionTexts = (select: HTMLSelectElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('the Finals format select of an upper and lower bracket', () => {
  it('offers Uneven wins in a head-to-head format, shows it when chosen, and shows the two boxes with their defaults', () => {
    const view = renderApp(drawn({ finalsUnevenWins: 'yes' }), { role: 'admin', tab: 'admin' });
    const select = finalsSelect(view);
    expect(optionTexts(select)).toContain('Uneven wins');
    expect(select.value).toBe('wins');
    expect((view.getByLabelText('Upper finalist needs') as HTMLInputElement).placeholder).toBe('1');
    expect((view.getByLabelText('Lower finalist needs') as HTMLInputElement).placeholder).toBe('2');
  });

  it('shows no boxes while another format is chosen, and picking Uneven wins sets the marker only', () => {
    const updateSetup = vi.fn();
    const view = renderApp(drawn({ finalsGames: '3' }), {
      role: 'admin',
      tab: 'admin',
      context: { updateSetup },
    });
    expect(view.queryByLabelText('Upper finalist needs')).toBeNull();
    fireEvent.change(finalsSelect(view), { target: { value: 'wins' } });
    const patch = updateSetup.mock.calls.at(-1)?.[0] as (setup: PersistedSetup) => PersistedSetup;
    const before = createDefaultSetup({ ...SWISS, finalsBestOf: '5', finalsGames: '3' });
    expect(patch(before)).toMatchObject({ finalsUnevenWins: 'yes', finalsBestOf: '5', finalsGames: '3' });
  });

  it('clears the marker and the two boxes when another format is picked', () => {
    const updateSetup = vi.fn();
    const view = renderApp(drawn({ finalsUnevenWins: 'yes', finalsUpperWins: '2' }), {
      role: 'admin',
      tab: 'admin',
      context: { updateSetup },
    });
    fireEvent.change(finalsSelect(view), { target: { value: 'bo3' } });
    const patches = updateSetup.mock.calls.map(
      (call) => call[0] as (setup: PersistedSetup) => PersistedSetup,
    );
    const after = patches.reduce(
      (setup, patch) => patch(setup),
      createDefaultSetup({ ...SWISS, finalsUnevenWins: 'yes', finalsUpperWins: '2', finalsLowerWins: '3' }),
    );
    expect(after).toMatchObject({
      finalsUnevenWins: '',
      finalsUpperWins: '',
      finalsLowerWins: '',
      finalsBestOf: '3',
    });
  });

  it('is not offered in FFA', () => {
    const view = renderApp(
      drawn({
        gameFormat: 'ffa-individual',
        poolingPhase: 'qual-table',
        qualAdv: '32',
        finalsUnevenWins: 'yes',
      }),
      { role: 'admin', tab: 'admin' },
    );
    expect(optionTexts(finalsSelect(view))).not.toContain('Uneven wins');
    expect(view.queryByLabelText('Upper finalist needs')).toBeNull();
  });
});
