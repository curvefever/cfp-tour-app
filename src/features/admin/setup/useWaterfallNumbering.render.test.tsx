// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEffect, useReducer, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { rosterFor } from '../../../domain/tournament/__tests__/test-fixtures';
import { computeSwissRoundCount } from '../../../domain/tournament/pooling';
import { createTournamentRuntime } from '../../../domain/tournament/runtime';
import { fixedIdSource } from '../../../domain/tournament/__tests__/test-fixtures';
import { RosterPanel } from './RosterPanel';
import { useSetupChange } from './useSetupChange';
import { useWaterfallNumbering, WaterfallNumberingContext } from './useWaterfallNumbering';

/** The tournament and its Setup, held outside React so a test can change them the way the Setup form does. */
const store = vi.hoisted(() => ({
  setup: null as unknown as PersistedSetup,
  state: null as unknown as TournamentState,
  listeners: new Set<() => void>(),
}));
const renameNotePictureRounds = vi.hoisted(() => vi.fn<(call: unknown) => Promise<void>>());

vi.mock('../../tournament/TournamentProvider', () => ({
  useTournamentApp: () => {
    const [, refresh] = useReducer((count: number) => count + 1, 0);
    useEffect(() => {
      store.listeners.add(refresh);
      return () => void store.listeners.delete(refresh);
    }, []);
    return {
      runtime: createTournamentRuntime({ ids: fixedIdSource() }),
      setup: store.setup,
      state: store.state,
      updateSetup: (updater: PersistedSetup | ((current: PersistedSetup) => PersistedSetup)) => {
        store.setup = typeof updater === 'function' ? updater(store.setup) : updater;
        store.listeners.forEach((listener) => listener());
      },
      updateState: (updater: TournamentState | ((current: TournamentState) => TournamentState)) => {
        store.state = typeof updater === 'function' ? updater(store.state) : updater;
        store.listeners.forEach((listener) => listener());
      },
    };
  },
}));
vi.mock('../../presence/PresenceField', () => ({
  PresenceField: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
}));
vi.mock('../../tournaments/note-pictures.server-fns', () => ({
  renameNotePictureRounds: (call: unknown) => renameNotePictureRounds(call),
}));

const GRAPH = [
  'ROUNDS:',
  'Round 4 = 2x8',
  'Round 5 = 8',
  'Round 4 - Upper = 8',
  'Final = 8 FINAL',
  '',
  'ROUTES:',
  'Qual: 1-16->Round 4, 17-20->Round 4 - Upper',
  'Round 4.A: 1-4->Round 5, 5-8->eliminated',
  'Round 4.B: 1-4->Round 5, 5-8->eliminated',
  'Round 5: 1-4->Final, 5-8->eliminated',
  'Round 4 - Upper: 1-4->Final, 5-8->eliminated',
].join('\n');

function load(setup: Partial<PersistedSetup>, state: Partial<TournamentState> = {}) {
  store.setup = createDefaultSetup({
    scheduleLogic: 'waterfall-bracket',
    poolingPhase: 'qual-table',
    waterfallGraph: GRAPH,
    waterfallNumberedFrom: '4',
    ...setup,
  });
  store.state = {
    ...createDefaultTournamentState({ confirmedCount: 37, players: rosterFor('ffa-individual', 37) }),
    tournamentId: 'tour-1',
    info: {
      scheduledAt: null,
      rulesText: '',
      screenshots: [],
      roundNotes: { 'Round 4': 'powers off', 'Round 4 - Upper': 'typed' },
      gameNotes: { 'Round 4': { g1: 'game one' } },
    },
    ...state,
  };
}

/** A Setup that arrives from outside (another tab, through SetupSync): it replaces the stored one without going through the hook. */
function arrives(setup: Partial<PersistedSetup>) {
  act(() => {
    store.setup = { ...store.setup, ...setup };
    store.listeners.forEach((listener) => listener());
  });
}

beforeEach(() => {
  store.listeners.clear();
  renameNotePictureRounds.mockReset();
  renameNotePictureRounds.mockResolvedValue(undefined);
});
afterEach(cleanup);

const withOverride = (value: string) => (current: PersistedSetup) => ({
  ...current,
  qualRoundsOverride: value,
});

describe("the Setup numbering of a Custom bracket's default round names", () => {
  it("names new rounds from the graph's own numbering, else from the pooling rounds", () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    expect(result.current.firstRoundNumber).toBe(4);
    cleanup();
    load({ waterfallNumberedFrom: '', qualRoundsOverride: '4' });
    expect(renderHook(() => useWaterfallNumbering()).result.current.firstRoundNumber).toBe(5);
  });

  it('a local edit of the qualification rounds 3 to 4 renames "Round 4" to "Round 5" and moves its notes and pictures, once', async () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.updateSetup(withOverride('4')));
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
    expect(store.setup.qualRoundsOverride).toBe('4');
    expect(store.setup.waterfallGraph).toContain('Round 5 = 2x8');
    expect(store.setup.waterfallGraph).toContain('Qual: 1-16->Round 5, 17-20->Round 4 - Upper');
    expect(store.setup.waterfallNumberedFrom).toBe('5');
    expect(store.state.info?.roundNotes).toEqual({ 'Round 5': 'powers off', 'Round 4 - Upper': 'typed' });
    expect(store.state.info?.gameNotes).toEqual({ 'Round 5': { g1: 'game one' } });
    expect(renameNotePictureRounds).toHaveBeenCalledWith({
      data: {
        tournamentId: 'tour-1',
        renames: [
          { from: 'Round 4', to: 'Round 5' },
          { from: 'Round 5', to: 'Round 6' },
        ],
      },
    });
    // The same edit again moves nothing more.
    act(() => result.current.updateSetup(withOverride('4')));
    expect(renameNotePictureRounds).toHaveBeenCalledTimes(1);
    expect(store.state.info?.roundNotes).toEqual({ 'Round 5': 'powers off', 'Round 4 - Upper': 'typed' });
  });

  it('a Setup that arrives from another tab renumbers nothing and calls no server function', () => {
    load({});
    renderHook(() => useWaterfallNumbering());
    // The other tab's override reaches this one before its renumbered graph does, as SetupSync applies it field by field.
    arrives({ qualRoundsOverride: '4' });
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    expect(store.setup.waterfallNumberedFrom).toBe('4');
    expect(store.state.info?.roundNotes).toEqual({ 'Round 4': 'powers off', 'Round 4 - Upper': 'typed' });
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
    arrives({ waterfallGraph: GRAPH.replaceAll('Round 4 ', 'Round 5 '), waterfallNumberedFrom: '5' });
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it('a roster load in a group stage renumbers the defaults, with the notes and pictures', async () => {
    const groups = {
      poolingPhase: 'group-stage' as const,
      groupSize: '4',
      waterfallGraph: GRAPH.replace('Qual:', 'Groups:'),
    };
    load(groups, { players: rosterFor('ffa-individual', 31), confirmedCount: 31 });
    const { result } = renderHook(() => useWaterfallNumbering());
    // 31 units in groups of 4 play 3 rounds: still Round 4. 37 play 5, so the bracket starts at Round 6.
    act(() => result.current.renumberForRoster(31));
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
    act(() => result.current.renumberForRoster(37));
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
    expect(store.setup.waterfallNumberedFrom).toBe('6');
    expect(store.setup.waterfallGraph).toContain('Round 6 = 2x8');
    expect(store.state.info?.roundNotes).toHaveProperty('Round 6', 'powers off');
  });

  it('a graph edited while the roster is empty keeps its number, so the roster coming back moves nothing', () => {
    const groups = {
      poolingPhase: 'group-stage' as const,
      groupSize: '4',
      waterfallGraph: GRAPH.replace('Qual:', 'Groups:')
        .replaceAll('Round 4', 'Round 6')
        .replaceAll('Round 5', 'Round 7'),
      waterfallNumberedFrom: '6',
    };
    // Control: the graph reads, so unnumbered it is marked with the number of an empty roster.
    load({ ...groups, waterfallNumberedFrom: '' }, { players: [], confirmedCount: null });
    const control = renderHook(() => useWaterfallNumbering());
    act(() => control.result.current.changeGraph(store.setup.waterfallGraph.replace('= 2x8', '= 2x8 BO3')));
    expect(store.setup.waterfallNumberedFrom).toBe('1');
    cleanup();
    load(groups, { players: [], confirmedCount: null });
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.changeGraph(store.setup.waterfallGraph.replace('= 2x8', '= 2x8 BO3')));
    expect(store.setup.waterfallNumberedFrom).toBe('6');
    act(() => result.current.renumberForRoster(37));
    expect(store.setup.waterfallNumberedFrom).toBe('6');
    expect(store.setup.waterfallGraph).toContain('Round 6 = 2x8');
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it('never renumbers a graph that is not numbered, nor a tournament that has started', () => {
    load({ waterfallNumberedFrom: '' });
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.updateSetup(withOverride('4')));
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    expect(store.setup.waterfallNumberedFrom).toBe('');
    cleanup();
    load({}, { started: true });
    const started = renderHook(() => useWaterfallNumbering());
    act(() => started.result.current.updateSetup(withOverride('4')));
    act(() => started.result.current.renumberForRoster(40));
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it('does not call the server before the tournament has an id, and still moves the notes', async () => {
    load({}, { tournamentId: null });
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.updateSetup(withOverride('4')));
    await waitFor(() => expect(store.state.info?.roundNotes).toHaveProperty('Round 5'));
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it("a rename made by hand carries the round's notes and pictures along", async () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() =>
      result.current.changeGraph(GRAPH.replaceAll('Round 4 - Upper', 'Round 4 - Lower'), {
        from: 'Round 4 - Upper',
        to: 'Round 4 - Lower',
      }),
    );
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
    expect(store.setup.waterfallGraph).toContain('Round 4 - Lower = 8');
    expect(store.state.info?.roundNotes).toEqual({ 'Round 4': 'powers off', 'Round 4 - Lower': 'typed' });
    expect(renameNotePictureRounds).toHaveBeenCalledWith({
      data: { tournamentId: 'tour-1', renames: [{ from: 'Round 4 - Upper', to: 'Round 4 - Lower' }] },
    });
  });

  it('a change that renames nothing writes the graph and calls no server function', () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.changeGraph(GRAPH.replace('Round 5 = 8', 'Round 5 = 6')));
    expect(store.setup.waterfallGraph).toContain('Round 5 = 6');
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it('the first save of a graph with default names marks it as numbered; an edit of another field does not', () => {
    load({ waterfallNumberedFrom: '' });
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.updateSetup((current) => ({ ...current, groupSize: '5' })));
    expect(store.setup.waterfallNumberedFrom).toBe('');
    act(() => result.current.changeGraph(GRAPH.replace('= 2x8', '= 2x8 BO3')));
    expect(store.setup.waterfallNumberedFrom).toBe('4');
  });

  it('a failed picture move is shown and the graph and notes change still applies', async () => {
    load({});
    renameNotePictureRounds.mockRejectedValue(new Error('The tournament has finished.'));
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.updateSetup(withOverride('4')));
    await waitFor(() => expect(result.current.pictureError).toBe('The tournament has finished.'));
    expect(store.setup.waterfallGraph).toContain('Round 5 = 2x8');
    expect(store.state.info?.roundNotes).toHaveProperty('Round 5');
  });

  it('movePictures sends nothing for no renames and resolves with the error text of a failure', async () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    expect(await result.current.movePictures(new Map())).toBe('');
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
    renameNotePictureRounds.mockRejectedValue(new Error('nope'));
    expect(await result.current.movePictures(new Map([['Round 4', 'Round 5']]))).toBe('nope');
  });
});

/** The Setup view provides its numbering to the panels; these are the panels' own edits. */
function NumberingProvider({ children }: { children: ReactNode }) {
  const numbering = useWaterfallNumbering();
  return (
    <WaterfallNumberingContext.Provider value={numbering}>{children}</WaterfallNumberingContext.Provider>
  );
}

describe('the panels of the Setup go through the numbering', () => {
  it('a field edit renumbers inside the Setup view and does not outside it (the plain update)', () => {
    load({});
    const inside = renderHook(() => useSetupChange(), { wrapper: NumberingProvider });
    act(() => inside.result.current('qualRoundsOverride', '4'));
    expect(store.setup.qualRoundsOverride).toBe('4');
    expect(store.setup.waterfallGraph).toContain('Round 5 = 2x8');
    expect(store.setup.waterfallNumberedFrom).toBe('5');
    cleanup();
    load({});
    const outside = renderHook(() => useSetupChange());
    act(() => outside.result.current('qualRoundsOverride', '4'));
    expect(store.setup.qualRoundsOverride).toBe('4');
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    expect(store.setup.waterfallNumberedFrom).toBe('4');
  });

  it('Load roster in a group stage renumbers the default names once, with the notes and pictures', async () => {
    const names = Array.from({ length: 37 }, (_, index) => `Player ${index + 1}`);
    load(
      {
        gameFormat: 'individual-1v1',
        poolingPhase: 'group-stage',
        groupSize: '4',
        waterfallGraph: GRAPH.replace('Qual:', 'Groups:'),
        roster: names.join('\n'),
      },
      { players: rosterFor('individual-1v1', 31), confirmedCount: 31 },
    );
    render(
      <NumberingProvider>
        <RosterPanel onLoaded={() => {}} />
      </NumberingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Load roster/ }));
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
    expect(store.state.players).toHaveLength(37);
    expect(store.setup.waterfallNumberedFrom).toBe('6');
    expect(store.setup.waterfallGraph).toContain('Round 6 = 2x8');
    expect(store.state.info?.roundNotes).toHaveProperty('Round 6', 'powers off');
  });

  describe('Clear roster', () => {
    const first = computeSwissRoundCount(37) + 1;
    const SWISS_GRAPH = [
      'ROUNDS:',
      `Round ${first} = 2`,
      'Final = 2 FINAL',
      '',
      'ROUTES:',
      `Round ${first}: 1->Final, 2->eliminated`,
    ].join('\n');
    const loadSwiss = () =>
      load(
        {
          gameFormat: 'individual-1v1',
          scheduleLogic: 'waterfall-bracket',
          poolingPhase: 'swiss',
          waterfallGraph: SWISS_GRAPH,
          waterfallNumberedFrom: String(first),
        },
        { players: rosterFor('individual-1v1', 37), confirmedCount: 37 },
      );
    const clear = () => {
      render(
        <NumberingProvider>
          <RosterPanel onLoaded={() => {}} />
        </NumberingProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: /Clear roster/ }));
    };

    it('renumbers nothing when the confirmation is cancelled: the roster is still there', () => {
      loadSwiss();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      clear();
      expect(store.state.players).toHaveLength(37);
      expect(store.setup.waterfallGraph).toBe(SWISS_GRAPH);
      expect(store.setup.waterfallNumberedFrom).toBe(String(first));
    });

    it('renumbers for no units once the roster is cleared', () => {
      loadSwiss();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      clear();
      expect(store.state.players).toHaveLength(0);
      expect(store.setup.waterfallNumberedFrom).toBe(String(computeSwissRoundCount(0) + 1));
      expect(store.setup.waterfallNumberedFrom).not.toBe(String(first));
    });
  });
});
