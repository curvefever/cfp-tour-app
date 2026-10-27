import { describe, expect, it } from 'vitest';
import { imageFiles, readClipboardImages } from './clipboard-images';

const file = (type: string) => new File(['x'], 'f', { type });

function clipboardWith(types: string[][]): Clipboard {
  const items = types.map((itemTypes) => ({
    types: itemTypes,
    getType: (type: string) => Promise.resolve(new Blob(['x'], { type })),
  }));
  return { read: () => Promise.resolve(items) } as unknown as Clipboard;
}

describe('imageFiles', () => {
  it('keeps only the images', () => {
    const kept = imageFiles([
      file('image/png'),
      file('text/plain'),
      file('image/jpeg'),
      file('application/pdf'),
    ]);
    expect(kept.map((entry) => entry.type)).toEqual(['image/png', 'image/jpeg']);
  });
});

describe('readClipboardImages', () => {
  it('returns one file per clipboard item that holds an image', async () => {
    const files = await readClipboardImages(clipboardWith([['text/html', 'image/png'], ['text/plain']]));
    expect(files?.map((entry) => entry.type)).toEqual(['image/png']);
  });

  it('returns an empty list when the clipboard holds no image', async () => {
    expect(await readClipboardImages(clipboardWith([['text/plain']]))).toEqual([]);
  });

  it('returns null when the browser cannot read the clipboard', async () => {
    expect(await readClipboardImages(undefined)).toBeNull();
    expect(await readClipboardImages({} as Clipboard)).toBeNull();
  });
});
