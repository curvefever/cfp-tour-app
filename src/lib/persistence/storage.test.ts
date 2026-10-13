import { describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import {
  EXITED_KEY,
  LAST_VIEW_KEY,
  LEGACY_BRACKET_FOLLOW_KEY,
  LEGACY_LAST_TAB_KEY,
  LEGACY_LIVE_STATE_KEY,
} from './storage-keys';
import { createMemoryStorage } from './test-fixtures';
import {
  clearLiveEnvelope,
  loadLiveEnvelope,
  readBracketFollow,
  readExited,
  readLastView,
  saveBracketFollow,
  saveExited,
  saveLastView,
  saveLiveEnvelope,
} from './storage';

const fixedIds = { tournamentId: vi.fn(() => 'minted-id') };
const envelope = {
  T: createDefaultTournamentState(),
  setup: createDefaultSetup(),
  activeTab: 'bracket' as const,
};

describe('loadLiveEnvelope', () => {
  it('reports empty when nothing is stored', () => {
    const storage = createMemoryStorage();
    expect(loadLiveEnvelope(storage, fixedIds)).toEqual({ status: 'empty' });
  });

  it('loads and parses a valid stored envelope', () => {
    const storage = createMemoryStorage({ [LEGACY_LIVE_STATE_KEY]: JSON.stringify(envelope) });
    const result = loadLiveEnvelope(storage, fixedIds);
    expect(result.status).toBe('loaded');
    if (result.status === 'loaded') expect(result.envelope.activeTab).toBe('bracket');
  });

  it('reports invalid for corrupted stored JSON', () => {
    const storage = createMemoryStorage({ [LEGACY_LIVE_STATE_KEY]: 'not json' });
    const result = loadLiveEnvelope(storage, fixedIds);
    expect(result.status).toBe('invalid');
  });

  it('reports invalid when getItem itself throws', () => {
    const storage = createMemoryStorage();
    storage.getItem = () => {
      throw new Error('storage unavailable');
    };
    const result = loadLiveEnvelope(storage, fixedIds);
    expect(result.status).toBe('invalid');
  });
});

describe('saveLiveEnvelope', () => {
  it('skips writing entirely for a viewer', () => {
    const storage = createMemoryStorage();
    storage.setItem = vi.fn();
    const result = saveLiveEnvelope(storage, envelope, { isViewer: true });
    expect(result).toEqual({ status: 'skipped-viewer' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('saves for a non-viewer', () => {
    const storage = createMemoryStorage();
    const result = saveLiveEnvelope(storage, envelope, { isViewer: false });
    expect(result).toEqual({ status: 'saved' });
    expect(storage.getItem(LEGACY_LIVE_STATE_KEY)).toBe(JSON.stringify(envelope));
  });

  it('reports failed when setItem throws', () => {
    const storage = createMemoryStorage();
    storage.setItem = () => {
      throw new Error('quota exceeded');
    };
    const result = saveLiveEnvelope(storage, envelope, { isViewer: false });
    expect(result.status).toBe('failed');
  });
});

describe('clearLiveEnvelope / readBracketFollow / saveBracketFollow', () => {
  it('clears the stored live envelope', () => {
    const storage = createMemoryStorage({ [LEGACY_LIVE_STATE_KEY]: 'x' });
    clearLiveEnvelope(storage);
    expect(storage.getItem(LEGACY_LIVE_STATE_KEY)).toBeNull();
  });

  it('reads a stored bracket-follow unit key', () => {
    const storage = createMemoryStorage({ [LEGACY_BRACKET_FOLLOW_KEY]: 'P1' });
    expect(readBracketFollow(storage)).toBe('P1');
  });

  it('saves a bracket-follow unit key', () => {
    const storage = createMemoryStorage();
    saveBracketFollow(storage, 'P2');
    expect(storage.getItem(LEGACY_BRACKET_FOLLOW_KEY)).toBe('P2');
  });

  it('removes the bracket-follow key when saved with null', () => {
    const storage = createMemoryStorage({ [LEGACY_BRACKET_FOLLOW_KEY]: 'P1' });
    saveBracketFollow(storage, null);
    expect(storage.getItem(LEGACY_BRACKET_FOLLOW_KEY)).toBeNull();
  });
});

describe('readLastView / saveLastView', () => {
  it('has no memory when nothing is stored', () => {
    expect(readLastView(createMemoryStorage())).toBeNull();
  });

  it('round-trips a tab together with its tournament', () => {
    const storage = createMemoryStorage();
    saveLastView(storage, { tournamentId: 't1', tab: 'rankings' });
    expect(JSON.parse(storage.getItem(LAST_VIEW_KEY)!)).toEqual({ tournamentId: 't1', tab: 'rankings' });
    expect(readLastView(storage)).toEqual({ tournamentId: 't1', tab: 'rankings' });
  });

  it('reads the old tab-only memory once, for any tournament, and the first save removes it', () => {
    const storage = createMemoryStorage({ [LEGACY_LAST_TAB_KEY]: 'rankings' });
    expect(readLastView(storage)).toEqual({ tournamentId: null, tab: 'rankings' });
    saveLastView(storage, { tournamentId: 't1', tab: 'info' });
    expect(storage.getItem(LEGACY_LAST_TAB_KEY)).toBeNull();
    expect(readLastView(storage)).toEqual({ tournamentId: 't1', tab: 'info' });
  });

  it('uses the old memory only when it is a tab of a tournament', () => {
    for (const tab of ['info', 'bracket', 'standings', 'rankings']) {
      expect(readLastView(createMemoryStorage({ [LEGACY_LAST_TAB_KEY]: tab }))).toEqual({
        tournamentId: null,
        tab,
      });
    }
    expect(readLastView(createMemoryStorage({ [LEGACY_LAST_TAB_KEY]: 'scoreboard' }))?.tab).toBe('standings');
  });

  it('counts the retired Home and Archive tabs, Admin and unknown values of the old memory as no memory', () => {
    for (const tab of ['home', 'archive', 'admin', 'tournaments', 'nonsense']) {
      expect(readLastView(createMemoryStorage({ [LEGACY_LAST_TAB_KEY]: tab }))).toBeNull();
    }
  });

  it('treats an unknown stored tab like normalizeActiveTab does', () => {
    const storage = createMemoryStorage({
      [LAST_VIEW_KEY]: JSON.stringify({ tournamentId: 't1', tab: 'nonsense' }),
    });
    expect(readLastView(storage)).toEqual({ tournamentId: 't1', tab: 'bracket' });
  });

  it('ignores unreadable memory, and does not fall back to the old tab then', () => {
    expect(readLastView(createMemoryStorage({ [LAST_VIEW_KEY]: 'not json' }))).toBeNull();
    expect(readLastView(createMemoryStorage({ [LAST_VIEW_KEY]: '{"tab":"info"}' }))).toBeNull();
    const both = createMemoryStorage({ [LAST_VIEW_KEY]: 'not json', [LEGACY_LAST_TAB_KEY]: 'rankings' });
    expect(readLastView(both)).toBeNull();
  });
});

describe('readExited / saveExited', () => {
  it('has no exited tournament until one is saved', () => {
    expect(readExited(createMemoryStorage())).toBeNull();
  });

  it('round-trips an id with the phase it was in, and forgets it when saved with null', () => {
    const storage = createMemoryStorage();
    saveExited(storage, { tournamentId: 't1', phase: 'starting-soon' });
    expect(JSON.parse(storage.getItem(EXITED_KEY)!)).toEqual({ tournamentId: 't1', phase: 'starting-soon' });
    expect(readExited(storage)).toEqual({ tournamentId: 't1', phase: 'starting-soon' });
    saveExited(storage, null);
    expect(readExited(storage)).toBeNull();
  });

  it('reads the old plain id, numeric or not, as exited while ongoing', () => {
    expect(readExited(createMemoryStorage({ [EXITED_KEY]: 'abc-123' }))).toEqual({
      tournamentId: 'abc-123',
      phase: 'ongoing',
    });
    expect(readExited(createMemoryStorage({ [EXITED_KEY]: '1791894089967' }))).toEqual({
      tournamentId: '1791894089967',
      phase: 'ongoing',
    });
  });

  it('ignores a stored object that is not a tournament and a phase', () => {
    expect(
      readExited(createMemoryStorage({ [EXITED_KEY]: '{"tournamentId":"t1","phase":"nope"}' })),
    ).toBeNull();
    expect(readExited(createMemoryStorage({ [EXITED_KEY]: '{"phase":"ongoing"}' }))).toBeNull();
  });
});
