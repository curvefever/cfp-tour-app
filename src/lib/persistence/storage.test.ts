import { describe, expect, it, vi } from 'vitest';
import { createDefaultSetup, createDefaultTournamentState } from '../../domain/tournament/state-defaults';
import { LEGACY_BRACKET_FOLLOW_KEY, LEGACY_LIVE_STATE_KEY } from './storage-keys';
import { createMemoryStorage } from './test-fixtures';
import {
  clearLiveEnvelope,
  loadLiveEnvelope,
  readBracketFollow,
  saveBracketFollow,
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
