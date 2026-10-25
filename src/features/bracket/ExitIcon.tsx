import { cn } from '../../components/ui';
import { Stripe } from '../tournament/components/ResultStripe';
import type { ExitLine } from './exit-lines';
import { PopupIcon } from './PopupIcon';

/** The arrow glyph: a line leaving the room towards where its places go. */
function ArrowGlyph() {
  return (
    <svg aria-hidden='true' height='16' viewBox='0 0 16 16' width='16'>
      <path
        d='M2 8 H7 M7 8 L13 3.5 M7 8 L13 12.5'
        fill='none'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='2'
      />
      <path
        d='M10.5 3 L13.5 3.3 L13 6.2 M10.5 13 L13.5 12.7 L13 9.8'
        fill='none'
        stroke='currentColor'
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth='1.6'
      />
    </svg>
  );
}

/**
 * A small arrow icon that shows where the places of a room (or of a standings table) go, in a pop-up
 * (`PopupIcon`) of one line per run of places.
 */
export function ExitIcon({
  label,
  lines,
  popupClassName,
  iconClassName,
}: {
  label: string;
  lines: ExitLine[];
  /** Extra classes of the 28 px square around the arrow (a ground behind it, for instance); the button around it is larger on a phone. */
  iconClassName?: string;
  /** Where the pop-up sits, when not under a 38 px room header. */
  popupClassName?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <PopupIcon
      buttonClassName='size-7 max-[700px]:-m-2 max-[700px]:size-11'
      icon={
        <span className={cn('flex size-7 items-center justify-center', iconClassName)}>
          <ArrowGlyph />
        </span>
      }
      label={label}
      popupClassName={popupClassName}
    >
      {(touch) =>
        lines.map((line, index) => (
          <div className={cn('flex items-center gap-2', touch && 'pr-8')} key={index}>
            {line.tone ? <Stripe className='h-4' tone={line.tone} /> : null}
            <span className='font-bold'>{line.places}</span>
            <span className='text-muted'>{line.where}</span>
          </div>
        ))
      }
    </PopupIcon>
  );
}
