import type { BrowserStorage } from '../../lib/persistence/storage';

const PREFIX = 'curveFFA_img_';

/**
 * A screenshot never changes under its id, so a browser keeps what it has read. Best effort: a full or unavailable
 * storage just means the next visit reads the image again.
 */
export function readCachedScreenshot(storage: BrowserStorage, imageId: string): string | null {
  try {
    return storage.getItem(`${PREFIX}${imageId}`);
  } catch {
    return null;
  }
}

export function cacheScreenshot(storage: BrowserStorage, imageId: string, dataUrl: string): void {
  try {
    storage.setItem(`${PREFIX}${imageId}`, dataUrl);
  } catch {
    // Storage full or blocked: the image is simply not cached.
  }
}
