import { formatStandingValue, scoringSystemLabel } from '../../domain/tournament/scoring';
import type {
  CutTieMarks,
  StandingsDisplay,
  StandingsDisplayTable,
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

const COLUMN_COUNT = 6;

type Entry = StandingsDisplayTable['entries'][number];

function formatShare(share: number | null | undefined): string {
  return share === null || share === undefined ? '—' : `${(share * 100).toFixed(1)}%`;
}

function CutLine() {
  return (
    <tr aria-label='Cut line'>
      <td className='border-0 border-t border-dashed border-t-warning p-0 text-right' colSpan={COLUMN_COUNT}>
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

function StandingsRows({
  index,
  table,
  entry,
  display,
  state,
  followed,
  placed,
  pending,
}: {
  index: number;
  table: StandingsDisplayTable;
  entry: Entry;
  display: StandingsDisplay;
  state: TournamentState;
  followed: boolean;
  placed: boolean;
  pending: boolean;
}) {
  const scoring = state.gamemodeConfig.scoring ?? 'fairpoints';
  const result = standingsRowResult(index, table.cut, display.phase);
  return (
    <>
      {table.cut !== null && index === table.cut ? <CutLine /> : null}
      <TableRow className={cn('border-l-[3px] border-l-transparent', resultClasses(result, followed))}>
        <TableCell>{entry.rank ?? '—'}</TableCell>
        <TableCell>
          <TournamentUnit state={state} name={entry.name} />
          <TieMark placed={placed} pending={pending} />
        </TableCell>
        <TableCell>{entry.totalFP !== null ? formatStandingValue(entry.totalFP, scoring) : '—'}</TableCell>
        <TableCell>{formatShare(entry.roomShare)}</TableCell>
        <TableCell>{entry.totalScore}</TableCell>
        <TableCell>{entry.played}</TableCell>
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
  const scoring = state.gamemodeConfig.scoring ?? 'fairpoints';
  return (
    <div className='grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-3.5'>
      {display.tables.map((table) => (
        <Panel key={table.key}>
          <PanelTitle>{table.label}</PanelTitle>
          <TableScroll>
            <Table>
              <thead>
                <TableRow>
                  <TableHeadCell>Pos</TableHeadCell>
                  <TableHeadCell>Player / Team</TableHeadCell>
                  <TableHeadCell>{scoringSystemLabel(scoring)}</TableHeadCell>
                  <TableHeadCell>Room share</TableHeadCell>
                  <TableHeadCell>Score</TableHeadCell>
                  <TableHeadCell>Played</TableHeadCell>
                </TableRow>
              </thead>
              <tbody>
                {table.entries.map((entry, index) => (
                  <StandingsRows
                    key={entry.name}
                    index={index}
                    table={table}
                    entry={entry}
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
      ))}
    </div>
  );
}
