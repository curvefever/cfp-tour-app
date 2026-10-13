/** The longest side of a stored screenshot, in pixels. */
export const MAX_SIDE = 1600;

/** What a shrunk screenshot should weigh at most, well below what the server accepts. */
export const TARGET_BYTES = 300 * 1024;

/** WebP qualities tried from the best down, and the scales tried when even the lowest is too heavy. */
export const QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5, 0.4] as const;
export const SCALE_STEPS = [1, 0.75, 0.5] as const;

/** The size an image gets so that its longest side is at most `maxSide`; a smaller image keeps its size. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const factor = maxSide / longest;
  return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

/** Shrinks an image file in the browser to a WebP data URL: longest side 1600 px, under 300 KB. */
export async function shrinkImageFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This file is not an image the browser can read.');
  });
  const fitted = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser cannot shrink images.');
  for (const scale of SCALE_STEPS) {
    canvas.width = Math.max(1, Math.round(fitted.width * scale));
    canvas.height = Math.max(1, Math.round(fitted.height * scale));
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, quality);
      if (blob && blob.type === 'image/webp' && blob.size <= TARGET_BYTES) return readAsDataUrl(blob);
    }
  }
  throw new Error('This image is too detailed to shrink small enough. Try a smaller screenshot.');
}
