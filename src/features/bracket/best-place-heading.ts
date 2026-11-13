import { ordinal } from '../../lib/ordinal';

/** The card of a best-place tie: the round and its place, how many spots are left, and the round they go to. */
export function bestPlaceHeading(
  tie: { roundIndex: number; place: number; spots: number; destination: number },
  labels: ReadonlyArray<{ label: string }>,
): string {
  const spots = `${tie.spots} spot${tie.spots === 1 ? '' : 's'}`;
  const from = labels[tie.roundIndex]?.label ?? '';
  const to = labels[tie.destination]?.label ?? '';
  return `⚠ Tie-break required — ${from} · best ${ordinal(tie.place)}: ${spots} in ${to}`;
}
