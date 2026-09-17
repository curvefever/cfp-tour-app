import { describe, expect, it, vi } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import type { TournamentState } from '../../domain/tournament/types';
import { archiveEntryStorageKey, LEGACY_ARCHIVE_INDEX_KEY } from './storage-keys';
import { createMemoryStorage } from './test-fixtures';
import {
  archiveBundle,
  buildArchiveSummary,
  deleteArchive,
  findLatestArchiveEntryForTournament,
  isValidArchiveImportEntry,
  loadArchiveEntry,
  loadArchiveIndex,
  parseArchiveImport,
  runArchiveImport,
  saveArchiveEntry,
  saveArchiveIndex,
  updateArchiveAnnotations,
  writeArchiveSnapshot,
  type ArchiveEntry,
  type ArchiveSummary,
} from './archive';

function buildEntry(overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    id: '1',
    title: 'Cup',
    dateSaved: '2026-01-01T00:00:00.000Z',
    tournamentId: 't1',
    snapshot: createDefaultTournamentState(),
    annotations: [],
    ...overrides,
  };
}

describe('loadArchiveIndex / loadArchiveEntry', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadArchiveIndex(createMemoryStorage())).toEqual([]);
  });

  it('returns an empty array for corrupted stored JSON', () => {
    expect(loadArchiveIndex(createMemoryStorage({ [LEGACY_ARCHIVE_INDEX_KEY]: 'not json' }))).toEqual([]);
  });

  it('returns an empty array when the stored index is not an array', () => {
    expect(
      loadArchiveIndex(createMemoryStorage({ [LEGACY_ARCHIVE_INDEX_KEY]: '{"not":"an array"}' })),
    ).toEqual([]);
  });

  it('returns null when an entry is missing', () => {
    expect(loadArchiveEntry(createMemoryStorage(), 'missing')).toBeNull();
  });

  it('returns null for a corrupted stored entry', () => {
    const storage = createMemoryStorage({ [archiveEntryStorageKey('1')]: 'not json' });
    expect(loadArchiveEntry(storage, '1')).toBeNull();
  });

  it('round-trips saveArchiveEntry/loadArchiveEntry and saveArchiveIndex/loadArchiveIndex', () => {
    const storage = createMemoryStorage();
    const entry = buildEntry();
    saveArchiveEntry(storage, entry);
    expect(loadArchiveEntry(storage, '1')).toEqual(entry);
    const index: ArchiveSummary[] = [buildArchiveSummary(entry)];
    saveArchiveIndex(storage, index);
    expect(loadArchiveIndex(storage)).toEqual(index);
  });
});

describe('buildArchiveSummary', () => {
  it('reads roundsPlayed from the round at curRound', () => {
    const entry = buildEntry({
      snapshot: createDefaultTournamentState({
        curRound: 1,
        rounds: [
          { roundNum: 1, rooms: [2] },
          { roundNum: 2, rooms: [2] },
        ] as TournamentState['rounds'],
      }),
    });
    expect(buildArchiveSummary(entry).roundsPlayed).toBe(2);
  });

  it('falls back to 0 when curRound points past the end of rounds', () => {
    const entry = buildEntry({ snapshot: createDefaultTournamentState({ curRound: 5, rounds: [] }) });
    expect(buildArchiveSummary(entry).roundsPlayed).toBe(0);
  });
});

describe('findLatestArchiveEntryForTournament', () => {
  const index: ArchiveSummary[] = [
    {
      id: '1',
      title: 'A',
      dateSaved: '2026-01-01T00:00:00.000Z',
      tournamentId: 't1',
      playerCount: 0,
      roundsPlayed: 0,
    },
    {
      id: '2',
      title: 'B',
      dateSaved: '2026-01-03T00:00:00.000Z',
      tournamentId: 't1',
      playerCount: 0,
      roundsPlayed: 0,
    },
    {
      id: '3',
      title: 'C',
      dateSaved: '2026-01-02T00:00:00.000Z',
      tournamentId: 'other',
      playerCount: 0,
      roundsPlayed: 0,
    },
  ];

  it('returns undefined for a null tournamentId', () => {
    expect(findLatestArchiveEntryForTournament(index, null)).toBeUndefined();
  });

  it('picks the entry with the max dateSaved among matches', () => {
    expect(findLatestArchiveEntryForTournament(index, 't1')?.id).toBe('2');
  });

  it('keeps the earlier-encountered entry on an exact dateSaved tie (intentional first-wins)', () => {
    const tied: ArchiveSummary[] = [
      {
        id: 'first',
        title: 'A',
        dateSaved: '2026-01-01T00:00:00.000Z',
        tournamentId: 't1',
        playerCount: 0,
        roundsPlayed: 0,
      },
      {
        id: 'second',
        title: 'B',
        dateSaved: '2026-01-01T00:00:00.000Z',
        tournamentId: 't1',
        playerCount: 0,
        roundsPlayed: 0,
      },
    ];
    expect(findLatestArchiveEntryForTournament(tied, 't1')?.id).toBe('first');
  });
});

describe('writeArchiveSnapshot', () => {
  it('falls back to "Unnamed Tournament" for a blank title', () => {
    const storage = createMemoryStorage();
    const entry = writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: '   ' }),
      id: '1',
      dateSaved: '2026-01-01T00:00:00.000Z',
    });
    expect(entry.title).toBe('Unnamed Tournament');
  });

  it('starts with empty annotations by default', () => {
    const storage = createMemoryStorage();
    const entry = writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: 'Cup' }),
      id: '1',
      dateSaved: '2026-01-01T00:00:00.000Z',
    });
    expect(entry.annotations).toEqual([]);
  });

  it('preserves a prior entry annotations when keepAnnotations is true', () => {
    const storage = createMemoryStorage();
    saveArchiveEntry(storage, buildEntry({ annotations: [{ text: 'note', timestamp: 't' }] }));
    const entry = writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: 'Cup' }),
      id: '1',
      dateSaved: '2026-01-02T00:00:00.000Z',
      keepAnnotations: true,
    });
    expect(entry.annotations).toEqual([{ text: 'note', timestamp: 't' }]);
  });

  it('inserts a new index entry for a new id, and replaces an existing one in place', () => {
    const storage = createMemoryStorage();
    writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: 'A' }),
      id: '1',
      dateSaved: 'd1',
    });
    writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: 'B' }),
      id: '2',
      dateSaved: 'd2',
    });
    expect(loadArchiveIndex(storage).map((s) => s.id)).toEqual(['1', '2']);
    writeArchiveSnapshot({
      storage,
      state: createDefaultTournamentState({ title: 'A2' }),
      id: '1',
      dateSaved: 'd3',
    });
    const index = loadArchiveIndex(storage);
    expect(index.map((s) => s.id)).toEqual(['1', '2']);
    expect(index[0].title).toBe('A2');
  });

  it('deep-clones the snapshot -- mutating the source state afterward does not affect the stored entry', () => {
    const storage = createMemoryStorage();
    const state = createDefaultTournamentState({ title: 'Cup', curRound: 1 });
    const entry = writeArchiveSnapshot({ storage, state, id: '1', dateSaved: 'd1' });
    state.curRound = 99;
    expect(entry.snapshot.curRound).toBe(1);
    expect(loadArchiveEntry(storage, '1')?.snapshot.curRound).toBe(1);
  });
});

describe('deleteArchive', () => {
  it('removes both the entry and its index row, coercing id via String() on both sides', () => {
    const storage = createMemoryStorage();
    const entry = buildEntry({ id: '5' });
    saveArchiveEntry(storage, entry);
    saveArchiveIndex(storage, [buildArchiveSummary(entry)]);
    // Numeric id in storage vs. a numeric argument here -- both coerced via String().
    deleteArchive(storage, 5 as unknown as string);
    expect(loadArchiveEntry(storage, '5')).toBeNull();
    expect(loadArchiveIndex(storage)).toEqual([]);
  });
});

describe('updateArchiveAnnotations', () => {
  it('returns null for a missing entry', () => {
    expect(updateArchiveAnnotations(createMemoryStorage(), 'missing', [])).toBeNull();
  });

  it('replaces annotations and preserves the rest of the entry', () => {
    const storage = createMemoryStorage();
    saveArchiveEntry(storage, buildEntry());
    const updated = updateArchiveAnnotations(storage, '1', [{ text: 'new', timestamp: 't' }]);
    expect(updated?.annotations).toEqual([{ text: 'new', timestamp: 't' }]);
    expect(updated?.title).toBe('Cup');
    expect(loadArchiveEntry(storage, '1')?.annotations).toEqual([{ text: 'new', timestamp: 't' }]);
  });
});

describe('archiveBundle', () => {
  it('builds a bundle from every index summary', () => {
    const storage = createMemoryStorage();
    const entryA = buildEntry({ id: '1' });
    const entryB = buildEntry({ id: '2' });
    saveArchiveEntry(storage, entryA);
    saveArchiveEntry(storage, entryB);
    saveArchiveIndex(storage, [buildArchiveSummary(entryA), buildArchiveSummary(entryB)]);
    const bundle = archiveBundle(storage, 'now');
    expect(bundle.exportedAt).toBe('now');
    expect(bundle.tournaments.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('silently drops an index entry whose stored JSON is corrupted, rather than throwing', () => {
    const storage = createMemoryStorage();
    const entryA = buildEntry({ id: '1' });
    saveArchiveEntry(storage, entryA);
    storage.setItem(archiveEntryStorageKey('2'), 'not json');
    saveArchiveIndex(storage, [
      buildArchiveSummary(entryA),
      { id: '2', title: 'Broken', dateSaved: 'd', tournamentId: null, playerCount: 0, roundsPlayed: 0 },
    ]);
    const bundle = archiveBundle(storage, 'now');
    expect(bundle.tournaments.map((t) => t.id)).toEqual(['1']);
  });
});

describe('isValidArchiveImportEntry', () => {
  it('accepts a valid entry shape', () => {
    expect(isValidArchiveImportEntry(buildEntry())).toBe(true);
  });

  it('rejects a missing or null id', () => {
    const { id: _id, ...withoutId } = buildEntry();
    expect(isValidArchiveImportEntry(withoutId)).toBe(false);
    expect(isValidArchiveImportEntry({ ...buildEntry(), id: null })).toBe(false);
  });

  it('rejects a missing or malformed snapshot', () => {
    const { snapshot: _snapshot, ...withoutSnapshot } = buildEntry();
    expect(isValidArchiveImportEntry(withoutSnapshot)).toBe(false);
    expect(isValidArchiveImportEntry({ ...buildEntry(), snapshot: null })).toBe(false);
  });

  it('rejects a snapshot whose players/rounds/assignments are not arrays', () => {
    const entry = buildEntry();
    expect(isValidArchiveImportEntry({ ...entry, snapshot: { ...entry.snapshot, players: 'nope' } })).toBe(
      false,
    );
    expect(isValidArchiveImportEntry({ ...entry, snapshot: { ...entry.snapshot, rounds: 'nope' } })).toBe(
      false,
    );
    expect(
      isValidArchiveImportEntry({ ...entry, snapshot: { ...entry.snapshot, assignments: 'nope' } }),
    ).toBe(false);
  });
});

describe('parseArchiveImport', () => {
  it('returns invalid-json for malformed text', () => {
    expect(parseArchiveImport('not json')).toEqual({ status: 'invalid-json' });
  });

  it('returns empty-bundle for a bundle with no tournaments', () => {
    expect(parseArchiveImport(JSON.stringify({ tournaments: [] }))).toEqual({ status: 'empty-bundle' });
  });

  it('returns invalid-shape when every bundle entry fails validation', () => {
    expect(parseArchiveImport(JSON.stringify({ tournaments: [{ bad: true }] }))).toEqual({
      status: 'invalid-shape',
    });
  });

  it('returns valid with the correct invalid count for a mixed bundle', () => {
    const result = parseArchiveImport(JSON.stringify({ tournaments: [buildEntry(), { bad: true }] }));
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.isBundle).toBe(true);
      expect(result.entries).toHaveLength(1);
      expect(result.invalid).toBe(1);
    }
  });

  it('returns valid, isBundle: false for a single valid entry', () => {
    const result = parseArchiveImport(JSON.stringify(buildEntry()));
    expect(result).toMatchObject({ status: 'valid', isBundle: false, invalid: 0 });
  });

  it('returns invalid-shape for a single invalid entry', () => {
    expect(parseArchiveImport(JSON.stringify({ bad: true }))).toEqual({ status: 'invalid-shape' });
  });
});

describe('runArchiveImport', () => {
  function incrementingMintId() {
    let n = 0;
    return vi.fn((_index: ArchiveSummary[]) => {
      n += 1;
      return `new-${n}`;
    });
  }

  it('mode "skip": counts the collision, does not write, and does not update lastTitle', () => {
    const storage = createMemoryStorage();
    const existing = buildEntry({ id: '1', title: 'Existing' });
    saveArchiveEntry(storage, existing);
    saveArchiveIndex(storage, [buildArchiveSummary(existing)]);
    const counts = runArchiveImport({
      storage,
      entries: [buildEntry({ id: '1', title: 'Incoming' })],
      mode: 'skip',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts).toMatchObject({ skippedDup: 1, added: 0, overwritten: 0, lastTitle: null });
    expect(loadArchiveEntry(storage, '1')?.title).toBe('Existing');
  });

  it('mode "new": mints a distinct id for each of two same-id collisions in the same batch', () => {
    const storage = createMemoryStorage();
    const existing = buildEntry({ id: '1', title: 'Existing' });
    saveArchiveEntry(storage, existing);
    saveArchiveIndex(storage, [buildArchiveSummary(existing)]);
    const counts = runArchiveImport({
      storage,
      entries: [buildEntry({ id: '1', title: 'First' }), buildEntry({ id: '1', title: 'Second' })],
      mode: 'new',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts.added).toBe(2);
    expect(loadArchiveEntry(storage, '1')?.title).toBe('Existing');
    expect(loadArchiveEntry(storage, 'new-1')?.title).toBe('First');
    expect(loadArchiveEntry(storage, 'new-2')?.title).toBe('Second');
  });

  it('mode "overwrite": keeps the same id and replaces the entry/summary', () => {
    const storage = createMemoryStorage();
    const existing = buildEntry({ id: '1', title: 'Existing' });
    saveArchiveEntry(storage, existing);
    saveArchiveIndex(storage, [buildArchiveSummary(existing)]);
    const counts = runArchiveImport({
      storage,
      entries: [buildEntry({ id: '1', title: 'Replacement' })],
      mode: 'overwrite',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts.overwritten).toBe(1);
    expect(loadArchiveEntry(storage, '1')?.title).toBe('Replacement');
    expect(loadArchiveIndex(storage)).toHaveLength(1);
  });

  it('counts a brand-new (non-colliding) id as added', () => {
    const storage = createMemoryStorage();
    const counts = runArchiveImport({
      storage,
      entries: [buildEntry({ id: 'brand-new' })],
      mode: 'skip',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts.added).toBe(1);
  });

  it('stops the loop immediately when saveArchiveEntry throws partway through a batch', () => {
    const real = createMemoryStorage();
    const throwing = {
      getItem: real.getItem,
      removeItem: real.removeItem,
      setItem: (key: string, value: string) => {
        if (key === archiveEntryStorageKey('b')) throw new Error('quota exceeded');
        real.setItem(key, value);
      },
    };
    const counts = runArchiveImport({
      storage: throwing,
      entries: [buildEntry({ id: 'a' }), buildEntry({ id: 'b' }), buildEntry({ id: 'c' })],
      mode: 'skip',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts.added).toBe(1); // only 'a' fully succeeded before 'b' threw
    expect(counts.failed).toBe(2); // 'b' and 'c' never got a chance
    expect(loadArchiveEntry(real, 'a')).not.toBeNull();
    expect(loadArchiveEntry(real, 'b')).toBeNull();
    expect(loadArchiveEntry(real, 'c')).toBeNull();
  });

  it('silently swallows a failure saving the final index, still returning normally', () => {
    const real = createMemoryStorage();
    const throwing = {
      getItem: real.getItem,
      removeItem: real.removeItem,
      setItem: (key: string, value: string) => {
        if (key === LEGACY_ARCHIVE_INDEX_KEY) throw new Error('quota exceeded');
        real.setItem(key, value);
      },
    };
    const counts = runArchiveImport({
      storage: throwing,
      entries: [buildEntry({ id: 'a' })],
      mode: 'skip',
      now: 'now',
      mintId: incrementingMintId(),
    });
    expect(counts.added).toBe(1);
    expect(loadArchiveEntry(real, 'a')).not.toBeNull();
  });

  it('keeps an explicit null tournamentId on the snapshot rather than falling back to raw.tournamentId', () => {
    const storage = createMemoryStorage();
    const entry = buildEntry({ tournamentId: 'raw-id' });
    entry.snapshot = { ...entry.snapshot, tournamentId: null };
    runArchiveImport({ storage, entries: [entry], mode: 'skip', now: 'now', mintId: incrementingMintId() });
    expect(loadArchiveEntry(storage, entry.id)?.tournamentId).toBeNull();
  });

  it('falls back to raw.tournamentId when the snapshot tournamentId is undefined', () => {
    const storage = createMemoryStorage();
    const entry = buildEntry({ tournamentId: 'raw-id' });
    const { tournamentId: _t, ...snapshotWithoutId } = entry.snapshot as TournamentState & {
      tournamentId?: string;
    };
    entry.snapshot = snapshotWithoutId as TournamentState;
    runArchiveImport({ storage, entries: [entry], mode: 'skip', now: 'now', mintId: incrementingMintId() });
    expect(loadArchiveEntry(storage, entry.id)?.tournamentId).toBe('raw-id');
  });
});
