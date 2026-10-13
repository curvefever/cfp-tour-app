import { describe, expect, it } from 'vitest';
import {
  PRESENCE_STALE_MS,
  activeEditors,
  editingText,
  fieldOfControl,
  parsePresence,
  presenceKey,
  presenceName,
  validatePresenceInput,
  type PresenceMap,
} from './presence.shared';

const NOW = 1_000_000;

function entry(name: string, field: string, ageMs: number) {
  return { name, field, at: NOW - ageMs };
}

describe('activeEditors', () => {
  it('lists the name of another admin under the field they are in', () => {
    const presence: PresenceMap = { u2: entry('Alex', 'roster', 1000) };
    expect(activeEditors(presence, 'u1', NOW)).toEqual({ roster: ['Alex'] });
  });

  it('ignores the entry of the viewer themselves', () => {
    const presence: PresenceMap = { u1: entry('Me', 'title', 0), u2: entry('Alex', 'roster', 0) };
    expect(activeEditors(presence, 'u1', NOW)).toEqual({ roster: ['Alex'] });
  });

  it('drops an entry that is 30 seconds old or older, and keeps one just under', () => {
    const presence: PresenceMap = {
      u2: entry('Stale', 'title', PRESENCE_STALE_MS),
      u3: entry('Fresh', 'title', PRESENCE_STALE_MS - 1),
    };
    expect(activeEditors(presence, 'u1', NOW)).toEqual({ title: ['Fresh'] });
  });

  it('lists two admins in one field, in alphabetical order', () => {
    const presence: PresenceMap = { u3: entry('Sam', 'roster', 0), u2: entry('Alex', 'roster', 0) };
    expect(activeEditors(presence, 'u1', NOW)).toEqual({ roster: ['Alex', 'Sam'] });
  });

  it('keeps different fields apart', () => {
    const presence: PresenceMap = { u2: entry('Alex', 'title', 0), u3: entry('Sam', 'roster', 0) };
    expect(activeEditors(presence, 'u1', NOW)).toEqual({ title: ['Alex'], roster: ['Sam'] });
  });

  it('knows the viewer by the key their id is stored under', () => {
    const presence: PresenceMap = { a_b: entry('Me', 'title', 0) };
    expect(activeEditors(presence, 'a.b', NOW)).toEqual({});
  });

  it('is empty without entries', () => {
    expect(activeEditors({}, 'u1', NOW)).toEqual({});
  });
});

describe('parsePresence', () => {
  it('keeps well formed entries only', () => {
    const raw = {
      u1: { name: 'Alex', field: 'title', at: 5 },
      u2: { name: 'No field', at: 5 },
      u3: 'text',
      u4: null,
      u5: { name: 'Bad time', field: 'title', at: '5' },
    };
    expect(parsePresence(raw)).toEqual({ u1: { name: 'Alex', field: 'title', at: 5 } });
  });

  it('is empty for nothing stored or something that is not a map', () => {
    expect(parsePresence(null)).toEqual({});
    expect(parsePresence('x')).toEqual({});
    expect(parsePresence([{ name: 'a', field: 'b', at: 1 }])).toEqual({});
  });
});

describe('editingText', () => {
  it('names one, two and three admins', () => {
    expect(editingText(['Alex'])).toBe('Alex is editing');
    expect(editingText(['Alex', 'Sam'])).toBe('Alex and Sam are editing');
    expect(editingText(['Alex', 'Sam', 'Kim'])).toBe('Alex, Sam and Kim are editing');
  });

  it('is empty for nobody', () => {
    expect(editingText([])).toBe('');
  });
});

describe('fieldOfControl', () => {
  it('names the title, the date and the rules text', () => {
    expect(fieldOfControl('cfg-title')).toBe('title');
    expect(fieldOfControl('cfg-scheduled-at')).toBe('info.scheduledAt');
    expect(fieldOfControl('info-rules-text')).toBe('info.rulesText');
  });

  it('names a Setup control by its key in camel case', () => {
    expect(fieldOfControl('cfg-roster')).toBe('roster');
    expect(fieldOfControl('cfg-game-format')).toBe('gameFormat');
    expect(fieldOfControl('cfg-grand-final-wb-target')).toBe('grandFinalWbTarget');
  });

  it('knows no field for a control that is not a Setup key', () => {
    expect(fieldOfControl('cfg-lb-qualifiers')).toBeNull();
    expect(fieldOfControl('cfg-n-display')).toBeNull();
    expect(fieldOfControl('info-screenshot-file')).toBeNull();
    expect(fieldOfControl('')).toBeNull();
    expect(fieldOfControl(undefined)).toBeNull();
  });
});

describe('presenceKey and presenceName', () => {
  it('replaces the characters a database key refuses', () => {
    expect(presenceKey('12345')).toBe('12345');
    expect(presenceKey('a.b#c$d[e]f/g')).toBe('a_b_c_d_e_f_g');
    expect(presenceKey('')).toBe('_');
  });

  it('trims a name, shortens it and falls back when it is empty', () => {
    expect(presenceName('  Alex ')).toBe('Alex');
    expect(presenceName('x'.repeat(100))).toHaveLength(60);
    expect(presenceName('   ')).toBe('Someone');
  });
});

describe('validatePresenceInput', () => {
  it('accepts a field and null', () => {
    expect(validatePresenceInput({ tournamentId: 't1', field: 'info.rulesText' })).toEqual({
      tournamentId: 't1',
      field: 'info.rulesText',
    });
    expect(validatePresenceInput({ tournamentId: 't1', field: null })).toEqual({
      tournamentId: 't1',
      field: null,
    });
  });

  it('refuses a bad tournament id, a path-like field, a non-string field and a missing input', () => {
    expect(() => validatePresenceInput({ tournamentId: 'a/b', field: 'title' })).toThrow(
      'Invalid tournament ID',
    );
    expect(() => validatePresenceInput({ tournamentId: 't1', field: 'a/b' })).toThrow('Invalid field');
    expect(() => validatePresenceInput({ tournamentId: 't1', field: '' })).toThrow('Invalid field');
    expect(() => validatePresenceInput({ tournamentId: 't1', field: 5 as unknown as string })).toThrow(
      'Invalid field',
    );
    expect(() => validatePresenceInput(null as unknown as { tournamentId: string; field: null })).toThrow(
      'Invalid presence',
    );
  });
});
