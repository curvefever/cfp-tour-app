type Listener = () => void;

const listeners = new Set<Listener>();

/** The one place the client learns that a server call was refused because the CFP session ended. */
export function signalSessionExpired(): void {
  listeners.forEach((listener) => listener());
}

/** Subscribes to the signal; returns the unsubscribe function. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
