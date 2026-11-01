import { GROUP_BAND_KEY_PREFIX } from '../../domain/tournament/advancement';
import { GROUP_EXIT_TIE_KEY } from '../../domain/tournament/group-exit';

/**
 * The heading of a standings cut-off tie banner: the last group spot, a group's own cut-off, a Groups line's band
 * boundary ("Groups tie between R1 and R1C"), or a qualification table's (against its bands, or the single cut-off).
 * `boundaryText` names the destinations a band-boundary tie decides between.
 */
export function cutoffTieHeading(
  key: string,
  tie: { groupLabel?: string },
  boundaryText: string | null,
  cutoffValue: string,
): string {
  if (key === GROUP_EXIT_TIE_KEY) return `⚖ Groups: tie for the last spot (${cutoffValue})`;
  if (tie.groupLabel) return `⚖ Group ${tie.groupLabel} qualification tie at the cut-off (${cutoffValue})`;
  if (key.startsWith(GROUP_BAND_KEY_PREFIX) && boundaryText) {
    return `⚖ Groups tie between ${boundaryText} (${cutoffValue})`;
  }
  return boundaryText
    ? `⚖ Qualification tie between ${boundaryText} (${cutoffValue})`
    : `⚖ Qualification tie at the cut-off (${cutoffValue})`;
}
