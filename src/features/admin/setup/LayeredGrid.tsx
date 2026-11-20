import type { GridCell, GridColumn, SummaryGrid } from './layered-summary';

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

/** The rounds of a plan by levels: a column per round and a row per level on a wide screen, a block per round on a phone. */
export function LayeredGrids({ grid, id }: { grid: SummaryGrid; id?: string }) {
  return (
    <div className='overflow-x-auto' id={id}>
      <WideGrid grid={grid} />
      <RoundBlocks grid={grid} />
    </div>
  );
}
