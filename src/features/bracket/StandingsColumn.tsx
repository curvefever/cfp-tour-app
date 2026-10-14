import { formatStandingValue } from '../../domain/tournament/scoring';
import { unitDisplay } from '../../domain/tournament/roster';
import {
  standingFor,
  standingsBandLabel,
  type StandingsDisplay,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { standingsContextLine } from '../standings/standings-text';
import { FoldedBox } from './FoldedBox';
import { ResultStripe } from '../tournament/components/ResultStripe';
import { bracketRowBase, rowSurfaceClasses, standingsRowResult } from '../tournament/components/result-row';

const headerClass =
  'flex w-full cursor-pointer items-center gap-1 border-b border-muted bg-surface-low px-3 py-2.5 text-left text-xs font-bold tracking-[0.08em] text-primary uppercase';

function CutLine({ label = 'cut' }: { label?: string }) {
  return (
    <div
      aria-label={label === 'cut' ? 'Cut line' : `Band: ${label}`}
      className='my-1 flex items-center gap-1.5 text-[0.6rem] text-warning uppercase'
    >
      <span className='h-0 flex-1 border-t border-dashed border-t-warning' />
      {label}
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
      <div className='flex flex-col'>
        {table.entries.map((entry, index) => {
          const band = table.bands?.find((candidate) => candidate.start === index);
          return (
            <div key={entry.name}>
              {band ? <CutLine label={standingsBandLabel(band.destination)} /> : null}
              {!table.bands && table.cut !== null && index === table.cut ? <CutLine /> : null}
              <div
                className={cn(
                  bracketRowBase,
                  'flex items-center gap-1.5',
                  rowSurfaceClasses(index, followKey === entry.name),
                )}
              >
                <span className='w-5 shrink-0 text-right tabular-nums'>{entry.rank ?? '—'}</span>
                <ResultStripe compact result={standingsRowResult(index, table, display.phase)} />
                <span className='min-w-0 flex-1 truncate'>{unitDisplay(state, entry.name).label}</span>
                <span className='shrink-0 text-muted tabular-nums'>
                  {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The compact standings block between the last pooling round and the first
 * bracket round: rank, name, points and the cut. Deliberately not a round.
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
  const followedStanding = followKey ? standingFor(display, followKey) : null;
  if (collapsed && onToggle !== undefined) {
    return (
      <div className='shrink-0' data-standings-column>
        <FoldedBox onUnfold={onToggle} title='Standings'>
          {followedStanding ? (
            <div className='text-base font-bold text-cfp-sky'>#{followedStanding.rank}</div>
          ) : null}
        </FoldedBox>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'w-52.5 min-w-52.5 shrink-0 overflow-hidden rounded-lg border-2 border-muted bg-surface-low',
        followedStanding && 'border-primary',
      )}
      data-standings-column
    >
      {onToggle ? (
        <button aria-expanded='true' className={headerClass} onClick={onToggle}>
          <span className='shrink-0 rotate-90 text-[0.68rem]'>▸</span>
          Standings
        </button>
      ) : (
        <div className={cn(headerClass, 'cursor-default')}>Standings</div>
      )}
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
    </div>
  );
}
