import { type FocusEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '../../components/ui';

/** Whether the visitor has no hover (a phone or tablet): the pop-up then opens on tap and has a close button. */
function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia('(hover: none)').matches);
  }, []);
  return touch;
}

/**
 * An icon button with a pop-up. With a mouse the pop-up opens on hover and on keyboard focus and closes on leaving,
 * on blur and on Escape; where there is no hover it opens on tap and has a close button. The pop-up is positioned
 * against the nearest `relative` ancestor (the card), or against the icon when `containerClassName` makes it one.
 */
export function PopupIcon({
  buttonClassName,
  children,
  containerClassName,
  icon,
  label,
  popupClassName,
}: {
  /** Size and look of the button around the icon. */
  buttonClassName?: string;
  /** The pop-up's content; a function gets whether the pop-up opens on tap (it then has a close button at its top right). */
  children: ReactNode | ((touch: boolean) => ReactNode);
  containerClassName?: string;
  icon: ReactNode;
  label: string;
  /** Where the pop-up sits, and what it looks like beyond the shared surface. */
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
    <span className={cn('flex items-center', containerClassName)} ref={container} {...hoverProps}>
      <button
        aria-expanded={open}
        aria-label={label}
        className={cn(
          'flex cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-current',
          buttonClassName,
        )}
        onClick={touch ? () => setOpen((current) => !current) : undefined}
        type='button'
      >
        {icon}
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
          {typeof children === 'function' ? children(touch) : children}
        </div>
      ) : null}
    </span>
  );
}
