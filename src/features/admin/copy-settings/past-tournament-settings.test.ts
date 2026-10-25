import { describe, expect, it } from 'vitest';
import { createDefaultSetup } from '../../../domain/tournament/state-defaults';
import { settingsFromForm } from '../../../domain/tournament/tournament-settings';
import { parseTournamentReference, settingsFromSnapshot } from './past-tournament-settings';

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
    expect(result).toEqual({
      ok: true,
      settings,
      title: 'Unnamed Tournament',
      rulesText: '',
      screenshotCount: 0,
    });
  });

  it('reports ok with the real title when present', () => {
    const settings = settingsFromForm(createDefaultSetup());
    const raw = { title: 'My Tournament', settings };
    expect(settingsFromSnapshot(raw)).toEqual({
      ok: true,
      settings,
      title: 'My Tournament',
      rulesText: '',
      screenshotCount: 0,
    });
  });
});

describe('settingsFromSnapshot with a stored Setup form', () => {
  it('uses the stored Setup form, with the losers-bracket qualifiers of the snapshot', () => {
    const snapshot = settingsFromForm({ ...createDefaultSetup(), lbQualifiers: '3' });
    const setup = createDefaultSetup({ qualAdv: '16', roster: 'A B' });
    const result = settingsFromSnapshot({ title: 'Cup', settings: snapshot }, setup);
    expect(result).toMatchObject({
      ok: true,
      settings: settingsFromForm({ ...setup, lbQualifiers: '3' }),
      title: 'Cup',
    });
  });

  it('copies a tournament that was never generated, which has a Setup form but no snapshot', () => {
    const setup = createDefaultSetup({ poolingPhase: 'qual-table' });
    const result = settingsFromSnapshot({ title: 'Draft' }, setup);
    expect(result).toMatchObject({ ok: true, settings: settingsFromForm(setup), title: 'Draft' });
  });

  it('falls back to the snapshot when the Setup form is missing', () => {
    const settings = settingsFromForm(createDefaultSetup({ qualAdv: '12' }));
    expect(settingsFromSnapshot({ title: 'Old', settings }, null)).toMatchObject({
      ok: true,
      settings,
      title: 'Old',
    });
  });

  it('is not found when the tournament itself is missing', () => {
    expect(settingsFromSnapshot(null, createDefaultSetup())).toEqual({ ok: false, reason: 'not-found' });
  });
});

describe('settingsFromSnapshot with info for visitors', () => {
  it('carries the rules text and the number of screenshots of the source', () => {
    const settings = settingsFromForm(createDefaultSetup());
    const raw = {
      title: 'Cup',
      settings,
      info: {
        scheduledAt: 1,
        rulesText: 'No pause.\n- Be on time',
        screenshots: ['image00000001', 'image00000002'],
      },
    };
    expect(settingsFromSnapshot(raw)).toMatchObject({
      ok: true,
      rulesText: 'No pause.\n- Be on time',
      screenshotCount: 2,
    });
  });

  it('has no rules text and no screenshots for a tournament without an info block', () => {
    const raw = { title: 'Old', settings: settingsFromForm(createDefaultSetup()) };
    expect(settingsFromSnapshot(raw)).toMatchObject({ ok: true, rulesText: '', screenshotCount: 0 });
  });
});

describe('settingsFromSnapshot with round settings notes', () => {
  const rawWith = (roundNotes: unknown) => ({
    title: 'Cup',
    settings: settingsFromForm(createDefaultSetup()),
    info: { rulesText: '', roundNotes },
  });
  const notesOf = (raw: unknown) => {
    const result = settingsFromSnapshot(raw);
    return result.ok ? result.roundNotes : 'not ok';
  };

  it('carries the notes of the source, by round name', () => {
    const roundNotes = { 'Round 1': 'Powers: Ghost', 'WB Round 3': 'Target score: high', Final: 'x' };
    expect(notesOf(rawWith(roundNotes))).toEqual(roundNotes);
  });

  it('drops malformed entries: keys Firebase cannot store, long names, blank and non-string values', () => {
    expect(
      notesOf(
        rawWith({
          'Round 1': ' a ',
          'bad/name': 'x',
          'bad.name': 'x',
          [`${'N'.repeat(61)}`]: 'x',
          [`${'N'.repeat(60)}`]: 'long but fine',
          Blank: '   ',
          Count: 5,
          List: ['x'],
          stages: { pooling: 'old shape' },
        }),
      ),
    ).toEqual({ 'Round 1': 'a', [`${'N'.repeat(60)}`]: 'long but fine' });
  });

  it('gives no notes when none survive or the source has none', () => {
    expect(notesOf(rawWith({ Blank: '', stages: { pooling: 'x' } }))).toBeUndefined();
    expect(notesOf({ title: 'Old', settings: settingsFromForm(createDefaultSetup()) })).toBeUndefined();
    expect(notesOf(rawWith('text'))).toBeUndefined();
    expect(notesOf(rawWith(['x']))).toBeUndefined();
  });
});
