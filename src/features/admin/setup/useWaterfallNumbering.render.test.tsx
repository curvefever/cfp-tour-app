// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import type { PersistedSetup, TournamentState } from '../../../domain/tournament/types';
import { rosterFor } from '../../../domain/tournament/__tests__/test-fixtures';
import { useWaterfallNumbering } from './useWaterfallNumbering';

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

/** The Setup form changes a setting. */
function change(setup: Partial<PersistedSetup>) {
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

describe("the Setup numbering of a Custom bracket's default round names", () => {
  it('names new rounds from the pooling rounds: Round 4 after 3 qualification rounds, Round 5 after 4', () => {
    load({});
    const { result } = renderHook(() => useWaterfallNumbering());
    expect(result.current.firstRoundNumber).toBe(4);
    change({ qualRoundsOverride: '4' });
    expect(result.current.firstRoundNumber).toBe(5);
  });

  it('changing the qualification rounds 3 to 4 renames "Round 4" to "Round 5" and moves its notes and pictures', async () => {
    load({});
    renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
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
  });

  it('renumbers once: another render of the same setup moves nothing again', async () => {
    load({});
    const { rerender } = renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
    await waitFor(() => expect(renameNotePictureRounds).toHaveBeenCalledTimes(1));
    rerender();
    change({ qualRoundsOverride: '4' });
    expect(renameNotePictureRounds).toHaveBeenCalledTimes(1);
    expect(store.state.info?.roundNotes).toEqual({ 'Round 5': 'powers off', 'Round 4 - Upper': 'typed' });
  });

  it('never renumbers a graph that is not numbered, nor a tournament that has started', () => {
    load({ waterfallNumberedFrom: '' });
    renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    cleanup();
    load({}, { started: true });
    renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
    expect(store.setup.waterfallGraph).toBe(GRAPH);
    expect(renameNotePictureRounds).not.toHaveBeenCalled();
  });

  it('does not call the server before the tournament has an id, and still moves the notes', async () => {
    load({}, { tournamentId: null });
    renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
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

  it('the first save of a graph with default names marks it as numbered', () => {
    load({ waterfallNumberedFrom: '' });
    const { result } = renderHook(() => useWaterfallNumbering());
    act(() => result.current.changeGraph(GRAPH));
    expect(store.setup.waterfallNumberedFrom).toBe('4');
  });

  it('a failed picture move is shown and the graph and notes change still applies', async () => {
    load({});
    renameNotePictureRounds.mockRejectedValue(new Error('The tournament has finished.'));
    const { result } = renderHook(() => useWaterfallNumbering());
    change({ qualRoundsOverride: '4' });
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
