/** What the screenshots' and the settings pictures' controls tell the organiser when an upload cannot go ahead. */
export const NO_IMAGE_MESSAGE = 'The clipboard holds no image: copy a screenshot first.';
export const CLIPBOARD_REFUSED_MESSAGE =
  'The browser did not let the page read the clipboard: press Ctrl+V instead.';

export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}
