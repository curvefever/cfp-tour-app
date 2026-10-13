import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeRosterUnit } from '../../domain/tournament/mutations';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { settingsFromForm } from '../../domain/tournament/tournament-settings';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import {
  buildState,
  scoreCurrentRound,
  type SweepConfig,
} from '../../domain/tournament/__tests__/play-through';
import { simulateFirebaseStorage } from './firebase-storage-simulation';
import {
  FIREBASE_EMPTY_ARRAY_SENTINEL_KEY,
  FIREBASE_EMPTY_OBJECT_SENTINEL_KEY,
  FIREBASE_NULL_SENTINEL_KEY,
  SyncCoordinator,
  marshalForFirebase,
  mergeRemoteWriterState,
  unmarshalFromFirebase,
  type SyncStatus,
  type SyncTransport,
} from './live-sync';

describe('marshalForFirebase / unmarshalFromFirebase', () => {
  it('round-trips null through nested objects and arrays', () => {
    const original = { a: null, b: [1, null, { c: null }], d: { e: [null] } };
    const marshaled = marshalForFirebase(original);
    expect(marshaled).toEqual({
      a: { [FIREBASE_NULL_SENTINEL_KEY]: true },
      b: [1, { [FIREBASE_NULL_SENTINEL_KEY]: true }, { c: { [FIREBASE_NULL_SENTINEL_KEY]: true } }],
      d: { e: [{ [FIREBASE_NULL_SENTINEL_KEY]: true }] },
    });
    expect(unmarshalFromFirebase(marshaled)).toEqual(original);
  });

  it('leaves non-null primitives and plain objects untouched', () => {
    expect(marshalForFirebase(0)).toBe(0);
    expect(marshalForFirebase('x')).toBe('x');
    expect(marshalForFirebase(undefined)).toBe(undefined);
    expect(unmarshalFromFirebase({ a: 1 })).toEqual({ a: 1 });
  });

  it('treats the sentinel key as a truthiness check, not a strict === true check', () => {
    // A falsy sentinel value must NOT be unmarshaled back to null.
    expect(unmarshalFromFirebase({ [FIREBASE_NULL_SENTINEL_KEY]: false })).toEqual({
      [FIREBASE_NULL_SENTINEL_KEY]: false,
    });
    // Any other truthy sentinel value still counts.
    expect(unmarshalFromFirebase({ [FIREBASE_NULL_SENTINEL_KEY]: 1 })).toBe(null);
  });
});

describe('mergeRemoteWriterState', () => {
  const current = createDefaultTournamentState({
    scores: { a: 1, b: 2 },
    finalScores: { x: 5 },
    curRound: 3,
  });

  it('returns null for a non-object/array/primitive remote value', () => {
    expect(mergeRemoteWriterState(current, null, new Set(), new Set())).toBeNull();
    expect(mergeRemoteWriterState(current, 'nope', new Set(), new Set())).toBeNull();
    expect(mergeRemoteWriterState(current, [1, 2], new Set(), new Set())).toBeNull();
  });

  it('strips adminProof from the remote payload before merging', () => {
    const merged = mergeRemoteWriterState(
      current,
      { adminProof: 'secret', curRound: 4 },
      new Set(),
      new Set(),
    );
    expect(merged).not.toBeNull();
    expect(merged).not.toHaveProperty('adminProof');
    expect(merged?.curRound).toBe(4);
  });

  it('keeps a dirty score key at its current value and takes remote for a non-dirty one', () => {
    const merged = mergeRemoteWriterState(current, { scores: { a: 99, b: 100 } }, new Set(['a']), new Set());
    expect(merged?.scores).toEqual({ a: 1, b: 100 });
  });

  it('keeps a dirty finalScore key at its current value and takes remote for a non-dirty one', () => {
    const merged = mergeRemoteWriterState(current, { finalScores: { x: 999 } }, new Set(), new Set(['x']));
    expect(merged?.finalScores).toEqual({ x: 5 });
  });

  it('drops a score key the remote no longer has, unless it was edited here and not yet sent', () => {
    const merged = mergeRemoteWriterState(current, { scores: {} }, new Set(['a']), new Set());
    expect(merged?.scores).toEqual({ a: 1 });
    expect(mergeRemoteWriterState(current, { scores: {} }, new Set(), new Set())?.scores).toEqual({});
  });

  it('treats a missing remote scores map as empty', () => {
    const merged = mergeRemoteWriterState(current, { curRound: 0 }, new Set(), new Set());
    expect(merged?.scores).toEqual({});
    expect(merged?.finalScores).toEqual({});
  });

  it('keeps a dirty finalScore key the remote lacks, and drops the others', () => {
    const merged = mergeRemoteWriterState(
      createDefaultTournamentState({ finalScores: { x: 5, y: 6 } }),
      { finalScores: {} },
      new Set(),
      new Set(['x']),
    );
    expect(merged?.finalScores).toEqual({ x: 5 });
  });

  it('keeps a score deleted here deleted, even when the remote still has it', () => {
    const local = createDefaultTournamentState({ scores: { b: 2 } });
    const merged = mergeRemoteWriterState(local, { scores: { a: 1, b: 2 } }, new Set(['a']), new Set());
    expect(merged?.scores).toEqual({ b: 2 });
  });

  it('wholesale-overwrites every non-scores field from remote regardless of dirtiness', () => {
    // Not a bug: only scores/finalScores get per-key dirty protection. Every other
    // top-level field is always taken from remote as-is.
    const merged = mergeRemoteWriterState(
      current,
      { curRound: 7, title: 'Remote Title' },
      new Set(),
      new Set(),
    );
    expect(merged?.curRound).toBe(7);
    expect(merged?.title).toBe('Remote Title');
  });
});

function createDeferredWrite() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SyncCoordinator', () => {
  let statuses: SyncStatus[];
  let remoteStates: ReturnType<typeof createDefaultTournamentState>[];
  let onStatus: (status: SyncStatus) => void;
  let onRemote: (state: ReturnType<typeof createDefaultTournamentState>) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    statuses = [];
    remoteStates = [];
    onStatus = (status) => statuses.push(status);
    onRemote = (state) => remoteStates.push(state);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTransport(overrides: Partial<SyncTransport> = {}): SyncTransport {
    return {
      update: vi.fn(async () => {}),
      subscribe: vi.fn(() => vi.fn()),
      ...overrides,
    };
  }

  /** A transport whose subscription handler the test can call, to play the snapshots Firebase sends. */
  function subscribeCapturing(overrides: Partial<SyncTransport> = {}) {
    const handlers: { onValue: (payload: unknown) => void } = { onValue: () => {} };
    const subscribe = vi.fn((_id: string, cb: (payload: unknown) => void) => {
      handlers.onValue = cb;
      return vi.fn();
    });
    return { handlers, transport: createTransport({ subscribe, ...overrides }) };
  }

  /** A writer on t1 that has received the stored tournament, so it knows what Firebase holds. */
  function startWriter(stored = createDefaultTournamentState(), overrides: Partial<SyncTransport> = {}) {
    const { handlers, transport } = subscribeCapturing(overrides);
    const coordinator = new SyncCoordinator(stored, { transport, onRemote, onStatus });
    coordinator.configure('writer', 't1');
    handlers.onValue(marshalForFirebase(stored));
    return { coordinator, handlers, transport };
  }

  describe('configure', () => {
    it('reports idle when given no tournamentId', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      // The coordinator already starts as { mode: 'writer', tournamentId: null } internally,
      // so configuring with the same writer/null pair would be a no-op (subscriptionChanged
      // stays false) -- use 'viewer' so the mode change actually triggers the idle path.
      coordinator.configure('viewer', null);
      expect(statuses).toEqual([{ kind: 'idle' }]);
      expect(transport.subscribe).not.toHaveBeenCalled();
    });

    it('reports unavailable when a tournamentId is set but there is no transport', () => {
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport: null,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      expect(statuses).toEqual([{ kind: 'unavailable' }]);
    });

    it('connects and subscribes with the given tournamentId', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      expect(statuses).toEqual([{ kind: 'connecting' }]);
      expect(transport.subscribe).toHaveBeenCalledTimes(1);
      expect(transport.subscribe).toHaveBeenCalledWith('t1', expect.any(Function), expect.any(Function));
    });

    it('sends nothing before the first snapshot, then sends the edits made meanwhile as a patch', async () => {
      const { handlers, transport } = subscribeCapturing();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      coordinator.updateLocal(
        createDefaultTournamentState(),
        createDefaultTournamentState({ scores: { a: 1 } }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.update).not.toHaveBeenCalled();

      handlers.onValue(marshalForFirebase(createDefaultTournamentState()));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(1);
      expect(transport.update).toHaveBeenCalledWith('t1', { scores: { a: 1 } });
    });

    it('is a no-op when re-called with the same mode and tournamentId', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      coordinator.configure('viewer', 't1');
      expect(transport.subscribe).toHaveBeenCalledTimes(1);
    });

    it('re-subscribes when the tournamentId changes', () => {
      const unsubscribe = vi.fn();
      const transport = createTransport({ subscribe: vi.fn(() => unsubscribe) });
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      coordinator.configure('viewer', 't2');
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(transport.subscribe).toHaveBeenCalledTimes(2);
    });
  });

  describe('debounce and coalescing', () => {
    it('does not write before delayMs elapses', async () => {
      const { coordinator, transport } = startWriter();
      await vi.advanceTimersByTimeAsync(400); // the push the snapshot itself scheduled
      coordinator.updateLocal(
        createDefaultTournamentState(),
        createDefaultTournamentState({ scores: { a: 1 } }),
      );
      await vi.advanceTimersByTimeAsync(399);
      expect(transport.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(transport.update).toHaveBeenCalledTimes(1);
    });

    it('collapses several rapid updates into a single write, timed from the last call', async () => {
      const { coordinator, transport } = startWriter();
      const base = createDefaultTournamentState();
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(200);
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 2 } }));
      await vi.advanceTimersByTimeAsync(200);
      expect(transport.update).not.toHaveBeenCalled(); // 400ms since the *first* call, but only 200ms since the last
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 3 } }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-flight push guard', () => {
    it('coalesces a push scheduled while a write is still in flight, rather than firing concurrently', async () => {
      const deferred = createDeferredWrite();
      const update = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue(undefined);
      const { coordinator } = startWriter(createDefaultTournamentState(), { update });
      const base = createDefaultTournamentState();
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(400);
      expect(update).toHaveBeenCalledTimes(1);

      coordinator.updateLocal(
        createDefaultTournamentState({ scores: { a: 1 } }),
        createDefaultTournamentState({ scores: { a: 2 } }),
      );
      await vi.advanceTimersByTimeAsync(400);
      // The first write is still pending -- the scheduled push must coalesce, not fire a second write.
      expect(update).toHaveBeenCalledTimes(1);

      deferred.resolve();
      await vi.advanceTimersByTimeAsync(400);
      expect(update).toHaveBeenCalledTimes(2);
    });

    it('keeps a key dirty if it changes again while its earlier push is still in flight, so a stale remote value cannot silently overwrite it', async () => {
      const deferred = createDeferredWrite();
      const update = vi.fn(() => deferred.promise);
      const stored = createDefaultTournamentState({ scores: { a: 0 } });
      const { coordinator, handlers } = startWriter(stored, { update });
      coordinator.updateLocal(stored, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(400); // push starts, snapshots a: 1, awaits the write
      expect(update).toHaveBeenCalledTimes(1);

      // Key changes again before the in-flight write resolves.
      coordinator.updateLocal(
        createDefaultTournamentState({ scores: { a: 1 } }),
        createDefaultTournamentState({ scores: { a: 2 } }),
      );

      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0); // let the in-flight push's continuation run

      // A remote update now arrives echoing the stale pushed value (1). Since 'a' no
      // longer matches what was pushed (current is 2), it must still be dirty -- the
      // merge should protect the local value 2, not overwrite it with the stale 1.
      handlers.onValue({ scores: { a: 1 } });
      expect(remoteStates.at(-1)?.scores.a).toBe(2);
    });
  });

  describe('patch pushes', () => {
    const empty = () => createDefaultTournamentState();

    it('sends only patches once the stored tournament is known', async () => {
      const { coordinator, transport } = startWriter();
      coordinator.updateLocal(empty(), createDefaultTournamentState({ curRound: 2 }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(1);
      expect(transport.update).toHaveBeenCalledWith('t1', { curRound: 2 });
    });

    it('sends one score as one path', async () => {
      const withScore = createDefaultTournamentState({ scores: { a: 1 } });
      const { coordinator, transport } = startWriter(withScore);
      coordinator.updateLocal(withScore, createDefaultTournamentState({ scores: { a: 1, b: 2 } }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { 'scores/b': 2 });
    });

    it('skips a push when nothing differs from what Firebase holds', async () => {
      const { coordinator, transport } = startWriter();
      coordinator.schedulePush();
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).not.toHaveBeenCalled();
    });

    it('patches against the remote snapshot once one has arrived', async () => {
      const { handlers, transport } = subscribeCapturing();
      const coordinator = new SyncCoordinator(empty(), { transport, onRemote, onStatus });
      coordinator.configure('writer', 't1');
      const stored = createDefaultTournamentState({ scores: { a: 1 }, curRound: 1 });
      handlers.onValue(marshalForFirebase(stored));
      coordinator.updateLocal(stored, createDefaultTournamentState({ scores: { a: 1, b: 2 }, curRound: 1 }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { 'scores/b': 2 });
    });

    it('sends nothing after the stored tournament disappears, until it is back', async () => {
      const { coordinator, handlers, transport } = startWriter();
      handlers.onValue(null);
      coordinator.updateLocal(empty(), createDefaultTournamentState({ scores: { a: 3 } }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.update).not.toHaveBeenCalled();

      handlers.onValue(marshalForFirebase(empty()));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { scores: { a: 3 } });
    });

    it('keeps its own dirty score when a remote snapshot arrives between two pushes, and still sends it', async () => {
      const { handlers, transport } = subscribeCapturing();
      const start = createDefaultTournamentState({ scores: { a: 0 } });
      const coordinator = new SyncCoordinator(start, { transport, onRemote, onStatus });
      coordinator.configure('writer', 't1');
      handlers.onValue(marshalForFirebase(start));
      coordinator.updateLocal(start, createDefaultTournamentState({ scores: { a: 5 } }));
      // Another admin's score arrives, with the old value of 'a', before the push goes out.
      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ scores: { a: 0, z: 9 } })));
      expect(remoteStates.at(-1)?.scores).toEqual({ a: 5, z: 9 });
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { 'scores/a': 5 });
    });

    it('keeps a snapshot that arrives during a push as the base, so the local value is sent again', async () => {
      const { handlers, transport } = subscribeCapturing();
      const deferred = createDeferredWrite();
      transport.update = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue(undefined);
      const start = createDefaultTournamentState({ scores: { a: 0 } });
      const coordinator = new SyncCoordinator(start, { transport, onRemote, onStatus });
      coordinator.configure('writer', 't1');
      handlers.onValue(marshalForFirebase(start));
      coordinator.updateLocal(start, createDefaultTournamentState({ scores: { a: 5 } }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(1);

      // Another admin's value for the same key lands while our push is still in flight.
      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ scores: { a: 9 } })));
      deferred.resolve();
      await vi.advanceTimersByTimeAsync(0);
      coordinator.schedulePush();
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(2);
      expect(transport.update).toHaveBeenLastCalledWith('t1', { 'scores/a': 5 });
    });

    it('forgets what it knew of one tournament when it switches to another', async () => {
      const { coordinator, handlers, transport } = startWriter();
      coordinator.configure('writer', 't2');
      coordinator.updateLocal(empty(), createDefaultTournamentState({ scores: { a: 4 } }));
      await vi.advanceTimersByTimeAsync(1000);
      // Nothing goes out as a patch against t1's contents before t2's own snapshot has arrived.
      expect(transport.update).not.toHaveBeenCalled();

      handlers.onValue(marshalForFirebase(empty()));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledTimes(1);
      expect(transport.update).toHaveBeenCalledWith('t2', { scores: { a: 4 } });
    });

    it('stops protecting a score that was edited and then put back before the push', async () => {
      const { handlers, transport } = subscribeCapturing();
      const start = createDefaultTournamentState({ scores: { a: 1 } });
      const coordinator = new SyncCoordinator(start, { transport, onRemote, onStatus });
      coordinator.configure('writer', 't1');
      handlers.onValue(marshalForFirebase(start));
      const edited = createDefaultTournamentState({ scores: { a: 2 } });
      coordinator.updateLocal(start, edited);
      coordinator.updateLocal(edited, start);
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).not.toHaveBeenCalled();

      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ scores: { a: 7 } })));
      expect(remoteStates.at(-1)?.scores.a).toBe(7);
    });

    it('never puts the status fields or the id in a patch, and takes them from the snapshot', async () => {
      const stored = createDefaultTournamentState({ tournamentId: 't1', started: false });
      const { coordinator, handlers, transport } = startWriter(stored);
      coordinator.updateLocal(
        stored,
        createDefaultTournamentState({
          tournamentId: 'other',
          started: true,
          lifecycle: { status: 'draft', testRun: false, createdAt: 1, finishedAt: null },
          curRound: 2,
        }),
      );
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { curRound: 2 });

      handlers.onValue(marshalForFirebase({ ...stored, started: true, curRound: 2 }));
      expect(remoteStates.at(-1)?.started).toBe(true);
    });

    it('sends the changed list fields with the patch, and none when they did not change', async () => {
      const describe = (state: TournamentState) => ({ title: state.title, unitCount: state.players.length });
      const stored = createDefaultTournamentState({ title: 'Old' });
      const { handlers, transport } = subscribeCapturing();
      const coordinator = new SyncCoordinator(stored, { transport, onRemote, onStatus, describe });
      coordinator.configure('writer', 't1');
      handlers.onValue(marshalForFirebase(stored));
      coordinator.updateLocal(stored, createDefaultTournamentState({ title: 'New' }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenLastCalledWith('t1', { title: 'New' }, { title: 'New' });

      const renamed = createDefaultTournamentState({ title: 'New' });
      coordinator.updateLocal(renamed, createDefaultTournamentState({ title: 'New', curRound: 1 }));
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenLastCalledWith('t1', { curRound: 1 });
    });

    it('sends what is waiting at once on flush, without waiting for the debounce', async () => {
      const stored = createDefaultTournamentState();
      const { coordinator, transport } = startWriter(stored);
      coordinator.updateLocal(stored, createDefaultTournamentState({ scores: { a: 1 } }));
      await coordinator.flush();
      expect(transport.update).toHaveBeenCalledWith('t1', { scores: { a: 1 } });
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.update).toHaveBeenCalledTimes(1);
    });

    it('does not let the dirty scores of the tournament it left protect the next one', () => {
      const stored = createDefaultTournamentState({ scores: { a: 0 } });
      const { coordinator, handlers } = startWriter(stored);
      coordinator.updateLocal(stored, createDefaultTournamentState({ scores: { a: 9 } }));
      coordinator.configure('writer', 't2');
      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ scores: { a: 4 } })));
      expect(remoteStates.at(-1)?.scores.a).toBe(4);
    });

    it('does not bring back the scores another admin cleared, when nothing was edited here', async () => {
      const played = createDefaultTournamentState({
        scores: { 'r0-rm1-p0': 7, 'r0-rm1-p1': 3 },
        finalScores: { x: 4 },
        curRound: 2,
      });
      const { handlers, transport } = startWriter(played);
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.update).not.toHaveBeenCalled();

      // Another admin sends the tournament back to draft: no scores, round 0.
      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ curRound: 0 })));
      await vi.advanceTimersByTimeAsync(1000);
      expect(transport.update).not.toHaveBeenCalled();
      expect(remoteStates.at(-1)?.scores).toEqual({});
      expect(remoteStates.at(-1)?.finalScores).toEqual({});
    });

    it('still sends a score edited here when a snapshot without that key arrives first', async () => {
      const stored = createDefaultTournamentState();
      const { coordinator, handlers, transport } = startWriter(stored);
      coordinator.updateLocal(stored, createDefaultTournamentState({ scores: { a: 5 } }));
      handlers.onValue(marshalForFirebase(createDefaultTournamentState({ curRound: 1 })));
      expect(remoteStates.at(-1)?.scores).toEqual({ a: 5 });
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.update).toHaveBeenCalledWith('t1', { scores: { a: 5 } });
    });

    it('resends after a failed push', async () => {
      const update = vi
        .fn<SyncTransport['update']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined);
      const { coordinator } = startWriter(empty(), { update });
      coordinator.updateLocal(empty(), createDefaultTournamentState({ curRound: 1 }));
      await vi.advanceTimersByTimeAsync(400);
      expect(statuses.at(-1)).toEqual({ kind: 'error', message: 'offline' });
      coordinator.schedulePush();
      await vi.advanceTimersByTimeAsync(400);
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenLastCalledWith('t1', { curRound: 1 });
    });
  });

  describe('receive', () => {
    it('reports waiting on a falsy payload in viewer mode', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      const subscribeCall = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0];
      const onValue = subscribeCall[1] as (payload: unknown) => void;
      statuses.length = 0;
      onValue(null);
      expect(statuses).toEqual([{ kind: 'waiting' }]);
    });

    it('reports waiting on a falsy payload in writer mode too: the tournament is not stored', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      const onValue = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
        payload: unknown,
      ) => void;
      statuses.length = 0;
      onValue(null);
      expect(statuses).toEqual([{ kind: 'waiting' }]);
      expect(remoteStates).toEqual([]);
    });

    it('applies a remote update and reports active on a real payload', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      const onValue = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][1] as (
        payload: unknown,
      ) => void;
      onValue({ curRound: 5 });
      expect(remoteStates.at(-1)?.curRound).toBe(5);
      expect(statuses.at(-1)).toEqual({ kind: 'active' });
    });
  });

  describe('transport error callback', () => {
    it('reports stale in viewer mode', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('viewer', 't1');
      const onError = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][2] as (
        error: unknown,
      ) => void;
      statuses.length = 0;
      onError(new Error('boom'));
      expect(statuses).toEqual([{ kind: 'stale' }]);
    });

    it('reports an error with the Error message in writer mode', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      const onError = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][2] as (
        error: unknown,
      ) => void;
      statuses.length = 0;
      onError(new Error('boom'));
      expect(statuses).toEqual([{ kind: 'error', message: 'boom' }]);
    });

    it('reports an error via String() for a thrown non-Error value in writer mode', () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      const onError = (transport.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][2] as (
        error: unknown,
      ) => void;
      statuses.length = 0;
      onError('plain string failure');
      expect(statuses).toEqual([{ kind: 'error', message: 'plain string failure' }]);
    });
  });

  describe('dispose', () => {
    it('clears a pending scheduled push and unsubscribes', async () => {
      const update = vi.fn(async () => {});
      const unsubscribe = vi.fn();
      const handlers: { onValue: (payload: unknown) => void } = { onValue: () => {} };
      const subscribe = vi.fn((_id: string, cb: (payload: unknown) => void) => {
        handlers.onValue = cb;
        return unsubscribe;
      });
      const transport = createTransport({ update, subscribe });
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      handlers.onValue(marshalForFirebase(createDefaultTournamentState()));
      coordinator.updateLocal(
        createDefaultTournamentState(),
        createDefaultTournamentState({ scores: { a: 1 } }),
      );
      coordinator.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(update).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});

/** What a subscriber reads after `value` was pushed through the real marshalling and Firebase's storage rules. */
const throughFirebase = (value: unknown) =>
  unmarshalFromFirebase(simulateFirebaseStorage(marshalForFirebase(value)));

describe('lossless Firebase encoding of empty values', () => {
  it('marks empty arrays and objects, at any depth', () => {
    expect(marshalForFirebase({ a: [], b: {}, c: [[], [1]], d: { e: [] } })).toEqual({
      a: { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true },
      b: { [FIREBASE_EMPTY_OBJECT_SENTINEL_KEY]: true },
      c: [{ [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true }, [1]],
      d: { e: { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true } },
    });
  });

  it('unmarshals each marker back, checked before the generic object branch', () => {
    expect(unmarshalFromFirebase({ [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true })).toEqual([]);
    expect(unmarshalFromFirebase({ [FIREBASE_EMPTY_OBJECT_SENTINEL_KEY]: true })).toEqual({});
    expect(unmarshalFromFirebase({ a: { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true } })).toEqual({ a: [] });
  });

  it.each([
    ['nested empty arrays and objects', { a: { b: [], c: {} }, d: [[]], e: { f: { g: [] } } }],
    ['empty arrays inside arrays', { rooms: [[], [1, 2], [], []] }],
    ['a leading empty per-round entry', { byes: [[], ['P1'], []] }],
    ['all-empty arrays', { byes: [[], [], []], luckyLosers: [[], []] }],
    ['null among values', { a: [1, null, 3], b: { c: null }, d: [null, []] }],
    [
      'the exact live shape',
      { byes: [[], [], ['P6', 'P9', 'P4', 'P12']], luckyLosers: [[], [], [], ['a', 'b']] },
    ],
    ['a whole state made only of empty containers', { a: [], b: {} }],
  ])('round-trips %s', (_label, value) => {
    expect(throughFirebase(value)).toEqual(value);
  });

  it('simulator sanity check: a nulls-only marshal loses the empty arrays as it did live', () => {
    const nullsOnly = (value: unknown): unknown => {
      if (value === null) return { [FIREBASE_NULL_SENTINEL_KEY]: true };
      if (Array.isArray(value)) return value.map(nullsOnly);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nullsOnly(child)]));
      }
      return value;
    };
    const byes = [[], [], ['P6', 'P9', 'P4', 'P12']];
    expect(simulateFirebaseStorage(nullsOnly({ byes }))).toEqual({
      byes: { '2': ['P6', 'P9', 'P4', 'P12'] },
    });
    expect(simulateFirebaseStorage(nullsOnly({ byes: [['x'], [], ['y']] }))).toEqual({
      byes: [['x'], null, ['y']],
    });
    expect(simulateFirebaseStorage(nullsOnly({ rooms: [] }))).toBeUndefined();
  });

  it('round-trips a settings snapshot, including empty-string fields', () => {
    const settings = settingsFromForm(createDefaultSetup());
    expect(throughFirebase({ settings })).toEqual({ settings });
  });
});

describe('real tournament states survive the Firebase round trip', () => {
  const clone = (state: TournamentState) => JSON.parse(JSON.stringify(state)) as TournamentState;

  interface Removal {
    at: number;
    victim: (state: TournamentState) => string;
  }

  /** Snapshots the state after every round; the round-tripped copy must equal the original and advance identically. */
  function checkEveryRound(config: SweepConfig, removals: Removal[] = []): TournamentState {
    let state = buildState(config) as TournamentState;
    const teamSize = config.teams ? 3 : 0;
    const pending = [...removals];
    for (let guard = 0; guard < 40; guard += 1) {
      for (const removal of pending.filter((entry) => entry.at === state.curRound)) {
        pending.splice(pending.indexOf(removal), 1);
        state = removeRosterUnit(state, removal.victim(state));
      }
      const roundTripped = throughFirebase(clone(state)) as TournamentState;
      expect(roundTripped, `${config.label}: state at round index ${state.curRound}`).toEqual(clone(state));
      if (state.rounds[state.curRound].isFinal) break;
      const original = advanceTournamentRound(scoreCurrentRound(state, teamSize));
      const viaFirebase = advanceTournamentRound(scoreCurrentRound(roundTripped, teamSize));
      expect(viaFirebase.status, `${config.label}: advancing from round index ${state.curRound}`).toBe(
        original.status,
      );
      if (original.status !== 'advanced' || viaFirebase.status !== 'advanced') break;
      expect(clone(viaFirebase.state)).toEqual(clone(original.state));
      state = original.state;
    }
    return state;
  }

  const oneVsOne = (
    count: number,
    scheduleLogic: string,
    oddCountStrategy: string,
    extra: Record<string, unknown> = {},
  ): SweepConfig => ({
    label: `1v1 ${count} ${scheduleLogic} '${oddCountStrategy}'`,
    count,
    teams: false,
    setup: {
      gameFormat: 'individual-1v1',
      scheduleLogic,
      oddCountStrategy,
      ...extra,
    } as SweepConfig['setup'],
  });

  const firstSeated = (state: TournamentState) =>
    state.assignments[state.curRound].find((entry) => entry.room !== null)!.name;

  it('1v1 12, double elimination, "Bye"', () => {
    const state = checkEveryRound(oneVsOne(12, 'double-elimination', 'bye', { poolingPhase: 'none' }));
    expect(state.rounds[state.curRound].isFinal).toBe(true);
  });

  it('FFA 17, shared Final', () => {
    const state = checkEveryRound({
      label: 'FFA 17 shared Final',
      count: 17,
      teams: false,
      setup: {
        gameFormat: 'ffa-individual',
        scheduleLogic: 'double-elimination-shared-final',
        poolingPhase: 'none',
      },
    });
    expect(state.rounds[state.curRound].isFinal).toBe(true);
  });

  it('1v1 12 "Bye" with a removal in the WB final (the walkover)', () => {
    const state = checkEveryRound(oneVsOne(12, 'double-elimination', 'bye', { poolingPhase: 'none' }), [
      { at: 10, victim: firstSeated },
    ]);
    expect(state.rounds[state.curRound].bracket).toBe('grand-final');
    expect(state.rounds.some((round) => round.rooms.length === 0)).toBe(true);
  });

  it('1v1 10 "Bye" with two removals in the first WB round (the empty walkover)', () => {
    const state = checkEveryRound(oneVsOne(10, 'double-elimination', 'bye', { poolingPhase: 'none' }), [
      { at: 2, victim: firstSeated },
      { at: 2, victim: firstSeated },
    ]);
    expect(state.rounds[state.curRound].bracket).toBe('grand-final');
    expect(state.rounds.some((round) => round.players === 0)).toBe(true);
  });

  it('a 1v1 9-player Group Stage', () => {
    checkEveryRound(
      oneVsOne(9, 'single-elimination', 'bye', {
        poolingPhase: 'group-stage',
        groupSize: '3',
        qualifiersPerGroup: '1',
      }),
    );
  });
});
