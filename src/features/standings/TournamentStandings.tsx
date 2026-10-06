import { getGameFormat } from '../../domain/tournament/formats';
import { formatStandingValue } from '../../domain/tournament/scoring';
import {
  tableRoundIndexes,
  type CutTieMarks,
  type StandingsDisplay,
  type StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { TournamentUnit } from '../../components/tournament/TournamentUnit';
import {
  Panel,
  PanelTitle,
  Table,
  TableCell,
  TableHeadCell,
  TableRow,
  TableScroll,
  cn,
} from '../../components/ui';
import { resultClasses, standingsRowResult } from '../tournament/components/result-row';
import { formatTieBreak, roundCells } from './standings-text';

type Entry = StandingsDisplayTable['entries'][number];

const ROUND_CELL = 'px-2 text-center tabular-nums';
const ROUND_START = 'border-l border-l-surface-hover';
const TOTAL_START = 'border-l-2 border-l-muted';

function CutLine({ columnCount }: { columnCount: number }) {
  return (
    <tr aria-label='Cut line'>
      <td className='border-0 border-t border-dashed border-t-warning p-0 text-right' colSpan={columnCount}>
        <span className='bg-surface px-2 text-[0.6rem] tracking-[0.1em] text-warning uppercase'>cut</span>
      </td>
    </tr>
  );
}

function TieMark({ placed, pending }: { placed: boolean; pending: boolean }) {
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

function RoundSubHeads() {
  return (
    <>
      <TableHeadCell className={cn(ROUND_CELL, ROUND_START, 'font-normal')}>Score</TableHeadCell>
      <TableHeadCell className={cn(ROUND_CELL, 'font-normal')}>Rank</TableHeadCell>
      <TableHeadCell className={cn(ROUND_CELL, 'text-foreground')}>Pts</TableHeadCell>
    </>
  );
}

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
        <TableHeadCell rowSpan={2}>Pos</TableHeadCell>
        <TableHeadCell rowSpan={2}>{unitLabel}</TableHeadCell>
        {roundIndexes.map((roundIndex) => (
          <TableHeadCell className={cn(ROUND_CELL, ROUND_START)} colSpan={3} key={roundIndex}>
            Round {state.rounds[roundIndex].roundNum}
          </TableHeadCell>
        ))}
        <TableHeadCell className={cn('text-primary', TOTAL_START)} rowSpan={2}>
          Points
        </TableHeadCell>
        <TableHeadCell rowSpan={2}>Tie-break</TableHeadCell>
      </TableRow>
      <TableRow>
        {roundIndexes.map((roundIndex) => (
          <RoundSubHeads key={roundIndex} />
        ))}
      </TableRow>
    </thead>
  );
}

function RoundResultCells({
  entry,
  roundIndex,
  roundOver,
}: {
  entry: Entry;
  roundIndex: number;
  roundOver: boolean;
}) {
  const cells = roundCells(
    entry.rounds?.find((result) => result.roundIndex === roundIndex),
    roundOver,
  );
  return (
    <>
      <TableCell className={cn(ROUND_CELL, ROUND_START, 'text-xs text-muted')}>{cells.score}</TableCell>
      <TableCell className={cn(ROUND_CELL, 'text-xs text-muted')}>{cells.rank}</TableCell>
      <TableCell className={cn(ROUND_CELL, 'font-semibold text-foreground')}>{cells.points}</TableCell>
    </>
  );
}

function StandingsRows({
  index,
  table,
  entry,
  roundIndexes,
  display,
  state,
  followed,
  placed,
  pending,
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
}) {
  const result = standingsRowResult(index, table.cut, display.phase);
  return (
    <>
      {table.cut !== null && index === table.cut ? (
        <CutLine columnCount={roundIndexes.length * 3 + 4} />
      ) : null}
      <TableRow className={cn('border-l-[3px] border-l-transparent', resultClasses(result, followed))}>
        <TableCell>{entry.rank ?? '—'}</TableCell>
        <TableCell>
          <TournamentUnit state={state} name={entry.name} />
          <TieMark placed={placed} pending={pending} />
        </TableCell>
        {roundIndexes.map((roundIndex) => (
          <RoundResultCells
            entry={entry}
            key={roundIndex}
            roundIndex={roundIndex}
            roundOver={roundIndex < state.curRound}
          />
        ))}
        <TableCell className={cn('text-center text-base font-bold text-primary tabular-nums', TOTAL_START)}>
          {entry.totalFP !== null ? formatStandingValue(entry.totalFP) : '—'}
        </TableCell>
        <TableCell className='text-center text-muted tabular-nums'>
          {formatTieBreak(entry.roomShare)}
        </TableCell>
      </TableRow>
    </>
  );
}

export function TournamentStandings({
  state,
  display,
  followKey,
  marks,
}: {
  state: TournamentState;
  display: StandingsDisplay;
  followKey: string | null;
  marks: Record<string, CutTieMarks>;
}) {
  const unitLabel = getGameFormat(state.gameFormat)?.unitLabel ?? 'Player';
  return (
    <div className='grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-3.5'>
      {display.tables.map((table) => {
        const roundIndexes = tableRoundIndexes(state, table);
        return (
          <Panel className='min-w-0' key={table.key}>
            <PanelTitle>{table.label}</PanelTitle>
            <TableScroll>
              <Table>
                <StandingsHead state={state} roundIndexes={roundIndexes} unitLabel={unitLabel} />
                <tbody>
                  {table.entries.map((entry, index) => (
                    <StandingsRows
                      key={entry.name}
                      index={index}
                      table={table}
                      entry={entry}
                      roundIndexes={roundIndexes}
                      display={display}
                      state={state}
                      followed={followKey === entry.name}
                      placed={marks[table.key]?.placed.includes(entry.name) ?? false}
                      pending={marks[table.key]?.pending.includes(entry.name) ?? false}
                    />
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Panel>
        );
      })}
    </div>
  );
}
