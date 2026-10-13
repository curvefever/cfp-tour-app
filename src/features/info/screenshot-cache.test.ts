import { describe, expect, it } from 'vitest';
import { createMemoryStorage } from '../../lib/persistence/test-fixtures';
import { cacheScreenshot, readCachedScreenshot } from './screenshot-cache';

describe('screenshot cache', () => {
  it('returns what was cached under an id, and nothing for another id', () => {
    const storage = createMemoryStorage();
    cacheScreenshot(storage, 'image0001', 'data:image/webp;base64,AAAA');
    expect(readCachedScreenshot(storage, 'image0001')).toBe('data:image/webp;base64,AAAA');
    expect(readCachedScreenshot(storage, 'image0002')).toBeNull();
  });

  it('does not fail when the storage is full', () => {
    const storage = createMemoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => cacheScreenshot(storage, 'image0001', 'data')).not.toThrow();
    expect(readCachedScreenshot(storage, 'image0001')).toBeNull();
  });

  it('does not fail when the storage cannot be read', () => {
    const storage = createMemoryStorage();
    storage.getItem = () => {
      throw new Error('blocked');
    };
    expect(readCachedScreenshot(storage, 'image0001')).toBeNull();
  });
});
