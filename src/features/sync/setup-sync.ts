import { createDefaultSetup } from '../../domain/tournament/state-defaults';
import type { PersistedSetup } from '../../domain/tournament/types';
import {
  changedDescription,
  setupDescription,
  type TournamentDescription,
} from '../tournaments/tournament-summary';
import { unmarshalFromFirebase } from './firebase-marshal';

export interface SetupTransport {
  update(
    tournamentId: string,
    patch: Record<string, string>,
    summary?: Partial<TournamentDescription>,
  ): Promise<void>;
  subscribe(
    tournamentId: string,
    onValue: (payload: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export interface SetupSyncOptions {
  transport: SetupTransport | null;
  onRemote(setup: PersistedSetup): void;
  onError(message: string): void;
  delayMs?: number;
}

type SetupKey = keyof PersistedSetup;

const SETUP_KEYS = Object.keys(createDefaultSetup()) as SetupKey[];

/** The stored setup as the app reads it: text fields only, anything missing at its default. */
function decodeStoredSetup(value: unknown): PersistedSetup {
  const decoded = unmarshalFromFirebase(value);
  const record = decoded && typeof decoded === 'object' ? (decoded as Record<string, unknown>) : {};
  const setup: Record<string, unknown> = { ...createDefaultSetup() };
  for (const key of SETUP_KEYS) if (typeof record[key] === 'string') setup[key] = record[key];
  return setup as unknown as PersistedSetup;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keeps one tournament's Setup form in step with Firebase, field by field: a local edit is sent as a patch of
 * just the fields edited here and not yet sent, a remote value replaces every other field, and nothing is sent
 * before the stored setup has been received.
 */
export class SetupSync {
  private readonly transport: SetupTransport | null;
  private readonly onRemote: (setup: PersistedSetup) => void;
  private readonly onError: (message: string) => void;
  private readonly delayMs: number;
  private current: PersistedSetup;
  private base: PersistedSetup | null = null;
  private tournamentId: string | null = null;
  private readonly dirty = new Set<SetupKey>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private pushInFlight = false;
  private remoteReceivedSincePush = false;

  constructor(initial: PersistedSetup, options: SetupSyncOptions) {
    this.current = initial;
    this.transport = options.transport;
    this.onRemote = options.onRemote;
    this.onError = options.onError;
    this.delayMs = options.delayMs ?? 400;
  }

  configure(tournamentId: string | null): void {
    if (tournamentId === this.tournamentId) return;
    this.tournamentId = tournamentId;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.base = null;
    this.dirty.clear();
    if (!tournamentId || !this.transport) return;
    this.unsubscribe = this.transport.subscribe(
      tournamentId,
      (payload) => this.receive(payload),
      (error) => this.onError(errorMessage(error)),
    );
  }

  /** Sends what is waiting now instead of after the debounce, e.g. before leaving the tournament or signing in again. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // A push that failed leaves no timer behind, but its fields are still dirty: `push` sends them.
    await this.push();
  }

  /** The form now holds `current`, loaded from this device or from another tournament: nothing is pending. */
  reset(current: PersistedSetup): void {
    this.current = current;
    this.dirty.clear();
  }

  updateLocal(previous: PersistedSetup, next: PersistedSetup): void {
    this.current = next;
    for (const key of SETUP_KEYS) {
      if (previous[key] === next[key]) continue;
      this.dirty.add(key);
    }
    this.schedulePush();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private schedulePush(): void {
    if (!this.transport || !this.tournamentId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), this.delayMs);
  }

  /** The fields edited here and not yet sent, whose value still differs from what is stored. */
  private changedFields(base: PersistedSetup | null): Record<string, string> {
    const changed: Record<string, string> = {};
    for (const key of [...this.dirty]) {
      const value = this.current[key];
      if (typeof value === 'string' && value !== base?.[key]) changed[key] = value;
      else this.dirty.delete(key);
    }
    return changed;
  }

  private async push(): Promise<void> {
    this.timer = null;
    if (!this.transport || !this.tournamentId) return;
    if (this.pushInFlight) {
      this.schedulePush();
      return;
    }
    // The tournament exists in Firebase before it is edited: wait for its stored setup, then send the difference.
    if (!this.base) return;
    const atPush = this.current;
    const patch = this.changedFields(this.base);
    if (!Object.keys(patch).length) {
      this.dirty.clear();
      return;
    }
    const summary = changedDescription(
      this.base ? setupDescription(this.base) : {},
      setupDescription(atPush),
    );
    this.pushInFlight = true;
    this.remoteReceivedSincePush = false;
    try {
      if (Object.keys(summary).length) await this.transport.update(this.tournamentId, patch, summary);
      else await this.transport.update(this.tournamentId, patch);
      if (!this.remoteReceivedSincePush) this.base = { ...this.base, ...patch };
      for (const [key, value] of Object.entries(patch)) {
        if (this.current[key as SetupKey] === value) this.dirty.delete(key as SetupKey);
      }
    } catch (error) {
      this.onError(errorMessage(error));
    } finally {
      this.pushInFlight = false;
    }
  }

  private receive(payload: unknown): void {
    if (!payload) {
      this.base = null;
      return;
    }
    const remote = decodeStoredSetup(payload);
    this.base = remote;
    this.remoteReceivedSincePush = true;
    const next: Record<string, unknown> = { ...this.current };
    let changed = false;
    for (const key of SETUP_KEYS) {
      if (this.dirty.has(key) || next[key] === remote[key]) continue;
      next[key] = remote[key];
      changed = true;
    }
    if (changed) {
      this.current = next as unknown as PersistedSetup;
      this.onRemote(this.current);
    }
    // Edits made before the first snapshot arrived can go out now.
    this.schedulePush();
  }
}
