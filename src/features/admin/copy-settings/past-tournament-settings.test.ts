import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import { settingsFromForm } from '../../../domain/tournament/tournament-settings';
import type { SharedArchiveSummary } from '../../archive/shared-archive';
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
  const summary = (tournamentId: string, dateSaved: string, hasSettings: boolean): SharedArchiveSummary => ({
    tournamentId,
    title: tournamentId,
    dateSaved,
    playerCount: 31,
    roundsPlayed: 3,
    hasSettings,
  });

  it('keeps only entries with saved settings, newest first', () => {
    // Given oldest-first, so a missing or wrong sort can't pass by coincidence.
    const entries = [
      summary('older', '2026-01-01T00:00:00.000Z', true),
      summary('newer-no-settings', '2026-01-15T00:00:00.000Z', false),
      summary('newer', '2026-02-01T00:00:00.000Z', true),
    ];
    expect(archiveEntriesWithSettings(entries).map((entry) => entry.tournamentId)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('returns an empty list when no entry has settings', () => {
    expect(archiveEntriesWithSettings([summary('a', '2026-01-01', false)])).toEqual([]);
  });
});
