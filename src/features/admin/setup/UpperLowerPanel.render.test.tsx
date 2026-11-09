// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTournament } from '../../../domain/tournament/generation';
import { rosterFor, testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { RunningWaterfallPanel } from '../waterfall/RunningWaterfallPanel';
import { FormatPanel } from './FormatPanel';
import { UpperLowerPanel } from './UpperLowerPanel';

let current: { state: ReturnType<typeof createDefaultTournamentState>; setup: PersistedSetup };

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    updateState: () => {},
    updateSetup: () => {},
    setup: current.setup,
  }),
}));

afterEach(cleanup);

const QUAL = { gameFormat: 'ffa-individual', poolingPhase: 'qual-table' } as const;

function atCount(count: number | null, setup: Partial<PersistedSetup> = {}) {
  const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...QUAL, ...setup });
  current = {
    state: createDefaultTournamentState(
      count === null ? {} : { confirmedCount: count, players: rosterFor(form.gameFormat, count) },
    ),
    setup: form,
  };
}

describe('the Setup panel', () => {
  it('shows nothing for another schedule logic', () => {
    atCount(31, { scheduleLogic: 'waterfall-bracket' });
    render(<UpperLowerPanel />);
    expect(screen.queryByText('UPPER AND LOWER BRACKET')).toBeNull();
  });

  it('asks for a roster', () => {
    atCount(null);
    render(<UpperLowerPanel />);
    expect(screen.getByText('Works out the rooms from the head count once a roster is loaded.')).toBeTruthy();
  });

  it('31 of 31 enter, with a line per round', () => {
    atCount(31);
    render(<UpperLowerPanel />);
    expect(screen.getByText('31 of 31 enter: upper 8, 8 · lower 8, 7')).toBeTruthy();
    expect(screen.getByText('Round 4 - Upper')).toBeTruthy();
    expect(screen.getByText('1–4 → Semi-Final A · 5–8 → Round 5 - Lower')).toBeTruthy();
  });

  it('37 registered: 32 enter and the 5 out are named', () => {
    atCount(37);
    render(<UpperLowerPanel />);
    expect(
      screen.getByText('32 of 37 enter (5 out in the qualification table): upper 8, 8 · lower 8, 8'),
    ).toBeTruthy();
  });

  it('shows a refusal as an alert, in the words of generation', () => {
    atCount(30, { upperLowerAdvance: '20' });
    render(<UpperLowerPanel />);
    expect(document.getElementById('upper-lower-summary')?.textContent).toBe(
      'Advance to bracket (20) has no upper and lower bracket: use 16 or 24.',
    );
  });
});

describe('the Format panel', () => {
  it("offers the Bracket option and its own Advance to bracket, not the table's", () => {
    atCount(31);
    render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);
    expect(screen.getByRole('option', { name: 'Upper and lower bracket' })).toBeTruthy();
    expect(screen.getByLabelText('Advance to bracket (optional)')).toBeTruthy();
    expect(screen.queryByLabelText('Advance to bracket')).toBeNull();
    expect(screen.getByLabelText('Semis format')).toBeTruthy();
    expect(screen.getByLabelText('Finals format')).toBeTruthy();
    expect(screen.queryByLabelText(/Semis size override/)).toBeNull();
    expect(screen.getByLabelText('Non-counting rounds (optional)')).toBeTruthy();
  });

  it("hides the group stage's qualifiers per group, and keeps its exit select", () => {
    atCount(11, { poolingPhase: 'group-stage', gameFormat: 'team-4v4', oddCountStrategy: 'bye' });
    render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);
    expect(screen.getByLabelText('Teams out of the groups')).toBeTruthy();
    expect(screen.queryByLabelText('Qualifiers per group')).toBeNull();
    expect(screen.getByLabelText('Advance to bracket (optional)')).toBeTruthy();
  });
});

describe('Edit graph on a running upper and lower bracket', () => {
  function started(version: boolean) {
    const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...QUAL });
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 31, players: rosterFor(form.gameFormat, 31) }),
      form,
      testRuntime(),
    );
    if (result.status !== 'generated') throw new Error(result.message);
    const { upperLowerVersion: _version, ...gamemodeConfig } = result.state.gamemodeConfig;
    return { ...result.state, started: true, ...(version ? {} : { gamemodeConfig }) };
  }

  it('says that saving makes it a Custom bracket', () => {
    current = { state: started(true), setup: createDefaultSetup() };
    render(<RunningWaterfallPanel state={current.state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    expect(
      screen.getByText(
        'Saving here makes this a Custom bracket: the app stops working the rooms out when the head count changes.',
      ),
    ).toBeTruthy();
  });

  it('says nothing of the kind on a Custom bracket', () => {
    current = { state: started(false), setup: createDefaultSetup() };
    render(<RunningWaterfallPanel state={current.state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    expect(screen.queryByText(/Saving here makes this a Custom bracket/)).toBeNull();
  });
});
