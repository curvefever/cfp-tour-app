// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playToBracketEntry } from '../../../domain/tournament/__tests__/dependency-play-fixtures';
import { rosterFor, testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { generateTournament } from '../../../domain/tournament/generation';
import { removeRosterUnit } from '../../../domain/tournament/mutations';
import { rosterKeys } from '../../../domain/tournament/roster';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { TournamentState } from '../../../domain/tournament/types';
import { RunningWaterfallPanel } from './RunningWaterfallPanel';

let current: TournamentState;
const saved: TournamentState[] = [];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    state: current,
    updateState: (next: TournamentState) => saved.push(next),
  }),
}));

beforeEach(() => {
  saved.length = 0;
});
afterEach(cleanup);

function built(count: number, setup: Parameters<typeof createDefaultSetup>[0] = {}): TournamentState {
  const form = createDefaultSetup({
    scheduleLogic: 'upper-lower',
    gameFormat: 'ffa-individual',
    poolingPhase: 'qual-table',
    // 32 asks for everyone who fits (the automatic entry reads the pooling setting, 24 by default).
    qualAdv: '32',
    ...setup,
  });
  const result = generateTournament(
    createDefaultTournamentState({ confirmedCount: count, players: rosterFor(form.gameFormat, count) }),
    form,
    testRuntime(),
  );
  if (result.status !== 'generated') throw new Error(result.message);
  return { ...result.state, started: true };
}

const show = (state: TournamentState) => {
  current = state;
  return render(<RunningWaterfallPanel state={state} />);
};
const typeInto = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const roomsOf = (state: TournamentState, label: string) =>
  state.rounds.find((round) => round.customLabel === label)?.rooms;

describe('the running Admin fields of an upper and lower bracket in its pooling rounds', () => {
  it('show what the settings hold, in the section of the graph', () => {
    show(built(29, { upperLowerAdvance: '28', upperLowerUpper: '16' }));
    expect(screen.getByLabelText<HTMLInputElement>('Advance to bracket (optional)').value).toBe('28');
    expect(screen.getByLabelText<HTMLInputElement>('Upper rooms (optional)').value).toBe('16');
    expect(screen.getByRole('button', { name: 'Edit graph' })).toBeTruthy();
  });

  it('names the number behind the empty Advance to bracket: the pooling setting', () => {
    show(built(31, { qualAdv: '24' }));
    expect(screen.getByLabelText<HTMLInputElement>('Advance to bracket (optional)').placeholder).toBe(
      'automatic: 24',
    );
  });

  it('Save works the rooms out with the numbers: 16 upper at 29 is 8, 8 above and 7, 6 below', () => {
    show(built(29));
    typeInto('Upper rooms (optional)', '16');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toHaveLength(1);
    expect(roomsOf(saved[0], 'Round 4 - Upper')).toEqual([8, 8]);
    expect(roomsOf(saved[0], 'Round 4 - Lower')).toEqual([7, 6]);
    expect(saved[0].settings?.upperLowerUpper).toBe('16');
    expect(saved[0].gamemodeConfig.upperLowerVersion).toBe(1);
    expect(screen.getByText('Saved.')).toBeTruthy();
  });

  it('Save lowers "Advance to bracket" too', () => {
    show(built(31));
    typeInto('Advance to bracket (optional)', '24');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved[0].cfg.qualAdv).toBe(24);
    expect(saved[0].settings?.upperLowerAdvance).toBe('24');
  });

  it('a number that cannot be seated is refused in the words of generation, and nothing is saved', () => {
    show(built(29));
    typeInto('Upper rooms (optional)', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(document.getElementById('upper-lower-live-error')?.textContent).toBe(
      "Upper rooms (20) can't be seated: with 29 entering, use 13 to 16.",
    );
    expect(saved).toHaveLength(0);
    expect(screen.queryByText('Saved.')).toBeNull();
    typeInto('Upper rooms (optional)', '');
    typeInto('Advance to bracket (optional)', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(document.getElementById('upper-lower-live-error')?.textContent).toBe(
      'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    );
  });

  it('say so when a typed "Upper rooms" no longer seats after a removal, and the rooms are split evenly', () => {
    let state = built(29, { upperLowerUpper: '16' });
    state = removeRosterUnit(
      removeRosterUnit(state, rosterKeys(state.players)[0]),
      rosterKeys(state.players)[1],
    );
    show(state);
    expect(document.getElementById('upper-lower-fallback')?.textContent).toBe(
      "Upper rooms (16) can't be seated: with 27 entering, use 12 to 15. The rooms are split evenly instead.",
    );
    expect(roomsOf(state, 'Round 4 - Upper')).toEqual([7, 7]);
  });

  it('are gone once the first bracket round is drawn: from there, Edit graph', () => {
    show(playToBracketEntry(built(31)));
    expect(screen.queryByLabelText('Upper rooms (optional)')).toBeNull();
    expect(screen.queryByLabelText('Advance to bracket (optional)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit graph' })).toBeTruthy();
  });

  it('are not there for a Custom bracket', () => {
    const state = built(31);
    const { upperLowerVersion: _version, ...gamemodeConfig } = state.gamemodeConfig;
    show({ ...state, gamemodeConfig });
    expect(screen.queryByLabelText('Upper rooms (optional)')).toBeNull();
  });
});
