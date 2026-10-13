import { describe, expect, it } from 'vitest';
import {
  CUTOFF_MS,
  classify,
  idTimestamp,
  inspectRoot,
  parseArgs,
  pathsToDelete,
  storedTimestamp,
} from './cleanup-2026-10-13.mjs';

const BEFORE = Date.UTC(2026, 9, 13, 23, 59, 59);
const AFTER = Date.UTC(2026, 9, 14, 0, 0, 0);

describe('the cutoff', () => {
  it('is the start of 2026-10-14 UTC', () => {
    expect(new Date(CUTOFF_MS).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('idTimestamp', () => {
  it('reads a 13-digit id as milliseconds and nothing else', () => {
    expect(idTimestamp('1791894089967')).toBe(1791894089967);
    expect(idTimestamp('abc123')).toBeNull();
    expect(idTimestamp('179189408996')).toBeNull();
    expect(idTimestamp('17918940899670')).toBeNull();
    expect(idTimestamp('17918940899x7')).toBeNull();
  });
});

describe('storedTimestamp', () => {
  it('reads a number or an ISO text, and nothing else', () => {
    expect(storedTimestamp(5)).toBe(5);
    expect(storedTimestamp('2026-10-13T10:00:00.000Z')).toBe(Date.UTC(2026, 9, 13, 10));
    expect(storedTimestamp('not a date')).toBeNull();
    expect(storedTimestamp(0)).toBeNull();
    expect(storedTimestamp(undefined)).toBeNull();
  });
});

describe('classify', () => {
  it('deletes an id up to the last second of 2026-10-13 and keeps one from 2026-10-14', () => {
    expect(classify(String(BEFORE), null).verdict).toBe('delete');
    expect(classify(String(AFTER), null).verdict).toBe('keep');
  });

  it('never deletes an id that is no timestamp', () => {
    expect(classify('legacy-id', BEFORE).verdict).toBe('unknown');
    expect(classify('', null).verdict).toBe('unknown');
  });

  it('deletes when the stored date agrees with the id', () => {
    expect(classify(String(BEFORE), BEFORE - 1000)).toMatchObject({ verdict: 'delete', note: '' });
  });

  it('keeps and reports an id and a stored date on different sides of the cutoff', () => {
    expect(classify(String(BEFORE), AFTER + 1000).verdict).toBe('conflict');
    expect(classify(String(AFTER), BEFORE - 1000).verdict).toBe('conflict');
  });

  it('reports, but still deletes, a stored date more than a day away on the same side', () => {
    const result = classify(String(BEFORE), BEFORE - 3 * 24 * 60 * 60 * 1000);
    expect(result.verdict).toBe('delete');
    expect(result.note).toMatch(/more than a day/);
  });
});

describe('pathsToDelete', () => {
  it('clears the tournament and everything kept beside it', () => {
    expect(pathsToDelete('tournaments', 'test', '1')).toEqual([
      'environments/test/tournaments/1',
      'environments/test/index/1',
      'environments/test/setups/1',
      'environments/test/presence/1',
      'environments/test/media/1',
    ]);
  });

  it('clears an archive entry and its list entry only', () => {
    expect(pathsToDelete('archive', 'prod', '1')).toEqual([
      'environments/prod/archive/index/1',
      'environments/prod/archive/entries/1',
    ]);
  });

  it('clears one tournament of the legacy root', () => {
    expect(pathsToDelete('legacy', 'prod', '1')).toEqual(['tournaments/1']);
  });
});

describe('parseArgs', () => {
  it('is a dry run unless --apply is given, and needs one environment', () => {
    expect(parseArgs(['--env', 'test'])).toEqual({ env: 'test', apply: false });
    expect(parseArgs(['--env', 'prod', '--apply'])).toEqual({ env: 'prod', apply: true });
    expect(() => parseArgs([])).toThrow('--env');
    expect(() => parseArgs(['--apply'])).toThrow('--env');
    expect(() => parseArgs(['--env', 'staging'])).toThrow('--env');
    expect(() => parseArgs(['--env', 'test', '--force'])).toThrow('Unknown argument');
  });
});

describe('inspectRoot', () => {
  const OLD = String(BEFORE);
  const NEW = String(AFTER);
  const stored = {
    'environments/test/tournaments': {
      [OLD]: { title: 'Old cup', lifecycle: { createdAt: BEFORE } },
      [NEW]: { title: 'New cup', lifecycle: { createdAt: AFTER } },
      '1791894089967x': { title: 'Odd id' },
      1700000000000: { title: 'Contradicted', lifecycle: { createdAt: AFTER + 5000 } },
    },
    'environments/test/setups': { [OLD]: { roster: 'a b' } },
    'environments/test/media': { [OLD]: { img00000001: 'data' } },
  };
  const database = {
    childIds: async (path) => Object.keys(stored[path] ?? {}).sort(),
    read: async (path) => {
      const [root, id] = [path.split('/').slice(0, 3).join('/'), path.split('/')[3]];
      return id === undefined ? (stored[root] ?? null) : (stored[root]?.[id] ?? null);
    },
  };

  it('gives each tournament a verdict, its title and its size with the setup and media kept beside it', async () => {
    const rows = await inspectRoot(database, 'tournaments', 'test');
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[OLD]).toMatchObject({ verdict: 'delete', title: 'Old cup' });
    expect(byId[OLD].size).toBeGreaterThan(
      JSON.stringify(stored['environments/test/tournaments'][OLD]).length,
    );
    expect(byId[NEW]).toMatchObject({ verdict: 'keep', title: 'New cup' });
    expect(byId['1791894089967x']).toMatchObject({ verdict: 'unknown', title: 'Odd id' });
    expect(byId['1700000000000']).toMatchObject({ verdict: 'conflict' });
  });
});
