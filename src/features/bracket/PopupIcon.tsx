import {
  type FocusEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../../components/ui';

const PopupPinContext = createContext<((pinned: boolean) => void) | null>(null);

/**
 * Called by something in a pop-up's content that opens a window of its own (a full-size picture): while `pinned`, the
 * pop-up stays open whatever the mouse or the focus does, and Escape is left to that window.
 */
export function usePopupPin(pinned: boolean): void {
  const pin = useContext(PopupPinContext);
  useEffect(() => {
    if (!pinned || !pin) return;
    pin(true);
    return () => pin(false);
  }, [pinned, pin]);
}

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
  const [pins, setPins] = useState(0);
  const touch = useTouchOnly();
  const container = useRef<HTMLSpanElement>(null);
  const pinned = pins > 0;
  const pin = useCallback((on: boolean) => {
    setPins((count) => count + (on ? 1 : -1));
    // With a mouse, a pop-up that was kept open only by the pin closes when nothing hovers or holds it any more.
    if (!on) setOpen((wasOpen) => wasOpen && (container.current?.matches(':hover') ?? false));
  }, []);

  useEffect(() => {
    if (!open || pinned) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, pinned]);

  const hoverProps = touch
    ? {}
    : {
        onBlur: (event: FocusEvent) => {
          if (!pinned && !container.current?.contains(event.relatedTarget)) setOpen(false);
        },
        onFocus: () => setOpen(true),
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => {
          if (!pinned) setOpen(false);
        },
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
          <PopupPinContext.Provider value={pin}>
            {typeof children === 'function' ? children(touch) : children}
          </PopupPinContext.Provider>
        </div>
      ) : null}
    </span>
  );
}
