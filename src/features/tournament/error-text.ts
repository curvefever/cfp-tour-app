/** The message of a failed server call, as the callers hand it to the screen. */
export function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';
}
