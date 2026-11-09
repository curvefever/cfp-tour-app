// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTournament } from '../../../domain/tournament/generation';
import {
  indexOf,
  playToBracketEntry,
  pressed,
  resolveEveryTie,
  scoreRound,
} from '../../../domain/tournament/__tests__/dependency-play-fixtures';
import { rosterFor, testRuntime } from '../../../domain/tournament/__tests__/test-fixtures';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { RunningWaterfallPanel } from '../waterfall/RunningWaterfallPanel';
import { upperLowerByHand } from '../../../domain/tournament/upper-lower-form';
import { finalsMatchOf } from '../../../domain/tournament/waterfall-draft';
import { WaterfallGraphEditor } from '../waterfall/WaterfallGraphEditor';
import { FormatPanel } from './FormatPanel';
import { UpperLowerPanel } from './UpperLowerPanel';

let current: { state: ReturnType<typeof createDefaultTournamentState>; setup: PersistedSetup };
/** What the panel handed to `updateState`, in order. */
const saved: TournamentState[] = [];
/** What the panels handed to `updateSetup`: the form after each change. */
const setups: PersistedSetup[] = [];

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => ({
    ...current,
    updateState: (next: TournamentState) => saved.push(next),
    updateSetup: (change: (current: PersistedSetup) => PersistedSetup) => setups.push(change(current.setup)),
    setup: current.setup,
  }),
}));

beforeEach(() => {
  saved.length = 0;
  setups.length = 0;
});

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

describe('"Adjust rounds by hand"', () => {
  const asked = (answer: boolean) => vi.spyOn(window, 'confirm').mockReturnValue(answer);

  it('after a confirm writes the worked-out text, with the formats of the selects, and makes it a Custom bracket', () => {
    atCount(31, { semisBestOf: '3' });
    const confirm = asked(true);
    render(<UpperLowerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rounds by hand' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/no longer work the rooms out/);
    expect(setups).toHaveLength(1);
    expect(setups[0].scheduleLogic).toBe('waterfall-bracket');
    expect(setups[0].waterfallGraph).toContain('Semi-Final A = 8 BO3');
    expect(setups[0].waterfallGraph).toContain('Qual: 1-16->Round 4 - Upper, 17-31->Round 4 - Lower');
    // Nothing else in the form changes.
    expect({
      ...setups[0],
      scheduleLogic: current.setup.scheduleLogic,
      waterfallGraph: current.setup.waterfallGraph,
    }).toEqual(current.setup);
    confirm.mockRestore();
  });

  it('changes nothing when the confirm is declined', () => {
    atCount(31);
    const confirm = asked(false);
    render(<UpperLowerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rounds by hand' }));
    expect(setups).toHaveLength(0);
    confirm.mockRestore();
  });

  it('is not offered without a roster, or when the bracket is refused', () => {
    atCount(null);
    const { unmount } = render(<UpperLowerPanel />);
    expect(screen.queryByRole('button', { name: 'Adjust rounds by hand' })).toBeNull();
    unmount();
    atCount(30, { upperLowerAdvance: '20' });
    render(<UpperLowerPanel />);
    expect(screen.queryByRole('button', { name: 'Adjust rounds by hand' })).toBeNull();
  });

  it('opens the Custom bracket editor on it at 31, a short entry round, with nothing in the way', () => {
    atCount(31);
    asked(true);
    render(<UpperLowerPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Adjust rounds by hand' }));
    cleanup();
    const text = setups[0].waterfallGraph;
    render(
      <WaterfallGraphEditor
        entrantCount={31}
        finalsMatch={finalsMatchOf(3, undefined)}
        firstRoundNumber={4}
        onChange={() => {}}
        roomSize={{ min: 6, max: 8, ideal: 8 }}
        standingsKind='qual'
        standingsSource
        text={text}
      />,
    );
    expect(screen.getByText('Ready to generate.')).toBeTruthy();
    expect(screen.queryByText('Next thing to fix')).toBeNull();
  });
});

describe('"Adjust rounds by hand" after a Swiss', () => {
  it('1v1 Swiss at 9: the Setup editor shows the Qual line as "Swiss standings", ready to generate', () => {
    atCount(9, { gameFormat: 'individual-1v1', poolingPhase: 'swiss', oddCountStrategy: 'bye' });
    const text = upperLowerByHand(current.setup, 9);
    if (!text.ok) throw new Error(text.message);
    render(
      <WaterfallGraphEditor
        afterSwiss
        entrantCount={9}
        finalsMatch={finalsMatchOf(3, undefined)}
        firstRoundNumber={4}
        onChange={() => {}}
        roomSize={{ min: 2, max: 2, ideal: 2 }}
        standingsKind='qual'
        standingsSource
        text={text.text}
      />,
    );
    expect(screen.getAllByText('Swiss standings').length).toBeGreaterThan(0);
    expect(screen.queryByText('Qualification table')).toBeNull();
    expect(screen.getByText('Ready to generate.')).toBeTruthy();
  });
});

describe('the Format panel', () => {
  it("offers the Bracket option and its own Advance to bracket, not the table's", () => {
    atCount(31);
    render(<FormatPanel error='' lbQualifiers='2' onGenerate={() => {}} setLbQualifiers={() => {}} />);
    expect(screen.getByRole('option', { name: 'Upper and lower bracket' })).toBeTruthy();
    expect(screen.getByLabelText('Advance to bracket (optional)')).toBeTruthy();
    expect(screen.getByLabelText('Upper rooms (optional)')).toBeTruthy();
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

describe('both saves of Edit graph make it a Custom bracket', () => {
  /** Round 4 played and sent on: Semi-Final A and Round 5 - Lower are drawn and not scored. */
  function drawn(): TournamentState {
    const form = createDefaultSetup({ scheduleLogic: 'upper-lower', ...QUAL });
    const result = generateTournament(
      createDefaultTournamentState({ confirmedCount: 31, players: rosterFor(form.gameFormat, 31) }),
      form,
      testRuntime(),
    );
    if (result.status !== 'generated') throw new Error(result.message);
    const entered = playToBracketEntry({ ...result.state, started: true });
    const play = (state: TournamentState, label: string) => {
      const index = indexOf(state, label);
      return resolveEveryTie(scoreRound(resolveEveryTie(scoreRound(state, index), index), index), index);
    };
    return pressed(play(play(entered, 'Round 4 - Upper'), 'Round 4 - Lower'));
  }

  /** The line-ups of two drawn rounds swapped: saving the same graph then re-draws them. */
  function withStaleLineUps(state: TournamentState): TournamentState {
    const first = indexOf(state, 'Semi-Final A');
    const second = indexOf(state, 'Round 5 - Lower');
    const assignments = [...state.assignments];
    [assignments[first], assignments[second]] = [assignments[second], assignments[first]];
    return { ...state, assignments };
  }

  it('a plain save hands over a state without the version', () => {
    current = { state: drawn(), setup: createDefaultSetup() };
    expect(current.state.gamemodeConfig.upperLowerVersion).toBe(1);
    render(<RunningWaterfallPanel state={current.state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toHaveLength(1);
    expect(saved[0].gamemodeConfig.upperLowerVersion).toBeUndefined();
    expect(saved[0].settings?.scheduleLogic).toBe('waterfall-bracket');
    expect(saved[0].rounds.some((round) => round.graphMatchStage !== undefined)).toBe(false);
  });

  it('a save that re-draws asks first, and the confirmed one hands over a state without the version', () => {
    current = { state: withStaleLineUps(drawn()), setup: createDefaultSetup() };
    render(<RunningWaterfallPanel state={current.state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit graph' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved).toHaveLength(0);
    expect(screen.getByText(/This re-draws "Semi-Final A \+ Round 5 - Lower"/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(saved).toHaveLength(1);
    expect(saved[0].gamemodeConfig.upperLowerVersion).toBeUndefined();
    expect(saved[0].settings?.scheduleLogic).toBe('waterfall-bracket');
    expect(saved[0].rounds.some((round) => round.graphMatchStage !== undefined)).toBe(false);
  });
});
