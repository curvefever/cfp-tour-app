import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import {
  FIREBASE_NULL_SENTINEL_KEY,
  SyncCoordinator,
  marshalNullsForFirebase,
  mergeRemoteWriterState,
  unmarshalNullsFromFirebase,
  type SyncStatus,
  type SyncTransport,
} from './live-sync';

describe('marshalNullsForFirebase / unmarshalNullsFromFirebase', () => {
  it('round-trips null through nested objects and arrays', () => {
    const original = { a: null, b: [1, null, { c: null }], d: { e: [null] } };
    const marshaled = marshalNullsForFirebase(original);
    expect(marshaled).toEqual({
      a: { [FIREBASE_NULL_SENTINEL_KEY]: true },
      b: [1, { [FIREBASE_NULL_SENTINEL_KEY]: true }, { c: { [FIREBASE_NULL_SENTINEL_KEY]: true } }],
      d: { e: [{ [FIREBASE_NULL_SENTINEL_KEY]: true }] },
    });
    expect(unmarshalNullsFromFirebase(marshaled)).toEqual(original);
  });

  it('leaves non-null primitives and plain objects untouched', () => {
    expect(marshalNullsForFirebase(0)).toBe(0);
    expect(marshalNullsForFirebase('x')).toBe('x');
    expect(marshalNullsForFirebase(undefined)).toBe(undefined);
    expect(unmarshalNullsFromFirebase({ a: 1 })).toEqual({ a: 1 });
  });

  it('treats the sentinel key as a truthiness check, not a strict === true check', () => {
    // A falsy sentinel value must NOT be unmarshaled back to null.
    expect(unmarshalNullsFromFirebase({ [FIREBASE_NULL_SENTINEL_KEY]: false })).toEqual({
      [FIREBASE_NULL_SENTINEL_KEY]: false,
    });
    // Any other truthy sentinel value still counts.
    expect(unmarshalNullsFromFirebase({ [FIREBASE_NULL_SENTINEL_KEY]: 1 })).toBe(null);
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

  it('leaves a score key untouched if it is absent from the remote scores', () => {
    const merged = mergeRemoteWriterState(current, { scores: {} }, new Set(), new Set());
    expect(merged?.scores).toEqual({ a: 1, b: 2 });
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
      write: vi.fn(async () => {}),
      subscribe: vi.fn(() => vi.fn()),
      ...overrides,
    };
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

    it('schedules a push when configuring in writer mode', async () => {
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      await vi.advanceTimersByTimeAsync(400);
      expect(transport.write).toHaveBeenCalledTimes(1);
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
      const transport = createTransport();
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      transport.write = vi.fn(async () => {});
      const state = createDefaultTournamentState({ scores: { a: 1 } });
      coordinator.updateLocal(createDefaultTournamentState(), state);
      await vi.advanceTimersByTimeAsync(399);
      expect(transport.write).not.toHaveBeenCalled();
    });

    it('collapses several rapid updates into a single write, timed from the last call', async () => {
      const write = vi.fn(async () => {});
      const transport = createTransport({ write });
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
        delayMs: 400,
      });
      coordinator.configure('writer', 't1');
      await vi.advanceTimersByTimeAsync(400); // flush the initial configure-triggered push
      write.mockClear();

      const base = createDefaultTournamentState();
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(200);
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 2 } }));
      await vi.advanceTimersByTimeAsync(200);
      expect(write).not.toHaveBeenCalled(); // 400ms since the *first* call, but only 200ms since the last
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 3 } }));
      await vi.advanceTimersByTimeAsync(400);
      expect(write).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-flight push guard', () => {
    it('coalesces a push scheduled while a write is still in flight, rather than firing concurrently', async () => {
      const deferred = createDeferredWrite();
      const write = vi.fn(() => deferred.promise);
      const transport = createTransport({ write });
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      await vi.advanceTimersByTimeAsync(400);
      expect(write).toHaveBeenCalledTimes(1);

      const base = createDefaultTournamentState();
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(400);
      // The first write is still pending -- the scheduled push must coalesce, not fire a second write.
      expect(write).toHaveBeenCalledTimes(1);

      deferred.resolve();
      await vi.advanceTimersByTimeAsync(400);
      expect(write).toHaveBeenCalledTimes(2);
    });

    it('keeps a key dirty if it changes again while its earlier push is still in flight, so a stale remote value cannot silently overwrite it', async () => {
      const deferred = createDeferredWrite();
      const write = vi.fn(() => deferred.promise);
      let onValue!: (payload: unknown) => void;
      const transport = createTransport({
        write,
        subscribe: vi.fn((_id: string, cb: (payload: unknown) => void) => {
          onValue = cb;
          return vi.fn();
        }),
      });
      const coordinator = new SyncCoordinator(createDefaultTournamentState({ scores: { a: 0 } }), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');

      const base = createDefaultTournamentState({ scores: { a: 0 } });
      coordinator.updateLocal(base, createDefaultTournamentState({ scores: { a: 1 } }));
      await vi.advanceTimersByTimeAsync(400); // push starts, snapshots a: 1, awaits write
      expect(write).toHaveBeenCalledTimes(1);

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
      onValue({ scores: { a: 1 } });
      expect(remoteStates.at(-1)?.scores.a).toBe(2);
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

    it('ignores a falsy payload in writer mode without changing status', () => {
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
      expect(statuses).toEqual([]);
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
      const write = vi.fn(async () => {});
      const unsubscribe = vi.fn();
      const transport = createTransport({ write, subscribe: vi.fn(() => unsubscribe) });
      const coordinator = new SyncCoordinator(createDefaultTournamentState(), {
        transport,
        onRemote,
        onStatus,
      });
      coordinator.configure('writer', 't1');
      write.mockClear();
      coordinator.dispose();
      await vi.advanceTimersByTimeAsync(1000);
      expect(write).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
