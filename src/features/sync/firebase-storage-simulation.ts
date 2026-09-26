/**
 * Test-only model of Firebase Realtime Database's documented storage rules,
 * so tests can check what a payload looks like after a write and a read:
 *
 * - Writing: arrays become objects keyed "0", "1", ...; null, undefined, []
 *   and {} are not stored (a container whose children are all dropped is
 *   dropped too).
 * - Reading: an object is returned as an array exactly when all its keys are
 *   integers and more than half of the slots from 0 to the largest key are
 *   present (missing slots come back as null); any other object stays an
 *   object.
 */

function isStorable(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function storeValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return value;
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value);
  const stored = entries
    .map(([key, child]) => [key, storeValue(child)] as const)
    .filter(([, child]) => isStorable(child));
  return stored.length ? Object.fromEntries(stored) : undefined;
}

function isSlotIndex(key: string): boolean {
  return /^(0|[1-9]\d*)$/.test(key);
}

function readValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length && entries.every(([key]) => isSlotIndex(key))) {
    const largest = Math.max(...entries.map(([key]) => Number(key)));
    if (entries.length * 2 > largest + 1) {
      const slots: unknown[] = Array.from({ length: largest + 1 }, () => null);
      for (const [key, child] of entries) slots[Number(key)] = readValue(child);
      return slots;
    }
  }
  return Object.fromEntries(entries.map(([key, child]) => [key, readValue(child)]));
}

/** What a subscriber reads back after `value` was written to Firebase (undefined if nothing was stored). */
export function simulateFirebaseStorage(value: unknown): unknown {
  return readValue(storeValue(value));
}
