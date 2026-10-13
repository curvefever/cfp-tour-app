import { describe, expect, it } from 'vitest';
import {
  buildState,
  scoreCurrentRound,
  type SweepConfig,
} from '../../domain/tournament/__tests__/play-through';
import { advanceTournamentRound } from '../../domain/tournament/transitions';
import type { TournamentState } from '../../domain/tournament/types';
import {
  FIREBASE_EMPTY_ARRAY_SENTINEL_KEY,
  marshalForFirebase,
  unmarshalFromFirebase,
} from './firebase-marshal';
import { simulateFirebaseStorage } from './firebase-storage-simulation';
import { buildTournamentPatch } from './tournament-patch';
import { validatePatchInput } from './tournament-write.shared';

type Json = Record<string, unknown>;

/** Applies a patch to a stored value the way Firebase's multi-path `update()` does, then reads it back. */
function applyUpdate(stored: unknown, patch: Record<string, unknown>): unknown {
  const root = JSON.parse(JSON.stringify(stored)) as Json;
  for (const [path, value] of Object.entries(patch)) {
    const segments = path.split('/');
    const last = segments.pop()!;
    const parent = segments.reduce<Json>((node, segment) => {
      node[segment] ??= {};
      return node[segment] as Json;
    }, root);
    if (value === null) delete parent[last];
    else parent[last] = value;
  }
  return simulateFirebaseStorage(root);
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** What a subscriber reads back after `patch` was applied on top of `previous` stored in Firebase. */
function readBackAfter(previous: Json, patch: Record<string, unknown>): unknown {
  const stored = simulateFirebaseStorage(marshalForFirebase(previous));
  return unmarshalFromFirebase(applyUpdate(stored, patch));
}

describe('buildTournamentPatch', () => {
  it('is null when nothing changed, whatever the key order', () => {
    expect(buildTournamentPatch({ a: 1, b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 }, a: 1 })).toBeNull();
  });

  it('sends one path for one added or changed score', () => {
    const previous = { title: 'T', scores: { a: 1, b: 2 } };
    expect(buildTournamentPatch(previous, { ...previous, scores: { a: 1, b: 2, c: 3 } })).toEqual({
      'scores/c': 3,
    });
    expect(buildTournamentPatch(previous, { ...previous, scores: { a: 5, b: 2 } })).toEqual({
      'scores/a': 5,
    });
  });

  it('sends only the index of a new round assignment', () => {
    const previous = { assignments: [[{ name: 'A' }], [{ name: 'B' }]] };
    const next = { assignments: [[{ name: 'A' }], [{ name: 'B' }], [{ name: 'C' }]] };
    expect(buildTournamentPatch(previous, next)).toEqual({ 'assignments/2': [{ name: 'C' }] });
  });

  it('sends only the array slots that differ when the length is unchanged', () => {
    expect(buildTournamentPatch({ list: [1, 2, 3] }, { list: [1, 9, 3] })).toEqual({ 'list/1': 9 });
  });

  it('writes the whole key when an array shrinks', () => {
    expect(buildTournamentPatch({ list: [1, 2, 3] }, { list: [1, 2] })).toEqual({ list: [1, 2] });
  });

  it('writes the whole key, as a marker, when an object or array empties', () => {
    expect(buildTournamentPatch({ scores: { a: 1 } }, { scores: {} })).toEqual({
      scores: marshalForFirebase({}),
    });
    expect(buildTournamentPatch({ list: [1] }, { list: [] })).toEqual({
      list: { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true },
    });
  });

  it('writes the whole key when it goes from empty to filled, not a child under the marker', () => {
    expect(buildTournamentPatch({ scores: {} }, { scores: { a: 1 } })).toEqual({ scores: { a: 1 } });
    expect(buildTournamentPatch({ list: [] }, { list: [1, 2] })).toEqual({ list: [1, 2] });
  });

  it('deletes a key that disappears and writes a key that appears', () => {
    expect(buildTournamentPatch({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: null });
    expect(buildTournamentPatch({ a: 1 }, { a: 1, b: { c: 1 } })).toEqual({ b: { c: 1 } });
  });

  it('deletes a child that disappears from a non-empty object', () => {
    expect(buildTournamentPatch({ scores: { a: 1, b: 2 } }, { scores: { a: 1 } })).toEqual({
      'scores/b': null,
    });
  });

  it('writes the whole key on a type change', () => {
    expect(buildTournamentPatch({ x: { a: 1 } }, { x: [1] })).toEqual({ x: [1] });
    expect(buildTournamentPatch({ x: 1 }, { x: { a: 1 } })).toEqual({ x: { a: 1 } });
  });

  it('marshals nested values, so a null or empty value is a marker', () => {
    const patch = buildTournamentPatch({ scores: { a: 1 } }, { scores: { a: 1, b: null, c: [] } });
    expect(patch).toEqual({
      'scores/b': marshalForFirebase(null),
      'scores/c': { [FIREBASE_EMPTY_ARRAY_SENTINEL_KEY]: true },
    });
  });

  it('writes the whole key when a child key could not be a path step', () => {
    const previous = { names: { 'a.b': 1 } };
    expect(buildTournamentPatch(previous, { names: { 'a.b': 2 } })).toEqual({ names: { 'a.b': 2 } });
  });

  it('never holds a path together with one of its children', () => {
    const patch = buildTournamentPatch(
      { a: { x: 1 }, b: [1], c: [], d: { y: 1 } },
      { a: { x: 2 }, b: [1, 2], c: [3], d: {} },
    )!;
    const paths = Object.keys(patch);
    for (const path of paths) {
      expect(paths.some((other) => other !== path && other.startsWith(`${path}/`))).toBe(false);
    }
  });

  it('every path it emits passes the server validator', () => {
    const patch = buildTournamentPatch(
      { a: { x: 1 }, b: [1], c: 1 },
      { a: { x: 2, z: 1 }, b: [1, 2], d: [] },
    )!;
    expect(() => validatePatchInput({ tournamentId: 't1', patch })).not.toThrow();
  });
});

describe('buildTournamentPatch on real tournaments', () => {
  const configFor = (count: number): SweepConfig => ({
    label: `FFA ${count}`,
    count,
    teams: false,
    setup: { gameFormat: 'ffa-individual', scheduleLogic: 'double-elimination-shared-final' },
  });

  /** The started state, then the state after each of `rounds` scored and advanced rounds. */
  function playRounds(count: number, rounds: number): TournamentState[] {
    const states = [buildState(configFor(count))!];
    for (let round = 0; round < rounds; round += 1) {
      const advanced = advanceTournamentRound(scoreCurrentRound(states.at(-1)!, 0));
      if (advanced.status !== 'advanced') throw new Error(`could not advance past round ${round}`);
      states.push(advanced.state);
    }
    return states;
  }

  it.each([43, 67])("%i players: each step's patch rebuilds the next state in Firebase", (count) => {
    const states = playRounds(count, 2);
    for (let index = 1; index < states.length; index += 1) {
      const previous = clone(states[index - 1]) as unknown as Json;
      const next = clone(states[index]) as unknown as Json;

      // One score, then a second: the first fills an empty scores object (written whole), the second is one path.
      const [firstKey, secondKey] = Object.keys(scoreCurrentRound(states[index - 1], 0).scores).filter(
        (key) => !(key in (previous.scores as Json)),
      );
      const withOne = { ...previous, scores: { ...(previous.scores as Json), [firstKey]: 7 } };
      const firstPatch = buildTournamentPatch(previous, withOne)!;
      expect(Object.keys(firstPatch)).toEqual(
        Object.keys(previous.scores as Json).length ? [`scores/${firstKey}`] : ['scores'],
      );
      expect(readBackAfter(previous, firstPatch)).toEqual(withOne);
      const withTwo = { ...withOne, scores: { ...withOne.scores, [secondKey]: 8 } };
      const secondPatch = buildTournamentPatch(withOne, withTwo)!;
      expect(Object.keys(secondPatch)).toEqual([`scores/${secondKey}`]);
      expect(readBackAfter(withOne, secondPatch)).toEqual(withTwo);

      // Then the whole round, scored and advanced.
      const patch = buildTournamentPatch(previous, next)!;
      expect(patch).not.toBeNull();
      expect(readBackAfter(previous, patch)).toEqual(next);
      expect(JSON.stringify(patch).length).toBeLessThan(JSON.stringify(marshalForFirebase(next)).length);
    }
  });

  it('67 players: a single score is a tiny patch next to the whole state', () => {
    const [started] = playRounds(67, 0);
    const [firstKey, secondKey] = Object.keys(scoreCurrentRound(started, 0).scores);
    const previous = { ...started, scores: { [firstKey]: 5 } } as unknown as Json;
    const next = { ...started, scores: { [firstKey]: 5, [secondKey]: 6 } } as unknown as Json;
    const patch = buildTournamentPatch(previous, next)!;
    expect(Object.keys(patch)).toEqual([`scores/${secondKey}`]);
    expect(JSON.stringify(patch).length).toBeLessThan(100);
  });
});
