import { useId, useState } from 'react';
import {
  tableRoundIndexes,
  type CutTieMarks,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import { formatStandingValue } from '../../domain/tournament/scoring';
import { unitDisplay } from '../../domain/tournament/roster';
import type { TournamentState } from '../../domain/tournament/types';
import { cn } from '../../components/ui';
import { ResultStripe } from '../tournament/components/ResultStripe';
import {
  rowSurfaceClasses,
  standingsGroupStarts,
  standingsRowResult,
} from '../tournament/components/result-row';
import { compactRoundPoints, standingsDetailLines } from './standings-compact';
import { entriesSharingPercent, standingsRoundLabel } from './standings-text';
import { TieMark } from './StandingsTable';

type Entry = StandingsDisplayTable['entries'][number];

/** The unfolded detail of a row: a line per counted round, then the tie-break. */
function RowDetail({ id, lines }: { id: string; lines: string[] }) {
  return (
    <div
      className='flex flex-col gap-1.5 bg-cfp-game-fold py-2.5 pr-3 pl-12 text-sm text-cfp-text-soft'
      id={id}
    >
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

/**
 * One standings table as a phone list (the table is hidden there, and this is hidden above 700 px): place, result
 * stripe, name, the round points small, the total. A row is a button that unfolds its detail; several may be open.
 */
export function StandingsCompactList({
  className,
  display,
  followKey,
  marks,
  state,
  table,
  unitLabel,
}: {
  className?: string;
  display: StandingsDisplay;
  followKey: string | null;
  marks: CutTieMarks | undefined;
  state: TournamentState;
  table: StandingsDisplayTable;
  unitLabel: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const roundIndexes = tableRoundIndexes(state, table);
  const labels = roundIndexes.map((roundIndex) => standingsRoundLabel(state, roundIndex));
  const sharesPercent = entriesSharingPercent(table.entries);
  const groupStarts = standingsGroupStarts(table);
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  function renderRow(entry: Entry, index: number) {
    const info = unitDisplay(state, entry.name);
    const detailId = `${listId}-${index}`;
    const isOpen = open.has(entry.name);
    return (
      <div key={entry.name}>
        {groupStarts.includes(index) ? <div className='h-3' /> : null}
        <button
          aria-controls={isOpen ? detailId : undefined}
          aria-expanded={isOpen}
          className={cn(
            'flex min-h-11 w-full cursor-pointer items-center gap-1.75 px-3 py-0.75 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary',
            rowSurfaceClasses(index, followKey === entry.name),
          )}
          onClick={() => toggle(entry.name)}
          type='button'
        >
          <span className='w-6 shrink-0 text-right text-sm font-bold text-muted tabular-nums'>
            {entry.rank ?? '—'}
          </span>
          <ResultStripe
            className={info.members?.length ? 'my-2.5' : 'my-px'}
            compact
            result={standingsRowResult(index, table, display.phase, entry.rank !== null)}
            stretch
          />
          <span className='flex min-w-0 flex-1 flex-col'>
            <span className='wrap-break-word text-[15px] font-bold'>
              {info.label}
              <TieMark
                pending={marks?.pending.includes(entry.name) ?? false}
                placed={marks?.placed.includes(entry.name) ?? false}
              />
            </span>
            {info.members?.length ? (
              <span className='wrap-break-word text-[13px] leading-4.5 text-muted'>
                {info.members.join(' · ')}
              </span>
            ) : null}
          </span>
          <span className='shrink-0 text-xs text-muted tabular-nums'>
            {compactRoundPoints(entry, roundIndexes, state.rounds)}
          </span>
          <span className='w-9 shrink-0 text-right text-[15px] font-extrabold tabular-nums'>
            {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
          </span>
        </button>
        {isOpen ? (
          <RowDetail
            id={detailId}
            lines={standingsDetailLines(entry, roundIndexes, labels, sharesPercent[index], state.rounds)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xs bg-cfp-game-deep outline-2 outline-cfp-game-frame',
        className,
      )}
    >
      <div className='flex h-7 items-center gap-1.75 bg-cfp-game-title px-3 text-[11px] font-extrabold tracking-[0.06em] text-muted uppercase'>
        <span className='w-6 shrink-0 text-right'>Pos</span>
        <span className='w-1 shrink-0' />
        <span className='flex-1'>{unitLabel}</span>
        <span>Rounds</span>
        <span className='w-9 text-right'>Pts</span>
      </div>
      {table.entries.map(renderRow)}
    </div>
  );
}
