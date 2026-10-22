export const TOUR_BUILD_ID: string = __TOUR_BUILD_ID__;

/** The header every server call carries: the build id of the tab that sent it. */
export const BUILD_HEADER = 'x-tour-build';

export const OUTDATED_TAB_MESSAGE =
  'A new version of the Tournament Hub is live — reload the page to keep editing.';

/** The refusal for a call from another build; null when it is the live one. A missing header is an old tab too. */
export function outdatedBuildRefusal(sent: string | null, live: string): string | null {
  return sent === live ? null : OUTDATED_TAB_MESSAGE;
}

export const BUILD_CHECK_INTERVAL_MS = 5 * 60_000;
export const BUILD_CHECK_MIN_GAP_MS = 60_000;

/** True when no check has run yet or the last one was at least `BUILD_CHECK_MIN_GAP_MS` ago. */
export function isBuildCheckDue(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= BUILD_CHECK_MIN_GAP_MS;
}
