import type { StandingsDisplay, StandingsDisplayTable } from '../../../domain/tournament/standings-display';
import { cn } from '../../../components/ui';

/** Row styling shared by Bracket's room rows and the standings tables, so a result looks the same in both. */
export const bracketRowBase = 'px-3 py-1 text-xs';

export type RowResult =
  | 'advance'
  | 'advance-second'
  | 'advance-third'
  | 'drop'
  | 'eliminate'
  | 'lucky'
  | 'candidate'
  | 'pending'
  | 'undecided'
  | 'promote'
  | 'stay'
  | 'demote'
  | '';

/** The colour of a result stripe; `dashed` is the empty, outlined stripe of an undecided row. */
export type StripeTone = 'green' | 'yellow' | 'orange' | 'purple' | 'red' | 'dashed';

/** The stripe a result gets: the stripe alone carries a row's status (names never change colour). `null`: no stripe at all. */
export function stripeTone(result: RowResult): StripeTone | null {
  switch (result) {
    case 'advance':
    case 'promote':
    case 'lucky':
      return 'green';
    case 'advance-second':
    case 'stay':
      return 'yellow';
    case 'demote':
      return 'orange';
    // A drop to the losers bracket, or a third destination group, is purple: a real result, not an elimination.
    case 'drop':
    case 'advance-third':
      return 'purple';
    case 'eliminate':
      return 'red';
    case 'pending':
    case 'candidate':
    case 'undecided':
      return 'dashed';
    case '':
      return null;
  }
}

/** A row's surface: alternating grounds, flush against each other; a followed row gets the lighter ground and a ring. */
export function rowSurfaceClasses(index: number, followed: boolean) {
  return cn(
    followed
      ? 'bg-cfp-followed shadow-[inset_0_0_0_2px_var(--color-cfp-followed-ring)]'
      : index % 2 === 0
        ? 'bg-cfp-row-a'
        : 'bg-cfp-row-b',
  );
}

/**
 * How a row of a standings table reads: through (green; with a Qual source's bands the first destination is green,
 * the second yellow, the third and later purple) or out (red: past the cut, or in an "out" band). Live or final,
 * the same: the TEMPORARY badge says the table may still change. Nothing before the standings start.
 */
export function standingsRowResult(
  index: number,
  table: Pick<StandingsDisplayTable, 'bands' | 'cut'>,
  phase: StandingsDisplay['phase'],
): RowResult {
  if (phase === 'upcoming') return '';
  if (table.bands && table.bands.length > 0) {
    const bands = table.bands;
    const band = [...bands].reverse().find((candidate) => candidate.start <= index) ?? bands[0];
    if (band.destination === 'out') return 'eliminate';
    const destinations = [
      ...new Set(bands.filter((entry) => entry.destination !== 'out').map((entry) => entry.destination)),
    ];
    const position = destinations.indexOf(band.destination);
    return position <= 0 ? 'advance' : position === 1 ? 'advance-second' : 'advance-third';
  }
  return table.cut === null || index < table.cut ? 'advance' : 'eliminate';
}

/**
 * The rows where a new group of the table begins (a group of equal destination: the rows through and the rows
 * out, or each run of a Qual source's bands), for the gap drawn between groups. The first row is never one.
 */
export function standingsGroupStarts(
  table: Pick<StandingsDisplayTable, 'bands' | 'cut' | 'entries'>,
): number[] {
  if (table.bands && table.bands.length > 0) {
    return table.bands.map((band) => band.start).filter((start) => start > 0);
  }
  return table.cut !== null && table.cut > 0 && table.cut < table.entries.length ? [table.cut] : [];
}
