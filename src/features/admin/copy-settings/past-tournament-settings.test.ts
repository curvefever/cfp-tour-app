import { describe, expect, it } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../../domain/tournament/state-defaults';
import { settingsFromForm } from '../../../domain/tournament/tournament-settings';
import { createMemoryStorage } from '../../../lib/persistence/test-fixtures';
import { writeArchiveSnapshot } from '../../../lib/persistence/archive';
import {
  archiveEntriesWithSettings,
  parseTournamentReference,
  settingsFromSnapshot,
} from './past-tournament-settings';

describe('parseTournamentReference', () => {
  it('accepts a bare id', () => {
    expect(parseTournamentReference('abc123')).toBe('abc123');
  });

  it('accepts a full test-site link with ?t=', () => {
    expect(parseTournamentReference('https://tournaments-test.curvefever.pro/?t=abc123')).toBe('abc123');
  });

  it('accepts a link with other params around t', () => {
    expect(parseTournamentReference('https://tournaments-test.curvefever.pro/?a=1&t=abc123&b=2')).toBe(
      'abc123',
    );
  });

  it('trims whitespace', () => {
    expect(parseTournamentReference('  abc123  ')).toBe('abc123');
  });

  it('rejects an empty string', () => {
    expect(parseTournamentReference('')).toBeNull();
    expect(parseTournamentReference('   ')).toBeNull();
  });

  it('rejects a link without a t param', () => {
    expect(parseTournamentReference('https://tournaments-test.curvefever.pro/')).toBeNull();
  });

  it('rejects an id with illegal characters', () => {
    expect(parseTournamentReference('abc/123')).toBeNull();
    expect(parseTournamentReference('abc 123')).toBeNull();
  });

  it('rejects a 129-character id', () => {
    expect(parseTournamentReference('a'.repeat(129))).toBeNull();
  });
});

describe('settingsFromSnapshot', () => {
  it('reports not-found for null', () => {
    expect(settingsFromSnapshot(null)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('reports no-settings for a state without a settings field', () => {
    const raw = { title: 'My Tournament' };
    expect(settingsFromSnapshot(raw)).toEqual({ ok: false, reason: 'no-settings' });
  });

  it('reports ok with settings and a blank-title fallback', () => {
    const settings = settingsFromForm(createDefaultSetup());
    const raw = { title: '  ', settings };
    const result = settingsFromSnapshot(raw);
    expect(result).toEqual({ ok: true, settings, title: 'Unnamed Tournament' });
  });

  it('reports ok with the real title when present', () => {
    const settings = settingsFromForm(createDefaultSetup());
    const raw = { title: 'My Tournament', settings };
    expect(settingsFromSnapshot(raw)).toEqual({ ok: true, settings, title: 'My Tournament' });
  });
});

describe('archiveEntriesWithSettings', () => {
  it('keeps only entries with readable settings, newest first', () => {
    const storage = createMemoryStorage();
    const withSettings = createDefaultTournamentState({
      title: 'With Settings',
      settings: settingsFromForm(createDefaultSetup()),
    });
    const withoutSettings = createDefaultTournamentState({ title: 'Without Settings' });
    // Written oldest-first, so the saved (index) order is the reverse of
    // the expected date order -- catches a missing/wrong sort, which a
    // coincidentally already-sorted write order would let pass silently.
    writeArchiveSnapshot({
      storage,
      state: { ...withSettings, title: 'Older With Settings' },
      id: 'older',
      dateSaved: '2026-01-01T00:00:00.000Z',
    });
    writeArchiveSnapshot({
      storage,
      state: withoutSettings,
      id: 'newer-no-settings',
      dateSaved: '2026-01-15T00:00:00.000Z',
    });
    writeArchiveSnapshot({
      storage,
      state: withSettings,
      id: 'newer',
      dateSaved: '2026-02-01T00:00:00.000Z',
    });

    expect(archiveEntriesWithSettings(storage)).toEqual([
      { id: 'newer', title: 'With Settings', dateSaved: '2026-02-01T00:00:00.000Z' },
      { id: 'older', title: 'Older With Settings', dateSaved: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});
