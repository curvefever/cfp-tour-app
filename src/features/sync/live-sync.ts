import type { TournamentState } from '../../domain/tournament/types';
import { changedDescription, type TournamentDescription } from '../tournaments/tournament-summary';
import { unmarshalFromFirebase } from './firebase-marshal';
import { buildTournamentPatch } from './tournament-patch';

export {
  FIREBASE_EMPTY_ARRAY_SENTINEL_KEY,
  FIREBASE_EMPTY_OBJECT_SENTINEL_KEY,
  FIREBASE_NULL_SENTINEL_KEY,
  marshalForFirebase,
  unmarshalFromFirebase,
} from './firebase-marshal';

export interface SyncTransport {
  /** Applies a multi-path update (see `buildTournamentPatch`) to the stored tournament. */
  update(
    tournamentId: string,
    patch: Record<string, unknown>,
    summary?: Partial<TournamentDescription>,
  ): Promise<void>;
  subscribe(
    tournamentId: string,
    onValue: (payload: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export type SyncMode = 'writer' | 'viewer';
export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'unavailable' }
  | { kind: 'connecting' }
  | { kind: 'waiting' }
  | { kind: 'active' }
  | { kind: 'error'; message: string }
  | { kind: 'stale' };

// The server owns these: a patch never carries them, and a remote snapshot always wins them.
const SERVER_OWNED_KEYS = ['tournamentId', 'lifecycle', 'started'] as const;

function withoutServerOwned(state: TournamentState): TournamentState {
  const copy = { ...state };
  for (const key of SERVER_OWNED_KEYS) delete copy[key as keyof TournamentState];
  return copy;
}

function changedKeys(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].filter((key) => previous[key] !== next[key]);
}

/** The stored tournament as the app reads it (markers decoded, the legacy `adminProof` dropped). */
function decodeStoredState(remoteValue: unknown): TournamentState {
  const decoded = { ...(unmarshalFromFirebase(remoteValue) as TournamentState & { adminProof?: unknown }) };
  delete decoded.adminProof;
  return decoded;
}

export function mergeRemoteWriterState(
  current: TournamentState,
  remoteValue: unknown,
  dirtyScoreKeys: ReadonlySet<string>,
  dirtyFinalScoreKeys: ReadonlySet<string>,
): TournamentState | null {
  const decoded = unmarshalFromFirebase(remoteValue);
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const remote = { ...(decoded as Partial<TournamentState> & { adminProof?: unknown }) };
  delete remote.adminProof;
  const scores = { ...current.scores };
  for (const [key, value] of Object.entries(remote.scores ?? {})) {
    if (!dirtyScoreKeys.has(key)) scores[key] = value;
  }
  const finalScores = { ...current.finalScores };
  for (const [key, value] of Object.entries(remote.finalScores ?? {})) {
    if (!dirtyFinalScoreKeys.has(key)) finalScores[key] = value;
  }
  delete remote.scores;
  delete remote.finalScores;
  return { ...current, ...remote, scores, finalScores };
}

export interface SyncCoordinatorOptions {
  transport: SyncTransport | null;
  onRemote(state: TournamentState): void;
  onStatus(status: SyncStatus): void;
  delayMs?: number;
  /** The tournament-list fields to keep in step with the state; the changed ones go with each patch. */
  describe?(state: TournamentState): Partial<TournamentDescription>;
}

export class SyncCoordinator {
  private readonly transport: SyncTransport | null;
  private readonly onRemote: (state: TournamentState) => void;
  private readonly onStatus: (status: SyncStatus) => void;
  private readonly delayMs: number;
  private readonly describe: ((state: TournamentState) => Partial<TournamentDescription>) | undefined;
  private current: TournamentState;
  private mode: SyncMode = 'writer';
  private tournamentId: string | null = null;
  /** The state last known to be stored in Firebase; `null` while nothing is known to be stored there. */
  private base: TournamentState | null = null;
  private remoteReceivedSincePush = false;
  private dirtyScores = new Set<string>();
  private dirtyFinalScores = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private pushInFlight = false;

  constructor(initial: TournamentState, options: SyncCoordinatorOptions) {
    this.current = initial;
    this.transport = options.transport;
    this.onRemote = options.onRemote;
    this.onStatus = options.onStatus;
    this.delayMs = options.delayMs ?? 400;
    this.describe = options.describe;
  }

  configure(mode: SyncMode, tournamentId: string | null): void {
    const subscriptionChanged = mode !== this.mode || tournamentId !== this.tournamentId;
    this.mode = mode;
    this.tournamentId = tournamentId;
    if (!subscriptionChanged) return;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.base = null;
    if (!tournamentId) {
      this.onStatus({ kind: 'idle' });
      return;
    }
    if (!this.transport) {
      this.onStatus({ kind: 'unavailable' });
      return;
    }
    this.onStatus({ kind: 'connecting' });
    this.unsubscribe = this.transport.subscribe(
      tournamentId,
      (payload) => this.receive(payload),
      (error) => {
        if (this.mode === 'viewer') this.onStatus({ kind: 'stale' });
        else
          this.onStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
  }

  setCurrent(state: TournamentState): void {
    this.current = state;
  }

  updateLocal(previous: TournamentState, next: TournamentState): void {
    this.current = next;
    changedKeys(previous.scores, next.scores).forEach((key) => this.dirtyScores.add(key));
    changedKeys(previous.finalScores, next.finalScores).forEach((key) => this.dirtyFinalScores.add(key));
    this.schedulePush();
  }

  schedulePush(): void {
    if (this.mode === 'viewer' || !this.transport || !this.tournamentId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), this.delayMs);
  }

  private async push(): Promise<void> {
    this.timer = null;
    if (this.mode === 'viewer' || !this.transport || !this.tournamentId) return;
    // Every tournament exists in Firebase before it is edited, so nothing is sent until its first snapshot has
    // arrived: the edits made meanwhile stay dirty and go out as a patch afterwards.
    if (!this.base) return;
    if (this.pushInFlight) {
      // A previous push (e.g. a slow or hung write) is still settling — coalesce
      // instead of firing another concurrent request on top of it, so a stalled
      // sync backend can never accumulate an unbounded backlog of open writes.
      this.schedulePush();
      return;
    }
    const stateAtPush = JSON.parse(JSON.stringify(this.current)) as TournamentState;
    const pushedScores = Object.fromEntries(
      [...this.dirtyScores].map((key) => [key, stateAtPush.scores[key]]),
    );
    const pushedFinalScores = Object.fromEntries(
      [...this.dirtyFinalScores].map((key) => [key, stateAtPush.finalScores[key]]),
    );
    const patch = buildTournamentPatch(withoutServerOwned(this.base), withoutServerOwned(stateAtPush));
    if (!patch) {
      // Nothing differs from what Firebase holds, so no local edit is still waiting to be sent.
      this.dirtyScores.clear();
      this.dirtyFinalScores.clear();
      return;
    }
    this.pushInFlight = true;
    this.remoteReceivedSincePush = false;
    try {
      const summary = this.describe
        ? changedDescription(this.describe(this.base), this.describe(stateAtPush))
        : {};
      if (Object.keys(summary).length) await this.transport.update(this.tournamentId, patch, summary);
      else await this.transport.update(this.tournamentId, patch);
      // A snapshot that arrived meanwhile is newer than the state this push started from.
      if (!this.remoteReceivedSincePush) this.base = stateAtPush;
      for (const [key, value] of Object.entries(pushedScores))
        if (this.current.scores[key] === value) this.dirtyScores.delete(key);
      for (const [key, value] of Object.entries(pushedFinalScores))
        if (this.current.finalScores[key] === value) this.dirtyFinalScores.delete(key);
      this.onStatus({ kind: 'active' });
    } catch (error) {
      this.onStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.pushInFlight = false;
    }
  }

  private receive(payload: unknown): void {
    if (!payload) {
      this.base = null;
      this.onStatus({ kind: 'waiting' });
      return;
    }
    const next =
      this.mode === 'viewer'
        ? mergeRemoteWriterState(this.current, payload, new Set(), new Set())
        : mergeRemoteWriterState(this.current, payload, this.dirtyScores, this.dirtyFinalScores);
    if (!next) return;
    this.base = decodeStoredState(payload);
    this.remoteReceivedSincePush = true;
    this.current = next;
    this.onRemote(next);
    this.onStatus({ kind: 'active' });
    // Edits made before this first snapshot arrived can go out now.
    this.schedulePush();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
