import { describe, expect, it } from 'vitest';
import { isBuildCheckDue, OUTDATED_TAB_MESSAGE, outdatedBuildRefusal, TOUR_BUILD_ID } from './build-id';

describe('outdatedBuildRefusal', () => {
  it('is null for the live build', () => {
    expect(outdatedBuildRefusal('2026-10-22T10:00:00.000Z', '2026-10-22T10:00:00.000Z')).toBeNull();
  });

  it('refuses another build, no header and an empty header', () => {
    expect(outdatedBuildRefusal('2026-10-21T10:00:00.000Z', '2026-10-22T10:00:00.000Z')).toBe(
      OUTDATED_TAB_MESSAGE,
    );
    expect(outdatedBuildRefusal(null, '2026-10-22T10:00:00.000Z')).toBe(OUTDATED_TAB_MESSAGE);
    expect(outdatedBuildRefusal('', '2026-10-22T10:00:00.000Z')).toBe(OUTDATED_TAB_MESSAGE);
  });
});

describe('TOUR_BUILD_ID', () => {
  it('is replaced at build time, also under Vitest', () => {
    expect(TOUR_BUILD_ID).toMatch(/\S/);
  });
});

describe('isBuildCheckDue', () => {
  it('is due when never checked and once the minimum gap has passed, not before', () => {
    expect(isBuildCheckDue(null, 1_000_000)).toBe(true);
    expect(isBuildCheckDue(1_000_000 - 59_000, 1_000_000)).toBe(false);
    expect(isBuildCheckDue(1_000_000 - 60_000, 1_000_000)).toBe(true);
  });
});
