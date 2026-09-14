import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { SyncCoordinator, type SyncTransport } from './live-sync';

describe('SyncCoordinator', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes the current state when a writer first receives a tournament ID', async () => {
    vi.useFakeTimers();
    const state = { ...createDefaultTournamentState(), tournamentId: 'tour-1', started: true };
    const write = vi.fn().mockResolvedValue(undefined);
    const transport: SyncTransport = {
      write,
      subscribe: () => () => undefined,
    };
    const coordinator = new SyncCoordinator(state, {
      transport,
      onRemote: () => undefined,
      onStatus: () => undefined,
    });

    coordinator.configure('writer', state.tournamentId);
    await vi.advanceTimersByTimeAsync(400);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith('tour-1', expect.objectContaining({ started: true }));
    coordinator.dispose();
  });
});
