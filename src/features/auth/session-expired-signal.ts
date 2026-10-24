type Listener = (startedAt: number) => void;

const listeners = new Set<Listener>();

/**
 * The one place the client learns that the CFP session ended. `startedAt` is when the call that found out
 * began, so a late answer from before a sign-in can be told from a fresh one.
 */
export function signalSessionExpired(startedAt: number): void {
  listeners.forEach((listener) => listener(startedAt));
}

/** Subscribes to the signal; returns the unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
