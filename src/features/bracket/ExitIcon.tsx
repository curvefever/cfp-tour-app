import { type FocusEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../../components/ui';
import { Stripe } from '../tournament/components/ResultStripe';
import type { ExitLine } from './exit-lines';

/** Whether the visitor has no hover (a phone or tablet): the pop-up then opens on tap and has a close button. */
function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia('(hover: none)').matches);
  }, []);
  return touch;
}

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
 * A small arrow icon that shows where the places of a room (or of a standings table) go. With a mouse the pop-up
 * opens on hover and on keyboard focus and closes on leaving, on blur and on Escape; where there is no hover it
 * opens on tap and has a close button. The pop-up is positioned against the nearest `relative` ancestor (the card).
 */
export function ExitIcon({
  label,
  lines,
  popupClassName,
  buttonClassName,
}: {
  label: string;
  lines: ExitLine[];
  /** Extra classes of the icon button (a ground behind it, for instance). */
  buttonClassName?: string;
  /** Where the pop-up sits, when not under a 38 px room header. */
  popupClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const touch = useTouchOnly();
  const container = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  if (lines.length === 0) return null;
  const hoverProps = touch
    ? {}
    : {
        onBlur: (event: FocusEvent) => {
          if (!container.current?.contains(event.relatedTarget)) setOpen(false);
        },
        onFocus: () => setOpen(true),
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
      };
  return (
    <span className='flex items-center' ref={container} {...hoverProps}>
      <button
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex size-7 cursor-pointer items-center justify-center max-[700px]:-m-2 max-[700px]:size-11 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-current',
          buttonClassName,
        )}
        onClick={touch ? () => setOpen((current) => !current) : undefined}
        type='button'
      >
        <ArrowGlyph />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute top-10 right-[-8px] z-20 flex w-62.5 flex-col gap-1.5 rounded-xs bg-cfp-game-deep px-3 py-2.5 text-sm font-normal tracking-normal text-foreground normal-case',
            'shadow-[0_10px_30px_var(--shadow-floating)] outline-2 outline-primary',
            popupClassName,
          )}
          role='tooltip'
        >
          {touch ? (
            <button
              aria-label='Close'
              className='absolute top-0 right-0 flex size-11 cursor-pointer items-center justify-center text-muted'
              onClick={() => setOpen(false)}
              type='button'
            >
              ✕
            </button>
          ) : null}
          {lines.map((line, index) => (
            <div className={cn('flex items-center gap-2', touch && 'pr-8')} key={index}>
              {line.tone ? <Stripe className='h-4' tone={line.tone} /> : null}
              <span className='font-bold'>{line.places}</span>
              <span className='text-muted'>{line.where}</span>
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}
