import { describe, expect, it } from 'vitest';
import { generateTournament } from '../../domain/tournament/generation';
import { createTournamentRuntime } from '../../domain/tournament/runtime';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { fixedIdSource } from '../../domain/tournament/__tests__/test-fixtures';
import { simulateFirebaseStorage } from '../sync/firebase-storage-simulation';
import { marshalForFirebase } from '../sync/live-sync';
import {
  ARCHIVE_MAX_ANNOTATIONS,
  buildArchiveDeleteUpdates,
  buildArchiveSaveUpdates,
  validateArchiveAnnotationsInput,
  validateArchiveDeleteInput,
  validateArchiveSaveInput,
} from './archive-write.shared';
import {
  buildSharedArchiveSummary,
  parseArchiveEntry,
  parseArchiveIndex,
  sortArchiveIndex,
  type SharedArchiveSummary,
} from './shared-archive';

function generated(count: number): TournamentState {
  const result = generateTournament(
    createDefaultTournamentState({
      confirmedCount: count,
      players: Array.from({ length: count }, (_, index) => `P${index + 1}`),
    }),
    createDefaultSetup({ scheduleLogic: 'single-elimination' }),
    createTournamentRuntime({ ids: fixedIdSource() }),
  );
  if (result.status !== 'generated') throw new Error('fixture failed');
  return { ...result.state, title: '  Spring Cup ', started: true };
}

describe('validateArchiveSaveInput', () => {
  const snapshot = generated(37);

  it('accepts a good input, trims the id and strips adminProof', () => {
    const result = validateArchiveSaveInput({
      tournamentId: ' abc_123 ',
      snapshot: { ...snapshot, adminProof: 'x' } as unknown as TournamentState,
    });
    expect(result.tournamentId).toBe('abc_123');
    expect('adminProof' in result.snapshot).toBe(false);
  });

  it('rejects a bad id, an array snapshot and a snapshot without rounds', () => {
    expect(() => validateArchiveSaveInput({ tournamentId: 'a/b', snapshot })).toThrow(
      'Invalid tournament ID.',
    );
    expect(() =>
      validateArchiveSaveInput({ tournamentId: 'abc', snapshot: [] as unknown as TournamentState }),
    ).toThrow('Invalid tournament data.');
    expect(() =>
      validateArchiveSaveInput({
        tournamentId: 'abc',
        snapshot: { title: 'x' } as unknown as TournamentState,
      }),
    ).toThrow('Invalid tournament data.');
  });
});

describe('validateArchiveDeleteInput', () => {
  it('rejects an invalid id', () => {
    expect(() => validateArchiveDeleteInput({ tournamentId: '' })).toThrow('Invalid tournament ID.');
    expect(validateArchiveDeleteInput({ tournamentId: 'abc' })).toEqual({ tournamentId: 'abc' });
  });
});

describe('validateArchiveAnnotationsInput', () => {
  const note = (text: string) => ({ text, timestamp: '2026-10-02T10:00:00.000Z' });

  it('trims text and rejects empty or oversized text', () => {
    expect(validateArchiveAnnotationsInput({ tournamentId: 'abc', annotations: [note('  hi ')] })).toEqual({
      tournamentId: 'abc',
      annotations: [note('hi')],
    });
    expect(() =>
      validateArchiveAnnotationsInput({ tournamentId: 'abc', annotations: [note('   ')] }),
    ).toThrow();
    expect(() =>
      validateArchiveAnnotationsInput({ tournamentId: 'abc', annotations: [note('x'.repeat(1001))] }),
    ).toThrow();
  });

  it('rejects too many annotations and non-string fields', () => {
    const many = Array.from({ length: ARCHIVE_MAX_ANNOTATIONS + 1 }, () => note('a'));
    expect(() => validateArchiveAnnotationsInput({ tournamentId: 'abc', annotations: many })).toThrow();
    expect(() =>
      validateArchiveAnnotationsInput({
        tournamentId: 'abc',
        annotations: [{ text: 1, timestamp: 'x' } as never],
      }),
    ).toThrow('Invalid annotation.');
  });
});

describe('buildSharedArchiveSummary', () => {
  it.each([37, 43])('summarises a %i-player tournament', (count) => {
    const state = generated(count);
    const summary = buildSharedArchiveSummary('t1', state, '2026-10-02T10:00:00.000Z');
    expect(summary).toMatchObject({
      tournamentId: 't1',
      title: 'Spring Cup',
      dateSaved: '2026-10-02T10:00:00.000Z',
      playerCount: count,
      roundsPlayed: state.rounds[state.curRound].roundNum,
      hasSettings: true,
    });
    expect(summary.roundsPlayed).toBeGreaterThan(0);
  });

  it('reports hasSettings false without settings, and names an untitled tournament', () => {
    const state = { ...generated(37), title: ' ', settings: undefined };
    const summary = buildSharedArchiveSummary('t1', state, 'd');
    expect(summary.hasSettings).toBe(false);
    expect(summary.title).toBe('Unnamed Tournament');
  });
});

describe('shared archive parsing', () => {
  it('round-trips an entry through marshal and Firebase storage, holes and empties included', () => {
    const snapshot = {
      ...generated(37),
      assignments: [null, { room: 1, names: [] }, null] as never,
      pendingNotes: [] as never,
    } as TournamentState;
    const entry = {
      tournamentId: 't1',
      title: 'Spring Cup',
      dateSaved: '2026-10-02T10:00:00.000Z',
      snapshot: marshalForFirebase(snapshot),
      annotations: marshalForFirebase([]),
    };
    const parsed = parseArchiveEntry(simulateFirebaseStorage(entry));
    expect(parsed).toEqual({ ...entry, snapshot, annotations: [] });
  });

  it('keeps annotations through the round trip', () => {
    const annotations = [{ text: 'Great final', timestamp: '2026-10-02T11:00:00.000Z' }];
    const parsed = parseArchiveEntry(
      simulateFirebaseStorage({
        tournamentId: 't1',
        title: 'T',
        dateSaved: 'd',
        snapshot: marshalForFirebase(generated(43)),
        annotations: marshalForFirebase(annotations),
      }),
    );
    expect(parsed?.annotations).toEqual(annotations);
  });

  it('drops a malformed annotation', () => {
    const parsed = parseArchiveEntry(
      simulateFirebaseStorage({
        tournamentId: 't1',
        title: 'T',
        dateSaved: 'd',
        snapshot: marshalForFirebase(generated(37)),
        annotations: [
          { text: 5, timestamp: 'x' },
          { text: 'ok', timestamp: 'y' },
        ],
      }),
    );
    expect(parsed?.annotations).toEqual([{ text: 'ok', timestamp: 'y' }]);
  });

  it('returns null for a missing or malformed entry', () => {
    expect(parseArchiveEntry(null)).toBeNull();
    expect(parseArchiveEntry({ tournamentId: 't1', title: 'x' })).toBeNull();
  });

  it('parseArchiveIndex skips a malformed record and sorts newest first', () => {
    const good = (id: string, dateSaved: string): SharedArchiveSummary => ({
      tournamentId: id,
      title: id,
      dateSaved,
      playerCount: 31,
      roundsPlayed: 3,
      hasSettings: false,
    });
    const parsed = parseArchiveIndex({
      a: good('a', '2026-01-01'),
      bad: { tournamentId: 'bad', title: 5 },
      b: good('b', '2026-03-01'),
    });
    expect(parsed.map((entry) => entry.tournamentId)).toEqual(['b', 'a']);
    expect(sortArchiveIndex([good('x', '1'), good('y', '2')])[0].tournamentId).toBe('y');
    expect(parseArchiveIndex(null)).toEqual([]);
  });

  it('reads hasSettings false when the flag is false or missing', () => {
    const base = { title: 't', dateSaved: 'd', playerCount: 31, roundsPlayed: 1 };
    const parsed = parseArchiveIndex({
      a: { ...base, tournamentId: 'a', hasSettings: false },
      b: { ...base, tournamentId: 'b' },
      c: { ...base, tournamentId: 'c', hasSettings: true },
    });
    expect(Object.fromEntries(parsed.map((e) => [e.tournamentId, e.hasSettings]))).toEqual({
      a: false,
      b: false,
      c: true,
    });
  });
});

describe('archive update maps', () => {
  const root = 'environments/test/archive';

  it('a save writes exactly the five fields, never the whole entry or its annotations', () => {
    const snapshot = { ...generated(37), assignments: [] } as TournamentState;
    const updates = buildArchiveSaveUpdates(root, 't1', snapshot, 'd');
    expect(Object.keys(updates).sort()).toEqual(
      [
        `${root}/index/t1`,
        `${root}/entries/t1/tournamentId`,
        `${root}/entries/t1/title`,
        `${root}/entries/t1/dateSaved`,
        `${root}/entries/t1/snapshot`,
      ].sort(),
    );
    expect(
      Object.keys(updates).some((key) => key === `${root}/entries/t1` || key.endsWith('/annotations')),
    ).toBe(false);
    const stored = updates[`${root}/entries/t1/snapshot`] as { assignments: unknown };
    expect(stored.assignments).toEqual({ __ffaEmptyArray: true });
  });

  it('a delete nulls exactly the index record and the entry', () => {
    expect(buildArchiveDeleteUpdates(root, 't1')).toEqual({
      [`${root}/index/t1`]: null,
      [`${root}/entries/t1`]: null,
    });
  });
});
