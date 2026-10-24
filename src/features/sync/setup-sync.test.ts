import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../domain/tournament/types';
import { marshalForFirebase } from './firebase-marshal';
import { SetupSync, type SetupTransport } from './setup-sync';

const setupWith = (overrides: Partial<PersistedSetup> = {}) => createDefaultSetup(overrides);

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('SetupSync', () => {
  let remoteSetups: PersistedSetup[];
  let errors: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    remoteSetups = [];
    errors = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function start(stored = setupWith(), overrides: Partial<SetupTransport> = {}, initial = stored) {
    const handlers = { onValue: (_payload: unknown) => {} };
    const transport: SetupTransport = {
      update: vi.fn(async () => {}),
      subscribe: vi.fn((_id: string, cb: (payload: unknown) => void) => {
        handlers.onValue = cb;
        return vi.fn();
      }),
      ...overrides,
    };
    const sync = new SetupSync(initial, {
      transport,
      onRemote: (setup) => remoteSetups.push(setup),
      onError: (message) => errors.push(message),
    });
    sync.configure('t1');
    handlers.onValue(marshalForFirebase(stored));
    return { sync, transport, handlers };
  }

  it('sends a patch of just the changed field, after the debounce', async () => {
    const stored = setupWith();
    const { sync, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ qualAdv: '16' }));
    await vi.advanceTimersByTimeAsync(399);
    expect(transport.update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.update).toHaveBeenCalledWith('t1', { qualAdv: '16' });
  });

  it('sends several edits made in a row as one patch', async () => {
    const stored = setupWith();
    const { sync, transport } = start(stored);
    const first = setupWith({ qualAdv: '16' });
    sync.updateLocal(stored, first);
    await vi.advanceTimersByTimeAsync(200);
    sync.updateLocal(first, setupWith({ qualAdv: '16', roster: 'A\nB\nC' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledTimes(1);
    expect(transport.update).toHaveBeenCalledWith('t1', { qualAdv: '16', roster: 'A\nB\nC' });
  });

  it('skips a push when the form went back to what is stored', async () => {
    const stored = setupWith({ qualAdv: '8' });
    const { sync, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ qualAdv: '9' }));
    sync.updateLocal(setupWith({ qualAdv: '9' }), stored);
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).not.toHaveBeenCalled();
  });

  it('adds the changed list fields when a format field changes', async () => {
    const stored = setupWith();
    const { sync, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ poolingPhase: 'qual-table', qualAdv: '8' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledWith(
      't1',
      { poolingPhase: 'qual-table', qualAdv: '8' },
      { poolingPhase: 'qual-table' },
    );
  });

  it('sends nothing before the stored setup has arrived, then sends the edits made meanwhile', async () => {
    const handlers = { onValue: (_payload: unknown) => {} };
    const transport: SetupTransport = {
      update: vi.fn(async () => {}),
      subscribe: vi.fn((_id: string, cb: (payload: unknown) => void) => {
        handlers.onValue = cb;
        return vi.fn();
      }),
    };
    const sync = new SetupSync(setupWith(), { transport, onRemote: () => {}, onError: () => {} });
    sync.configure('t1');
    sync.updateLocal(setupWith(), setupWith({ roster: 'A' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.update).not.toHaveBeenCalled();

    handlers.onValue(marshalForFirebase(setupWith()));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledWith('t1', { roster: 'A' });
  });

  it('takes a remote value for a field nobody here is editing', () => {
    const { handlers } = start(setupWith());
    handlers.onValue(marshalForFirebase(setupWith({ qualAdv: '12', finalsGames: '2' })));
    expect(remoteSetups.at(-1)).toMatchObject({ qualAdv: '12', finalsGames: '2' });
  });

  it('keeps the field being typed in, and takes the others', () => {
    const stored = setupWith();
    const { sync, handlers } = start(stored);
    sync.updateLocal(stored, setupWith({ roster: 'A\nB' }));
    handlers.onValue(marshalForFirebase(setupWith({ roster: 'X', qualAdv: '12' })));
    expect(remoteSetups.at(-1)?.roster).toBe('A\nB');
    expect(remoteSetups.at(-1)?.qualAdv).toBe('12');
  });

  it('does not send its own older value over another admin newer one', async () => {
    const stored = setupWith({ finalsGames: '3' });
    const { sync, handlers, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ finalsGames: '5' }));
    await vi.advanceTimersByTimeAsync(400); // pushed and acknowledged
    expect(transport.update).toHaveBeenCalledTimes(1);
    handlers.onValue(marshalForFirebase(setupWith({ finalsGames: '5' }))); // the echo
    await vi.advanceTimersByTimeAsync(1000);

    handlers.onValue(marshalForFirebase(setupWith({ finalsGames: '7' }))); // the other admin
    expect(remoteSetups.at(-1)?.finalsGames).toBe('7');
    await vi.advanceTimersByTimeAsync(5000);
    expect(transport.update).toHaveBeenCalledTimes(1);
  });

  it('resends a protected field that a remote value would have replaced, so the last save wins', async () => {
    const stored = setupWith();
    const { sync, handlers, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ roster: 'mine' }));
    handlers.onValue(marshalForFirebase(setupWith({ roster: 'theirs' })));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledWith('t1', { roster: 'mine' });
  });

  it('sends only the fields edited here, not every field that differs from the stored setup', async () => {
    const stored = setupWith();
    const { sync, handlers, transport } = start(stored);
    // Another admin changes a field this tab never touched, while this tab edits another.
    handlers.onValue(marshalForFirebase(setupWith({ qualAdv: '12' })));
    sync.updateLocal(remoteSetups.at(-1) ?? stored, setupWith({ qualAdv: '12', roster: 'A' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledWith('t1', { roster: 'A' });
  });

  it('does not resend a field that another admin changed while its own push was in flight', async () => {
    const deferred = createDeferred();
    const update = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue(undefined);
    const stored = setupWith({ finalsGames: '3' });
    const { sync, handlers } = start(stored, { update });
    sync.updateLocal(stored, setupWith({ finalsGames: '5' }));
    await vi.advanceTimersByTimeAsync(400); // '5' is being sent
    handlers.onValue(marshalForFirebase(setupWith({ finalsGames: '7' }))); // the other admin's value lands first
    deferred.resolve();
    await vi.advanceTimersByTimeAsync(5000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('keeps a field edited here after its push failed, however long ago, until it is sent', async () => {
    const update = vi
      .fn<SetupTransport['update']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const stored = setupWith();
    const { sync, handlers } = start(stored, { update });
    sync.updateLocal(stored, setupWith({ roster: 'mine' }));
    await vi.advanceTimersByTimeAsync(400); // fails
    await vi.advanceTimersByTimeAsync(20_000);
    handlers.onValue(marshalForFirebase(setupWith({ roster: 'theirs' })));
    expect(remoteSetups.at(-1)?.roster ?? 'mine').toBe('mine');
    await vi.advanceTimersByTimeAsync(400);
    expect(update).toHaveBeenLastCalledWith('t1', { roster: 'mine' });
  });

  it('keeps what is typed when the echo of an earlier keystroke arrives', async () => {
    const deferred = createDeferred();
    const update = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValue(undefined);
    const stored = setupWith();
    const { sync, handlers } = start(stored, { update });
    sync.updateLocal(stored, setupWith({ roster: 'A' }));
    await vi.advanceTimersByTimeAsync(400); // 'A' is being sent
    sync.updateLocal(setupWith({ roster: 'A' }), setupWith({ roster: 'AB' })); // typing goes on

    handlers.onValue(marshalForFirebase(setupWith({ roster: 'A' }))); // the echo of 'A'
    deferred.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(remoteSetups.at(-1)?.roster ?? 'AB').toBe('AB');
    await vi.advanceTimersByTimeAsync(400);
    expect(update).toHaveBeenLastCalledWith('t1', { roster: 'AB' });
  });

  it('forgets one tournament when it moves to another: nothing is sent before the next one arrives', async () => {
    const stored = setupWith();
    const { sync, handlers, transport } = start(stored);
    sync.configure('t2');
    sync.updateLocal(stored, setupWith({ qualAdv: '5' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.update).not.toHaveBeenCalled();
    handlers.onValue(marshalForFirebase(setupWith()));
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.update).toHaveBeenCalledWith('t2', { qualAdv: '5' });
  });

  it('reports a failed push and sends the field again on the next one', async () => {
    const update = vi
      .fn<SetupTransport['update']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const stored = setupWith();
    const { sync } = start(stored, { update });
    sync.updateLocal(stored, setupWith({ qualAdv: '7' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(errors).toEqual(['offline']);
    sync.updateLocal(setupWith({ qualAdv: '7' }), setupWith({ qualAdv: '7', finalsGames: '2' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(update).toHaveBeenLastCalledWith('t1', { qualAdv: '7', finalsGames: '2' });
  });

  it('sends what is waiting at once on flush', async () => {
    const stored = setupWith();
    const { sync, transport } = start(stored);
    sync.updateLocal(stored, setupWith({ qualAdv: '20' }));
    await sync.flush();
    expect(transport.update).toHaveBeenCalledWith('t1', { qualAdv: '20' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.update).toHaveBeenCalledTimes(1);
  });

  it('sends a field whose push was refused on the next flush, with no further edit', async () => {
    const update = vi
      .fn<SetupTransport['update']>()
      .mockRejectedValueOnce(new Error('expired'))
      .mockResolvedValue(undefined);
    const stored = setupWith();
    const { sync } = start(stored, { update });
    sync.updateLocal(stored, setupWith({ qualAdv: '9' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(errors).toEqual(['expired']);
    await sync.flush();
    expect(update).toHaveBeenLastCalledWith('t1', { qualAdv: '9' });
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('fills a field the stored setup lacks with its default', () => {
    const { handlers } = start(setupWith());
    handlers.onValue(marshalForFirebase({ qualAdv: '3' }));
    expect(remoteSetups.at(-1)).toEqual(setupWith({ qualAdv: '3' }));
  });
});
