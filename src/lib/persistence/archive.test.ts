import { describe, expect, it } from 'vitest';
import { createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { archiveEntryStorageKey, LEGACY_ARCHIVE_INDEX_KEY } from './storage-keys';
import { createMemoryStorage } from './test-fixtures';
import { archiveBundle, loadArchiveEntry, loadArchiveIndex, type ArchiveEntry } from './archive';

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

function seed(entries: ArchiveEntry[], broken: string[] = []) {
  const storage = createMemoryStorage();
  const index = [...entries.map((entry) => ({ id: entry.id })), ...broken.map((id) => ({ id }))];
  storage.setItem(LEGACY_ARCHIVE_INDEX_KEY, JSON.stringify(index));
  for (const entry of entries) storage.setItem(archiveEntryStorageKey(entry.id), JSON.stringify(entry));
  for (const id of broken) storage.setItem(archiveEntryStorageKey(id), 'not json');
  return storage;
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

  it('reads back a stored entry', () => {
    const entry = buildEntry();
    expect(loadArchiveEntry(seed([entry]), '1')).toEqual(entry);
  });
});

describe('archiveBundle', () => {
  it('builds a bundle from every index summary', () => {
    const bundle = archiveBundle(seed([buildEntry({ id: '1' }), buildEntry({ id: '2' })]), 'now');
    expect(bundle.exportedAt).toBe('now');
    expect(bundle.tournaments.map((t) => t.id)).toEqual(['1', '2']);
  });

  it('silently drops an index entry whose stored JSON is corrupted, rather than throwing', () => {
    const bundle = archiveBundle(seed([buildEntry({ id: '1' })], ['2']), 'now');
    expect(bundle.tournaments.map((t) => t.id)).toEqual(['1']);
  });
});
