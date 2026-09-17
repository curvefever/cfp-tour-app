import type { BrowserStorage } from './storage';

/** A plain in-memory BrowserStorage fake. Override a method inline for an error-path test. */
export function createMemoryStorage(initial: Record<string, string> = {}): BrowserStorage {
  const backing = new Map(Object.entries(initial));
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => {
      backing.set(key, value);
    },
    removeItem: (key) => {
      backing.delete(key);
    },
  };
}
