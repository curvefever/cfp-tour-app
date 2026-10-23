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
import { joinMembers } from '../tournament/components/member-line';
import { ResultStripe } from '../tournament/components/ResultStripe';
import {
  bracketRowBase,
  rowSurfaceClasses,
  standingsGroupStarts,
  standingsRowResult,
} from '../tournament/components/result-row';
import { ColumnTitleBar } from './ColumnTitleBar';
import { ExitIcon } from './ExitIcon';
import { PhaseBadge } from './PhaseBadge';
import { FoldedBox } from './FoldedBox';
import { standingsNames } from '../standings/standings-names';
import { standingsExitLines } from './exit-lines';
import { phoneFullWidthClass, phoneHiddenClass } from './phone-box';

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
              {/* The stripe grows with the text, not the row's minimum height: its margin leaves 18 px beside one
                  20 px line, or beside a name and member line (20 + 18 px). */}
              <span className='flex min-w-0 flex-1 items-center gap-1.75'>
                <ResultStripe
                  className={info.members?.length ? 'my-2.5' : 'my-px'}
                  compact
                  result={standingsRowResult(index, table, display.phase, entry.rank !== null)}
                  stretch
                />
                <span className='flex min-w-0 flex-1 flex-col'>
                  <span className='wrap-break-word text-[15px] font-bold'>{info.label}</span>
                  {info.members?.length ? (
                    <span className='wrap-break-word text-[13px] leading-4.5 text-muted'>
                      {joinMembers(info.members)}
                    </span>
                  ) : null}
                </span>
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
  phoneShown = true,
}: {
  display: StandingsDisplay;
  state: TournamentState;
  labels: ReturnType<typeof bracketRoundLabels>;
  followKey: string | null;
  collapsed: boolean;
  /** Absent in a read-only view: the column then stays open. */
  onToggle?: () => void;
  onOpenFullTable?: () => void;
  /** The column is the box a phone shows (`RoundStrip`): always open there, whatever its fold state; hidden when not. */
  phoneShown?: boolean;
}) {
  const names = standingsNames(display.kind);
  const followedStanding = followKey ? standingFor(display, followKey) : null;
  const foldedOnDesktop = collapsed && onToggle !== undefined;
  const exitLines = display.tables[0] ? standingsExitLines(display.tables[0], display, labels) : [];
  const open = (
    <div
      className={cn(
        'relative flex w-82.5 min-w-82.5 shrink-0 flex-col gap-4.5',
        phoneFullWidthClass,
        foldedOnDesktop ? 'hidden max-[700px]:flex' : phoneHiddenClass(phoneShown),
      )}
      data-standings-column
    >
      <ColumnTitleBar
        badge={<PhaseBadge phase={display.phase} />}
        extra={
          <ExitIcon
            label={`Where players go from ${names.inline}`}
            lines={exitLines}
            popupClassName='top-12.5 right-0'
          />
        }
        onToggle={onToggle}
        title={names.title}
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
  if (!foldedOnDesktop) return open;
  // Folded on a desktop; a phone shows the column open, so its body is rendered only while it is the shown one.
  return (
    <>
      <div className='shrink-0 max-[700px]:hidden' data-standings-column>
        <FoldedBox onUnfold={onToggle} title={names.title}>
          {followedStanding ? (
            <div className='text-base font-bold text-cfp-sky'>#{followedStanding.rank}</div>
          ) : null}
        </FoldedBox>
      </div>
      {phoneShown ? open : null}
    </>
  );
}
