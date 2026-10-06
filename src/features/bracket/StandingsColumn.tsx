import { formatStandingValue } from '../../domain/tournament/scoring';
import { unitDisplay } from '../../domain/tournament/roster';
import { standingFor, type StandingsDisplay } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { standingsContextLine } from '../standings/standings-text';
import { bracketRowBase, resultClasses, standingsRowResult } from '../tournament/components/result-row';

const headerClass =
  'flex w-full cursor-pointer items-center gap-1 border-b border-muted bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-primary uppercase';

function CutLine() {
  return (
    <div
      aria-label='Cut line'
      className='my-1 flex items-center gap-1.5 text-[0.6rem] text-warning uppercase'
    >
      <span className='h-0 flex-1 border-t border-dashed border-t-warning' />
      cut
    </div>
  );
}

function StandingsBlock({
  table,
  display,
  state,
  followKey,
}: {
  table: StandingsDisplay['tables'][number];
  display: StandingsDisplay;
  state: TournamentState;
  followKey: string | null;
}) {
  return (
    <div className='mt-2'>
      {display.perGroup ? (
        <div className='mb-1 text-[0.68rem] font-bold text-muted'>{table.label}</div>
      ) : null}
      <div className='flex flex-col gap-0.5'>
        {table.entries.map((entry, index) => (
          <div key={entry.name}>
            {table.cut !== null && index === table.cut ? <CutLine /> : null}
            <div
              className={cn(
                bracketRowBase,
                'flex items-center gap-1.5',
                resultClasses(standingsRowResult(index, table.cut, display.phase), followKey === entry.name),
              )}
            >
              <span className='w-5 shrink-0 text-right tabular-nums'>{entry.rank ?? '—'}</span>
              <span className='min-w-0 flex-1 truncate'>{unitDisplay(state, entry.name).label}</span>
              <span className='shrink-0 text-muted tabular-nums'>
                {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The compact standings block between the last pooling round and the first
 * bracket round: rank, name, points and the cut. Deliberately not a round (no
 * `data-ri`: follow-scrolling uses that to find round columns).
 */
export function StandingsColumn({
  display,
  state,
  followKey,
  collapsed,
  onToggle,
  onOpenFullTable,
}: {
  display: StandingsDisplay;
  state: TournamentState;
  followKey: string | null;
  collapsed: boolean;
  /** Absent in the read-only archive: the column then stays open. */
  onToggle?: () => void;
  onOpenFullTable?: () => void;
}) {
  const folded = collapsed && onToggle !== undefined;
  const followed = followKey ? standingFor(display, followKey) !== null : false;
  return (
    <div
      className={cn(
        folded ? 'w-8.5 min-w-8.5' : 'w-52.5 min-w-52.5',
        'shrink-0 overflow-hidden rounded-lg border-2 border-muted bg-surface-low',
        followed && 'border-primary',
      )}
      data-standings-column
    >
      {onToggle ? (
        <button
          className={cn(
            headerClass,
            folded && 'h-45 border-b-0 py-2 pr-0 pl-0.5 whitespace-nowrap [writing-mode:vertical-rl]',
          )}
          aria-expanded={!folded}
          onClick={onToggle}
        >
          <span
            className={cn(
              'shrink-0 rotate-90 text-[0.68rem]',
              folded && 'rotate-180 [writing-mode:horizontal-tb]',
            )}
          >
            ▸
          </span>
          Standings
        </button>
      ) : (
        <div className={cn(headerClass, 'cursor-default')}>Standings</div>
      )}
      {!folded ? (
        <div className='p-2.5'>
          <p className='text-xs text-muted'>{standingsContextLine(display)}</p>
          {display.phase !== 'upcoming'
            ? display.tables.map((table) => (
                <StandingsBlock
                  key={table.key}
                  table={table}
                  display={display}
                  state={state}
                  followKey={followKey}
                />
              ))
            : null}
          {onOpenFullTable ? (
            <button
              className='mt-2.5 cursor-pointer text-xs font-semibold text-primary hover:underline'
              onClick={onOpenFullTable}
            >
              Full table →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
