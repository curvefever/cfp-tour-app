/** The images among pasted or copied files; anything else (text, a PDF) is left out. */
export function imageFiles(files: File[]): File[] {
  return files.filter((file) => file.type.startsWith('image/'));
}

/**
 * The images the clipboard holds, read by a button (the browser may ask the organiser first). Null when this browser
 * can't read images from the clipboard on a click; Ctrl+V still works there.
 */
export async function readClipboardImages(clipboard: Clipboard | undefined): Promise<File[] | null> {
  if (!clipboard?.read) return null;
  const files: File[] = [];
  for (const item of await clipboard.read()) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'));
    if (type) files.push(new File([await item.getType(type)], 'pasted-screenshot', { type }));
  }
  return files;
}
