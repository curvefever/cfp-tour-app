import type { bracketRoundLabels } from '../../domain/tournament/bracket';
import { unitDisplay } from '../../domain/tournament/roster';
import { formatStandingValue } from '../../domain/tournament/scoring';
import {
  standingFor,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { ResultStripe } from '../tournament/components/ResultStripe';
import {
  bracketRowBase,
  rowSurfaceClasses,
  standingsGroupStarts,
  standingsRowResult,
} from '../tournament/components/result-row';
import { ColumnTitleBar } from './ColumnTitleBar';
import { ExitIcon } from './ExitIcon';
import { FoldedBox } from './FoldedBox';
import { standingsExitLines } from './exit-lines';

/** TEMPORARY while the standings can still change, FINAL once the last pooling round is over; nothing before they start. */
function PhaseBadge({ phase }: { phase: StandingsDisplay['phase'] }) {
  if (phase === 'upcoming') return null;
  const live = phase === 'live';
  return (
    <span
      className={cn(
        'rounded-xs px-1.75 py-0.75 text-[11px] leading-none font-extrabold tracking-[0.05em]',
        live ? 'bg-warning/18 text-cfp-orange-text' : 'bg-success/18 text-cfp-green-text',
      )}
    >
      {live ? 'TEMPORARY' : 'FINAL'}
    </span>
  );
}

function StandingsRows({
  display,
  followKey,
  state,
  table,
}: {
  display: StandingsDisplay;
  followKey: string | null;
  state: TournamentState;
  table: StandingsDisplayTable;
}) {
  const groupStarts = standingsGroupStarts(table);
  return (
    <div className='flex flex-col'>
      {display.perGroup ? (
        <div className='px-2.5 pt-2 pb-1 text-xs font-extrabold tracking-[0.05em] text-muted uppercase'>
          {table.label}
        </div>
      ) : null}
      {table.entries.map((entry, index) => {
        const info = unitDisplay(state, entry.name);
        return (
          <div key={entry.name}>
            {groupStarts.includes(index) ? <div className='h-3' /> : null}
            <div
              className={cn(
                bracketRowBase,
                'flex min-h-7.5 items-center gap-1.75 py-0.75',
                rowSurfaceClasses(index, followKey === entry.name),
              )}
            >
              <span className='w-6 shrink-0 text-right text-sm font-bold text-muted tabular-nums'>
                {entry.rank ?? '—'}
              </span>
              <ResultStripe compact result={standingsRowResult(index, table, display.phase)} />
              <span className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-[15px] font-bold'>{info.label}</span>
                {info.members?.length ? (
                  <span className='truncate text-[13px] text-muted'>{info.members.join(' · ')}</span>
                ) : null}
              </span>
              <span className='shrink-0 text-[15px] font-extrabold tabular-nums'>
                {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The compact standings block between the last pooling round and the first bracket round: rank, name, points,
 * where each run of standings goes, and a title bar like a round's (TEMPORARY or FINAL, the exit icon, a fold
 * chevron). Deliberately not a round. Folded, it is the same small box as a folded round.
 */
export function StandingsColumn({
  display,
  state,
  labels,
  followKey,
  collapsed,
  onToggle,
  onOpenFullTable,
}: {
  display: StandingsDisplay;
  state: TournamentState;
  labels: ReturnType<typeof bracketRoundLabels>;
  followKey: string | null;
  collapsed: boolean;
  /** Absent in a read-only view: the column then stays open. */
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
  const exitLines = display.tables[0] ? standingsExitLines(display.tables[0], display, labels) : [];
  return (
    <div className='relative flex w-67.5 min-w-67.5 shrink-0 flex-col gap-4.5' data-standings-column>
      <ColumnTitleBar
        badge={<PhaseBadge phase={display.phase} />}
        extra={
          <ExitIcon
            label='Where players go from the standings'
            lines={exitLines}
            popupClassName='top-12.5 right-0'
          />
        }
        onToggle={onToggle}
        title='Standings'
      />
      <div className='overflow-hidden rounded-xs bg-cfp-game-deep outline-2 outline-cfp-game-frame'>
        {display.phase !== 'upcoming' ? (
          display.tables.map((table) => (
            <StandingsRows
              display={display}
              followKey={followKey}
              key={table.key}
              state={state}
              table={table}
            />
          ))
        ) : (
          <p className='px-3 py-2.5 text-sm text-muted'>
            Standings start after Round {display.firstCountedRoundNum}.
          </p>
        )}
        {onOpenFullTable ? (
          <button
            className='m-2.5 cursor-pointer text-sm font-bold text-cfp-sky hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
            onClick={onOpenFullTable}
          >
            Full table →
          </button>
        ) : null}
      </div>
    </div>
  );
}
