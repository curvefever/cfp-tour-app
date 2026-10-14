import type { StandingsDisplay } from '../../../domain/tournament/standings-display';
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
  | 'below-cut'
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
    case 'below-cut':
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

/** How a standings row reads: through the cut, or past it (the red bar of an eliminated row only once the standings are final). */
export function standingsRowResult(
  index: number,
  cut: number | null,
  phase: StandingsDisplay['phase'],
): RowResult {
  if (cut === null || index < cut) return 'advance';
  return phase === 'final' ? 'eliminate' : 'below-cut';
}
