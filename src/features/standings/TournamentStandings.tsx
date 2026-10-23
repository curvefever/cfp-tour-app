import { bracketRoundLabels } from '../../domain/tournament/bracket';
import { getGameFormat } from '../../domain/tournament/formats';
import type {
  CutTieMarks,
  StandingsDisplay,
  StandingsDisplayTable,
} from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { columnTitleClassName } from '../../components/ui';
import { ExitIcon } from '../bracket/ExitIcon';
import { standingsExitLines } from '../bracket/exit-lines';
import { PhaseBadge } from '../bracket/PhaseBadge';
import { StandingsCompactList } from './StandingsCompactList';
import { StandingsTable } from './StandingsTable';

/** A table's title row: its name, TEMPORARY or FINAL, and the exit icon saying where each run of standings goes. */
function TableTitle({
  display,
  labels,
  table,
}: {
  display: StandingsDisplay;
  labels: ReturnType<typeof bracketRoundLabels>;
  table: StandingsDisplayTable;
}) {
  return (
    <div className='flex min-h-8 items-center gap-2.5'>
      <h2 className={columnTitleClassName}>{table.label}</h2>
      <PhaseBadge phase={display.phase} />
      <div className='relative'>
        <ExitIcon
          iconClassName='rounded-xs bg-foreground/10'
          label={`Where players go from ${table.label}`}
          lines={standingsExitLines(table, display, labels)}
          popupClassName='top-9 right-auto left-0'
        />
      </div>
    </div>
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
  const labels = bracketRoundLabels(state);
  return (
    <div className='grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-3.5'>
      {display.tables.map((table) => (
        <section className='flex min-w-0 flex-col gap-3' key={table.key}>
          <TableTitle display={display} labels={labels} table={table} />
          <StandingsTable
            className='max-[700px]:hidden'
            display={display}
            followKey={followKey}
            marks={marks[table.key]}
            state={state}
            table={table}
            unitLabel={unitLabel}
          />
          <StandingsCompactList
            className='min-[701px]:hidden'
            display={display}
            followKey={followKey}
            marks={marks[table.key]}
            state={state}
            table={table}
            unitLabel={unitLabel}
          />
        </section>
      ))}
    </div>
  );
}
