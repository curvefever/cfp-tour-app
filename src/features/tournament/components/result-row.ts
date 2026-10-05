import type { StandingsDisplay } from '../../../domain/tournament/standings-display';
import { cn } from '../../../components/ui';

/** Row styling shared by Bracket's room rows and the standings tables, so a result looks the same in both. */
export const bracketRowBase = 'rounded-sm border-l-[3px] border-l-transparent px-2 py-1 text-xs';

export type RowResult =
  'advance' | 'drop' | 'eliminate' | 'lucky' | 'pending' | 'promote' | 'stay' | 'demote' | 'below-cut' | '';

export function resultClasses(result: RowResult, followed: boolean) {
  return cn(
    result === 'advance' && 'border-l-success text-success',
    // A drop (double-elim: to the losers bracket) is a real, ongoing result,
    // not an elimination -- amber like a Kings Valley demote, but never
    // struck through.
    result === 'drop' && 'border-l-warning text-warning',
    result === 'eliminate' && 'border-l-surface-hover text-muted line-through opacity-50',
    result === 'lucky' && 'border-l-accent text-accent',
    result === 'pending' && 'border-l-danger text-danger no-underline opacity-85',
    result === 'promote' && 'border-l-success text-success',
    result === 'demote' && 'border-l-warning text-warning',
    // Below a live standings cut: a projection, muted but never struck through.
    result === 'below-cut' && 'text-muted',
    followed && 'bg-primary-soft shadow-[inset_0_0_0_1px_rgb(0_229_255_/_27%)]',
  );
}

/** How a standings row reads: through the cut, or past it (struck through only once the standings are final). */
export function standingsRowResult(
  index: number,
  cut: number | null,
  phase: StandingsDisplay['phase'],
): RowResult {
  if (cut === null || index < cut) return 'advance';
  return phase === 'final' ? 'eliminate' : 'below-cut';
}
