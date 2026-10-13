import { describe, expect, it } from 'vitest';
import { marshalForFirebase } from '../sync/firebase-marshal';
import {
  decodedBase64Size,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOTS,
  screenshotIdsOf,
  validateCopyInput,
  validateImageInput,
  validateUploadInput,
  withScreenshotRemoved,
  withScreenshotsAdded,
} from './screenshots.shared';

const dataUrl = (mime: string, bytes: number) => {
  // 4 base64 characters decode to 3 bytes.
  const chars = 'A'.repeat(Math.ceil((bytes * 4) / 3 / 4) * 4);
  return `data:${mime};base64,${chars}`;
};

describe('decodedBase64Size', () => {
  it('counts the bytes a base64 text decodes to, padding included', () => {
    expect(decodedBase64Size('AAAA')).toBe(3);
    expect(decodedBase64Size('AAA=')).toBe(2);
    expect(decodedBase64Size('AA==')).toBe(1);
  });
});

describe('validateUploadInput', () => {
  it('accepts a WebP, PNG or JPEG data URL for a tournament', () => {
    for (const mime of ['image/webp', 'image/png', 'image/jpeg']) {
      const input = { tournamentId: ' t1 ', dataUrl: dataUrl(mime, 1000) };
      expect(validateUploadInput(input)).toEqual({ tournamentId: 't1', dataUrl: input.dataUrl });
    }
  });

  it('refuses another type of image, or anything that is not a base64 data URL', () => {
    for (const bad of [
      dataUrl('image/gif', 100),
      dataUrl('image/svg+xml', 100),
      dataUrl('text/html', 100),
      'data:image/png;base64,not base64!',
      'https://example.com/a.png',
      'javascript:alert(1)',
      '',
    ]) {
      expect(() => validateUploadInput({ tournamentId: 't1', dataUrl: bad })).toThrow(
        'must be a WebP, PNG or JPEG image',
      );
    }
    expect(() => validateUploadInput({ tournamentId: 't1', dataUrl: 5 as never })).toThrow(
      'WebP, PNG or JPEG',
    );
  });

  it('allows an image of exactly the size limit and refuses one byte over it', () => {
    expect(MAX_SCREENSHOT_BYTES).toBe(400 * 1024);
    const atLimit = 'data:image/webp;base64,' + 'A'.repeat((MAX_SCREENSHOT_BYTES / 3) * 4);
    expect(() => validateUploadInput({ tournamentId: 't1', dataUrl: atLimit })).not.toThrow();
    const over = 'data:image/webp;base64,' + 'A'.repeat((MAX_SCREENSHOT_BYTES / 3) * 4 + 4);
    expect(() => validateUploadInput({ tournamentId: 't1', dataUrl: over })).toThrow('too large');
  });

  it('refuses an empty image and a bad tournament id', () => {
    expect(() => validateUploadInput({ tournamentId: 't1', dataUrl: 'data:image/png;base64,' })).toThrow(
      'WebP, PNG or JPEG',
    );
    expect(() => validateUploadInput({ tournamentId: 'a/b', dataUrl: dataUrl('image/png', 100) })).toThrow(
      'Invalid tournament ID.',
    );
    expect(() => validateUploadInput(null as never)).toThrow('Invalid screenshot.');
  });
});

describe('validateImageInput and validateCopyInput', () => {
  it('accepts an alphanumeric image id and refuses one that could leave the media path', () => {
    expect(validateImageInput({ tournamentId: 't1', imageId: 'a1b2c3d4e5f6a7b8' })).toEqual({
      tournamentId: 't1',
      imageId: 'a1b2c3d4e5f6a7b8',
    });
    for (const imageId of ['', 'short', '../other/12345678', 'a1b2c3d4/e5f6', 'x'.repeat(33)]) {
      expect(() => validateImageInput({ tournamentId: 't1', imageId })).toThrow('Invalid screenshot ID.');
    }
  });

  it('needs two different, valid tournament ids to copy between', () => {
    expect(validateCopyInput({ fromTournamentId: 'a', toTournamentId: 'b' })).toEqual({
      fromTournamentId: 'a',
      toTournamentId: 'b',
    });
    expect(() => validateCopyInput({ fromTournamentId: 'a', toTournamentId: 'a' })).toThrow('onto itself');
    expect(() => validateCopyInput({ fromTournamentId: 'a/b', toTournamentId: 'b' })).toThrow(
      'Invalid tournament ID.',
    );
  });
});

describe('the stored screenshot list', () => {
  const id = (n: number) => `image${String(n).padStart(8, '0')}`;

  it('reads the ids from a stored list, an empty marker or nothing', () => {
    expect(screenshotIdsOf(marshalForFirebase([id(1), id(2)]))).toEqual([id(1), id(2)]);
    expect(screenshotIdsOf(marshalForFirebase([]))).toEqual([]);
    expect(screenshotIdsOf(null)).toEqual([]);
    expect(screenshotIdsOf({ not: 'a list' })).toEqual([]);
  });

  it('ignores entries that are not ids', () => {
    expect(screenshotIdsOf([id(1), 5, null, '../x'])).toEqual([id(1)]);
  });

  it('adds an id to the end, from an empty list or from nothing', () => {
    expect(withScreenshotsAdded(marshalForFirebase([]), [id(1)])).toEqual([id(1)]);
    expect(withScreenshotsAdded(null, [id(1)])).toEqual([id(1)]);
    expect(withScreenshotsAdded([id(1)], [id(2)])).toEqual([id(1), id(2)]);
  });

  it('refuses, by returning undefined, to go over the limit', () => {
    expect(MAX_SCREENSHOTS).toBe(4);
    const four = [id(1), id(2), id(3), id(4)];
    expect(withScreenshotsAdded(four, [id(5)])).toBeUndefined();
    expect(withScreenshotsAdded([id(1), id(2), id(3)], [id(4)])).toEqual(four);
    expect(withScreenshotsAdded([id(1), id(2), id(3)], [id(4), id(5)])).toBeUndefined();
  });

  it('removes an id, leaving an empty marker for the last one', () => {
    expect(withScreenshotRemoved([id(1), id(2)], id(1))).toEqual([id(2)]);
    expect(withScreenshotRemoved([id(1)], id(1))).toEqual(marshalForFirebase([]));
    expect(withScreenshotRemoved([id(1)], id(9))).toEqual([id(1)]);
  });
});
