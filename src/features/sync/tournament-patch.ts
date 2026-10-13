import { isValidPathSegment } from './tournament-write.shared';
import { marshalForFirebase } from './firebase-marshal';

type TournamentRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is TournamentRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality for JSON values, ignoring object key order. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isSameValue(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined);
    const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
    return keys.length === otherKeys.length && keys.every((key) => isSameValue(a[key], b[key]));
  }
  return false;
}

function isNonEmptyObject(value: unknown): value is TournamentRecord {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function isNonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function childKeys(previous: TournamentRecord, next: TournamentRecord): string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])];
}

/** Child paths of one key whose values differ; `null` when the key has to be written whole instead. */
function diffObjectChildren(
  key: string,
  previous: TournamentRecord,
  next: TournamentRecord,
): Record<string, unknown> | null {
  const keys = childKeys(previous, next);
  if (!keys.every(isValidPathSegment)) return null;
  const patch: Record<string, unknown> = {};
  for (const child of keys) {
    if (isSameValue(previous[child], next[child])) continue;
    patch[`${key}/${child}`] = next[child] === undefined ? null : marshalForFirebase(next[child]);
  }
  return patch;
}

function diffArrayItems(key: string, previous: unknown[], next: unknown[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  next.forEach((item, index) => {
    if (index < previous.length && isSameValue(previous[index], item)) return;
    patch[`${key}/${index}`] = marshalForFirebase(item);
  });
  return patch;
}

function diffKey(key: string, previous: unknown, next: unknown): Record<string, unknown> {
  if (next === undefined) return previous === undefined ? {} : { [key]: null };
  if (previous !== undefined && isSameValue(previous, next)) return {};
  if (isNonEmptyObject(previous) && isNonEmptyObject(next)) {
    return diffObjectChildren(key, previous, next) ?? { [key]: marshalForFirebase(next) };
  }
  if (isNonEmptyArray(previous) && isNonEmptyArray(next) && next.length >= previous.length) {
    return diffArrayItems(key, previous, next);
  }
  // A new key, a type change or an empty side: Firebase keeps a marker object where a value is empty, and a
  // child written under one would leave the marker in place, so the whole key is written.
  return { [key]: marshalForFirebase(next) };
}

/**
 * The Firebase multi-path update that turns `previous` into `next`, two levels deep (`scores/<key>`,
 * `assignments/3`), with every value marshalled. `null` when nothing changed. Never holds a path together with
 * one of its children.
 */
export function buildTournamentPatch(previous: object, next: object): Record<string, unknown> | null {
  const before = previous as TournamentRecord;
  const after = next as TournamentRecord;
  const patch: Record<string, unknown> = {};
  for (const key of childKeys(before, after)) {
    Object.assign(patch, diffKey(key, before[key], after[key]));
  }
  return Object.keys(patch).length ? patch : null;
}
