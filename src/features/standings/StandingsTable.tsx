import { formatStandingValue } from '../../domain/tournament/scoring';
import {
  tableRoundIndexes,
  type CutTieMarks,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { TournamentUnit } from '../../components/tournament/TournamentUnit';
import { TableCell, TableHeadCell, TableRow, cn } from '../../components/ui';
import { ResultStripe } from '../tournament/components/ResultStripe';
import {
  rowSurfaceClasses,
  standingsGroupStarts,
  standingsRowResult,
} from '../tournament/components/result-row';
import {
  entriesSharingPercent,
  formatTieBreak,
  formatTieBreakPrecise,
  roundCells,
  standingsRoundLabel,
} from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

/** The cells of a round's three columns are right-aligned numbers, 60 px wide. */
const NUMBER_CELL = 'w-15 px-2 text-right tabular-nums';
const HEAD_CELL = 'bg-cfp-game-frame px-2 py-0 text-xs text-cfp-text-soft';

export function TieMark({ placed, pending }: { placed: boolean; pending: boolean }) {
  if (placed)
    return (
      <span className='ml-1.5' title='Placed by a cut-off tie-break'>
        ⚖
      </span>
    );
  if (pending)
    return (
      <span className='ml-1.5 text-warning' title='Tied at the cut-off: tie-break needed'>
        ⚠ TB?
      </span>
    );
  return null;
}

/** The header: a "Round N" head with a brand underline over its three columns, then the column heads. */
function StandingsHead({
  state,
  roundIndexes,
  unitLabel,
}: {
  state: TournamentState;
  roundIndexes: number[];
  unitLabel: string;
}) {
  return (
    <thead>
      <TableRow>
        <TableHeadCell className={cn(HEAD_CELL, 'w-14 pl-4 align-bottom')} rowSpan={2}>
          Pos
        </TableHeadCell>
        <TableHeadCell className={cn(HEAD_CELL, 'min-w-42.5 align-bottom')} rowSpan={2}>
          {unitLabel}
        </TableHeadCell>
        {roundIndexes.map((roundIndex) => (
          <TableHeadCell className={cn(HEAD_CELL, 'px-1.5 pt-3 text-center')} colSpan={3} key={roundIndex}>
            <span className='block border-b-2 border-primary pb-1.25 text-[13px] text-foreground'>
              {standingsRoundLabel(state, roundIndex)}
            </span>
          </TableHeadCell>
        ))}
        <TableHeadCell className={cn(HEAD_CELL, 'w-21 text-right text-foreground align-bottom')} rowSpan={2}>
          Points
        </TableHeadCell>
        <TableHeadCell className={cn(HEAD_CELL, 'w-24 pr-4 text-right align-bottom')} rowSpan={2}>
          Tie-break
        </TableHeadCell>
      </TableRow>
      <TableRow className='h-9'>
        {roundIndexes.flatMap((roundIndex) =>
          ['Score', 'Rank', 'Pts'].map((head) => (
            <TableHeadCell className={cn(HEAD_CELL, 'text-right')} key={`${roundIndex}-${head}`}>
              {head}
            </TableHeadCell>
          )),
        )}
      </TableRow>
    </thead>
  );
}

function RoundResultCells({
  entry,
  roundIndex,
  bestOf,
}: {
  entry: Entry;
  roundIndex: number;
  bestOf?: number;
}) {
  const cells = roundCells(
    entry.rounds?.find((result) => result.roundIndex === roundIndex),
    entry.absentRounds?.includes(roundIndex),
    bestOf,
  );
  return (
    <>
      <TableCell className={cn(NUMBER_CELL, 'border-0 py-0 text-sm text-muted')}>{cells.score}</TableCell>
      <TableCell className={cn(NUMBER_CELL, 'border-0 py-0 text-sm text-muted')}>{cells.rank}</TableCell>
      <TableCell className={cn(NUMBER_CELL, 'border-0 py-0 text-base font-bold')}>{cells.points}</TableCell>
    </>
  );
}

/** One unit's row: place and result stripe, name (and the cut-tie marks), each round, the total and the tie-break. */
function StandingsRow({
  index,
  table,
  entry,
  roundIndexes,
  display,
  state,
  followed,
  placed,
  pending,
  sharesPercent,
}: {
  index: number;
  table: StandingsDisplayTable;
  entry: Entry;
  roundIndexes: number[];
  display: StandingsDisplay;
  state: TournamentState;
  followed: boolean;
  placed: boolean;
  pending: boolean;
  /** Another unit on the same points shows the same whole percent. */
  sharesPercent: boolean;
}) {
  return (
    <TableRow className={cn('h-10', rowSurfaceClasses(index, followed))}>
      <TableCell className='border-0 py-0 pl-4'>
        <div className='flex items-center gap-3'>
          <span className='w-5.5 text-right text-[15px] font-bold text-muted'>{entry.rank ?? '—'}</span>
          <span className='flex w-1 shrink-0'>
            <ResultStripe result={standingsRowResult(index, table, display.phase, entry.rank !== null)} />
          </span>
        </div>
      </TableCell>
      <TableCell className='border-0 py-0 pl-1 text-base whitespace-nowrap'>
        <TournamentUnit state={state} name={entry.name} />
        <TieMark placed={placed} pending={pending} />
      </TableCell>
      {roundIndexes.map((roundIndex) => (
        <RoundResultCells
          bestOf={state.rounds[roundIndex]?.bestOf}
          entry={entry}
          key={roundIndex}
          roundIndex={roundIndex}
        />
      ))}
      <TableCell className='w-21 border-0 py-0 pr-2 text-right text-lg font-extrabold tabular-nums'>
        {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
      </TableCell>
      <TableCell
        className={cn(
          'w-24 border-0 py-0 pr-4 text-right text-sm text-muted tabular-nums',
          sharesPercent && 'underline decoration-dotted',
        )}
        title={formatTieBreakPrecise(entry.roomShare)}
      >
        {formatTieBreak(entry.roomShare)}
      </TableCell>
    </TableRow>
  );
}

/** The gap drawn where a new group of the table begins (the rows out after the rows through, a Qual band). */
function GroupGap({ columnCount }: { columnCount: number }) {
  return (
    <tr aria-hidden='true'>
      <td className='h-3.5 border-0 bg-cfp-game-frame p-0' colSpan={columnCount} />
    </tr>
  );
}

/**
 * One standings table in its frame: the header on the frame colour, flush alternating rows with the result stripe
 * beside the place, a gap between groups of rows instead of a cut line. It scrolls sideways inside its frame.
 */
export function StandingsTable({
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
  const roundIndexes = tableRoundIndexes(state, table);
  const groupStarts = standingsGroupStarts(table);
  const sharesPercent = entriesSharingPercent(table.entries);
  return (
    <div
      className={cn(
        'max-w-full overflow-x-auto rounded-xs bg-cfp-game-card outline-2 outline-cfp-game-frame',
        className,
      )}
    >
      <table className='w-full border-collapse'>
        <StandingsHead roundIndexes={roundIndexes} state={state} unitLabel={unitLabel} />
        <tbody>
          {table.entries.flatMap((entry, index) => [
            groupStarts.includes(index) ? (
              <GroupGap columnCount={roundIndexes.length * 3 + 4} key={`gap-${index}`} />
            ) : null,
            <StandingsRow
              display={display}
              entry={entry}
              followed={followKey === entry.name}
              index={index}
              key={entry.name}
              pending={marks?.pending.includes(entry.name) ?? false}
              placed={marks?.placed.includes(entry.name) ?? false}
              roundIndexes={roundIndexes}
              sharesPercent={sharesPercent[index]}
              state={state}
              table={table}
            />,
          ])}
        </tbody>
      </table>
    </div>
  );
}
