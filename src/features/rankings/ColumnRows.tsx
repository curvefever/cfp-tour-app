import { cn } from '../../components/ui';
import { rowSurfaceClasses } from '../tournament/components/result-row';

/** One line of a list that flows down three columns: a number, a name (with its members) and, optionally, a note. */
export interface ColumnRow {
  key: string;
  number: string;
  label: string;
  members: string[] | null;
  /** Muted text at the right, such as where the unit stood. */
  note?: string;
}

/**
 * A list in columns of 320 px or more (three on a wide page, then two, then one), filled column by column. The
 * rows alternate between the two row grounds, or all take the card ground (`ground='card'`).
 */
export function ColumnRows({
  ground = 'alternating',
  label,
  rows,
}: {
  ground?: 'alternating' | 'card';
  label: string;
  rows: ColumnRow[];
}) {
  return (
    <ol aria-label={label} className='[columns:3_320px] gap-x-4.5'>
      {rows.map((row, index) => (
        <li
          className={cn(
            'mb-0.75 flex min-h-10.5 break-inside-avoid items-center gap-2.5 rounded-xs px-3 py-1',
            ground === 'card' ? 'bg-cfp-game-card' : rowSurfaceClasses(index, false),
          )}
          key={row.key}
        >
          <span className='w-7.5 shrink-0 text-right text-[15px] font-extrabold text-muted'>
            {row.number}
          </span>
          <span className='flex min-w-0 flex-1 flex-col'>
            <span className='truncate text-base font-bold'>{row.label}</span>
            {row.members?.length ? (
              <span className='truncate text-[13px] text-muted'>{row.members.join(' · ')}</span>
            ) : null}
          </span>
          {row.note ? <span className='shrink-0 text-sm text-muted'>{row.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}
