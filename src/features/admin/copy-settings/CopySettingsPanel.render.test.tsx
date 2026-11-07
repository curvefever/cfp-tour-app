// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import { CopySettings, type CopyOutcome } from './CopySettingsPanel';

const calls = vi.hoisted(() => ({ order: [] as string[], finishCopy: () => {} }));

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({ state: { tournamentId: 'target-1' } }),
}));
vi.mock('../../tournaments/useTournamentIndex', () => ({
  useTournamentIndex: () => ({ status: 'ready', summaries: [] }),
}));
vi.mock('../../sync/firebase-client', () => ({
  fetchTournamentOnce: () => Promise.resolve({}),
  fetchSetupOnce: () => Promise.resolve({}),
}));
vi.mock('../../tournaments/screenshots.server-fns', () => ({
  copyScreenshots: () => Promise.resolve({ copied: 0 }),
}));
vi.mock('../../tournaments/note-pictures.server-fns', () => ({
  copyNotePictures: () => {
    calls.order.push('copy started');
    return new Promise((resolve) => {
      calls.finishCopy = () => {
        calls.order.push('copy resolved');
        resolve({ copied: 2 });
      };
    });
  },
}));
vi.mock('./past-tournament-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./past-tournament-settings')>()),
  settingsFromSnapshot: () => ({
    ok: true,
    settings: { ...createDefaultSetup(), lbQualifiers: '2' },
    title: 'Source',
    rulesText: '',
    roundNotes: undefined,
    gameNotes: undefined,
    screenshotCount: 0,
    notePictureCount: 2,
  }),
}));

beforeEach(() => {
  calls.order.length = 0;
});
afterEach(cleanup);

function copyFromLink(onApply: () => CopyOutcome) {
  render(<CopySettings onApply={onApply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
  fireEvent.change(screen.getByPlaceholderText('Tournament link or id'), { target: { value: 'source-1' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Copy settings' }).at(-1) as HTMLElement);
}

describe('Copy settings and the pictures of renamed rounds', () => {
  it('moves the pictures only once the pictures are copied, never before or alongside', async () => {
    const movePictures = vi.fn(() => {
      calls.order.push('move');
      return Promise.resolve('');
    });
    copyFromLink(() => ({ message: 'Copied settings.', movePictures }));
    await waitFor(() => expect(calls.order).toEqual(['copy started']));
    expect(movePictures).not.toHaveBeenCalled();
    calls.finishCopy();
    await waitFor(() => expect(movePictures).toHaveBeenCalledTimes(1));
    expect(calls.order).toEqual(['copy started', 'copy resolved', 'move']);
    await waitFor(() => expect(screen.getByText(/Copied settings\./)).toBeTruthy());
  });

  it('shows a failed move after the confirmation, which still says what was copied', async () => {
    copyFromLink(() => ({ message: 'Copied settings.', movePictures: () => Promise.resolve('Nope.') }));
    await waitFor(() => expect(calls.order).toEqual(['copy started']));
    calls.finishCopy();
    const confirmation = await screen.findByText(/Copied settings\./);
    expect(confirmation.textContent).toContain('2 settings pictures copied.');
    expect(confirmation.textContent).toContain(
      'The settings pictures could not follow the renamed rounds: Nope.',
    );
  });

  it('moves nothing when no round was renamed', async () => {
    copyFromLink(() => ({ message: 'Copied settings.' }));
    await waitFor(() => expect(calls.order).toEqual(['copy started']));
    calls.finishCopy();
    const confirmation = await screen.findByText(/Copied settings\./);
    expect(confirmation.textContent).not.toContain('renamed rounds');
  });
});
