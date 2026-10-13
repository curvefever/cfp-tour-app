export const FIREBASE_NULL_SENTINEL_KEY = '__ffaNull';
export const FIREBASE_EMPTY_ARRAY_SENTINEL_KEY = '__ffaEmptyArray';
export const FIREBASE_EMPTY_OBJECT_SENTINEL_KEY = '__ffaEmptyObject';

/**
 * Firebase Realtime Database stores no empty values (null, [] and {} are
 * deleted, at any depth) and turns an array back into an object when most of
 * its slots are missing. So every empty value is written as a marker object
 * instead: then no container is ever deleted and every array is stored with
 * every slot present, which Firebase always returns as an array.
 */
export function marshalForFirebase(value: unknown): unknown {
  if (value === null) return { [FIREBASE_NULL_SENTINEL_KEY]: true };
  if (Array.isArray(value)) {
    return value.length ? value.map(marshalForFirebase) : { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return { [FIREBASE_EMPTY_OBJECT_SENTINEL_KEY]: true };
    return Object.fromEntries(entries.map(([key, child]) => [key, marshalForFirebase(child)]));
  }
  return value;
}

/** Reverses marshalForFirebase. */
export function unmarshalFromFirebase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unmarshalFromFirebase);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record[FIREBASE_NULL_SENTINEL_KEY]) return null;
    if (record[FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]) return [];
    if (record[FIREBASE_EMPTY_OBJECT_SENTINEL_KEY]) return {};
    return Object.fromEntries(
      Object.entries(record).map(([key, child]) => [key, unmarshalFromFirebase(child)]),
    );
  }
  return value;
}
