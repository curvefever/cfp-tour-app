import { Alert, Button, ButtonRow, SectionPanel } from '../../../components/ui';
import { USUAL_FORM_VALUES, layeredByHand } from '../../../domain/tournament/layered-form';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import {
  layeredSummary,
  type GridCell,
  type GridColumn,
  type SummaryGrid,
  type SummaryNumber,
} from './layered-summary';
import { LayeredTopCounts, TypedTopCounts } from './LayeredTopCounts';
import { useSetupUpdate } from './useSetupChange';

/** Asked before "Adjust rounds by hand" hands the rounds over: the app stops working the rooms out. */
const HAND_CONFIRM =
  'The rounds become a Custom bracket graph that you edit yourself: the app will no longer work the levels and rooms out. Choosing "Layered bracket" again works them out again and drops the graph. Continue?';

const USUAL_LINE =
  'The usual tournament has 4 table rounds with the first not counted, and two games for the Semi-Finals and the Final. The form has other values.';

/** The rooms of one cell, as boxes with their seats and the top places that go on. */
function RoomBoxes({ cell }: { cell: GridCell }) {
  return (
    <div className='flex flex-wrap gap-1.5'>
      {cell.rooms.map((room, index) => (
        <div
          className='flex min-w-12 flex-col items-center rounded border border-surface-hover bg-surface-low px-2 py-1 text-center'
          key={index}
        >
          <span className='text-sm font-bold'>{room.seats}</span>
          <span className='text-xs text-muted'>{room.top === null ? 'Final' : `top ${room.top}`}</span>
        </div>
      ))}
    </div>
  );
}

/** One cell: its name unless the row already says it (the wide grid names a level by its row). */
function CellView({ cell, hideName = false }: { cell: GridCell; hideName?: boolean }) {
  return (
    <div className='flex flex-col gap-1'>
      {hideName ? null : <span className='text-xs font-semibold'>{cell.name}</span>}
      <RoomBoxes cell={cell} />
      {cell.note ? <span className='text-xs text-muted'>{cell.note}</span> : null}
    </div>
  );
}

function ColumnFooter({ column }: { column: GridColumn }) {
  const parts = [
    column.waiting > 0 ? `${column.waiting} wait for Semi-Final B` : '',
    column.out > 0 ? `${column.out} out` : '',
  ].filter(Boolean);
  return <span className='text-xs text-muted'>{parts.join(' · ') || '—'}</span>;
}

/** A column per round and a row per level, then the players out; Semi-Final A takes the top row in its round. */
function WideGrid({ grid }: { grid: SummaryGrid }) {
  const { rows, columns } = grid;
  const template = { gridTemplateColumns: `max-content repeat(${columns.length}, minmax(4.5rem, 1fr))` };
  return (
    <div className='hidden gap-x-3 gap-y-2 md:grid' data-grid='wide' style={template}>
      <span />
      {columns.map((column) => (
        <b className='text-sm' key={column.title}>
          {column.title}
        </b>
      ))}
      {rows.map((level, row) => (
        <div className='contents' key={level}>
          <span className='pt-1 text-sm font-semibold'>{level}</span>
          {columns.map((column) => {
            const cell = column.cells[row];
            return (
              <div key={column.title}>
                {cell ? (
                  <CellView cell={cell} hideName={cell.name === level || cell.name === column.title} />
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      <span className='text-sm font-semibold'>Waiting, out</span>
      {columns.map((column) => (
        <ColumnFooter column={column} key={column.title} />
      ))}
    </div>
  );
}

/** On a phone, one block per round. */
function RoundBlocks({ grid }: { grid: SummaryGrid }) {
  return (
    <div className='flex flex-col gap-3 md:hidden' data-grid='phone'>
      {grid.columns.map((column) => (
        <section className='rounded border border-surface-hover p-2.5' key={column.title}>
          <b className='mb-1.5 block text-sm'>{column.title}</b>
          <div className='flex flex-col gap-2'>
            {column.cells.map((cell, row) =>
              cell ? (
                <CellView cell={cell} hideName={cell.name === column.title} key={grid.rows[row]} />
              ) : null,
            )}
          </div>
          <div className='mt-1.5'>
            <ColumnFooter column={column} />
          </div>
        </section>
      ))}
    </div>
  );
}

function NumberList({ numbers }: { numbers: SummaryNumber[] }) {
  return (
    <ul className='flex flex-col gap-1.5' id='layered-numbers'>
      {numbers.map((number) => (
        <li className='flex flex-col text-sm' key={number.key}>
          <span>
            <b>{number.label}</b> <span>{number.value}</span>
          </span>
          <span className='text-muted'>{number.source}</span>
        </li>
      ))}
    </ul>
  );
}

/** The layered bracket's levels, rooms and rounds, read only, where the Custom bracket's graph sits: the app works them out from the head count and what is typed. */
export function LayeredPanel() {
  const { state, setup } = useTournamentApp();
  const updateSetup = useSetupUpdate();
  if (setup.scheduleLogic !== 'layered') return null;
  const summary = layeredSummary(setup, state.confirmedCount || null);

  function adjustByHand() {
    const text = layeredByHand(setup, state.confirmedCount ?? 0);
    if (!text.ok || !window.confirm(HAND_CONFIRM)) return;
    updateSetup((current) => ({ ...current, scheduleLogic: 'waterfall-bracket', waterfallGraph: text.text }));
  }

  function useUsualValues() {
    updateSetup((current) => ({ ...current, ...USUAL_FORM_VALUES }));
  }

  return (
    <SectionPanel
      hint='worked out from the head count and what you type; type a number to plan around it'
      title='LAYERED BRACKET'
    >
      {summary.kind === 'waiting' ? (
        <p className='text-sm text-muted' id='layered-summary'>
          {summary.message}
        </p>
      ) : summary.kind === 'refused' ? (
        <div id='layered-summary'>
          <Alert tone='danger'>{summary.message}</Alert>
          <TypedTopCounts lines={summary.typedTopCounts} />
        </div>
      ) : (
        <div className='flex flex-col gap-4' id='layered-summary'>
          <p className='text-sm font-semibold'>{summary.heading}</p>
          <NumberList numbers={summary.numbers} />
          <LayeredTopCounts
            noLongerApply={summary.noLongerApply}
            rows={summary.topCounts}
            semiOthers={summary.semiOthers}
          />
          {summary.flags.length > 0 ? (
            <ul className='flex flex-col gap-1 text-sm text-warning' id='layered-flags'>
              {summary.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          ) : null}
          <div className='overflow-x-auto' id='layered-grid'>
            <WideGrid grid={summary.grid} />
            <RoundBlocks grid={summary.grid} />
          </div>
          {summary.differsFromUsual ? (
            <div className='flex flex-col gap-2' id='layered-usual'>
              <p className='text-sm text-muted'>{USUAL_LINE}</p>
              <ButtonRow>
                <Button onClick={useUsualValues}>Use the usual values</Button>
              </ButtonRow>
            </div>
          ) : null}
          <ButtonRow>
            <Button onClick={adjustByHand}>Adjust rounds by hand</Button>
          </ButtonRow>
        </div>
      )}
    </SectionPanel>
  );
}
