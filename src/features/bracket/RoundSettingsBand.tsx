import { cn } from '../../components/ui';
import { roundNoteLines } from '../info/round-note-lines';
import { Inlines } from '../info/RulesText';

/** Box classes that make an open Bracket box a subgrid of the rounds strip (title bar, band, body) on a desktop. */
export const alignedBoxClass = 'min-[701px]:grid min-[701px]:grid-rows-subgrid';

const bandClass = 'rounded-b px-3.5 pt-2.25 pb-2.5';

/** The sliders icon of the round settings: three bars with a knob each. */
export function SlidersIcon({ size = 16, strokeWidth = 1.6 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg aria-hidden='true' fill='none' height={size} viewBox='0 0 16 16' width={size}>
      <g stroke='currentColor' strokeLinecap='round' strokeWidth={strokeWidth}>
        <path d='M2 4H7.2M12.8 4H14M2 8H3.2M8.8 8H14M2 12H8.2M13.8 12H14' />
        <circle cx='10' cy='4' r='1.8' />
        <circle cx='6' cy='8' r='1.8' />
        <circle cx='11' cy='12' r='1.8' />
      </g>
    </svg>
  );
}

/** A settings note's lines, each with the rules text's inline formatting. */
export function RoundNoteLines({ note }: { note: string }) {
  return (
    <div className='min-w-0 wrap-break-word [&_strong]:font-bold [&_strong]:text-white'>
      {roundNoteLines(note).map((parts, index) => (
        <div key={index}>
          <Inlines parts={parts} />
        </div>
      ))}
    </div>
  );
}

/**
 * The round's settings note under its title bar: the note's lines with a sliders icon, or, in a tournament where
 * other rounds have a note, a quiet "No specific settings" (`empty`: the same quiet band with no text, under the
 * standings column's title bar). In a grid of boxes the bands of one row all take the height of the tallest.
 */
export function RoundSettingsBand({
  className,
  empty = false,
  note,
}: {
  className?: string;
  empty?: boolean;
  note: string;
}) {
  if (!note) {
    return (
      <div
        aria-hidden={empty || undefined}
        className={cn(
          bandClass,
          'bg-cfp-game-banner/35 text-[14px] leading-5 text-cfp-text-middle-muted',
          className,
        )}
      >
        {empty ? null : 'No specific settings'}
      </div>
    );
  }
  return (
    <div
      aria-label='Round settings'
      className={cn(
        bandClass,
        'flex gap-2.5 bg-cfp-game-banner text-[14px] leading-5 text-cfp-text',
        className,
      )}
      role='note'
    >
      <span className='mt-0.5 shrink-0 text-cfp-sky'>
        <SlidersIcon />
      </span>
      <RoundNoteLines note={note} />
    </div>
  );
}
