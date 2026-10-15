import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The classes that hide a strip's own scrollbar, for a strip that uses `StickyScrollbar` instead. */
export const hiddenScrollbarClass = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * The scrollbar of a sideways-scrolling strip, pinned to the bottom of the screen while the strip is on screen, so a
 * strip taller than the screen can be scrolled without first scrolling the page down to its end. It sits right under
 * the strip once the strip's end is in view, and is hidden while nothing overflows.
 */
export function StickyScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  // The element just scrolled by the other one: its next scroll event is that echo and is not copied back.
  const echo = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ scrollWidth: 0, clientWidth: 0 });

  const measure = () => {
    const strip = target.current;
    if (!strip) return;
    setSize((current) =>
      current.scrollWidth === strip.scrollWidth && current.clientWidth === strip.clientWidth
        ? current
        : { scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth },
    );
  };

  // Columns open, close and fill on every render of the strip's owner, which renders this too.
  useLayoutEffect(measure);

  useEffect(() => {
    const strip = target.current;
    if (!strip) return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    const follow = () => {
      if (bar.current) copyScroll(strip, bar.current, echo);
    };
    strip.addEventListener('scroll', follow, { passive: true });
    return () => {
      observer.disconnect();
      strip.removeEventListener('scroll', follow);
    };
  }, [target]);

  const lead = () => {
    if (target.current && bar.current) copyScroll(bar.current, target.current, echo);
  };

  return (
    <div
      aria-hidden
      className={
        size.scrollWidth > size.clientWidth ? 'sticky bottom-0 overflow-x-auto bg-background' : 'hidden'
      }
      onScroll={lead}
      ref={bar}
    >
      <div className='h-px' style={{ width: size.scrollWidth }} />
    </div>
  );
}

/** Copies `from`'s sideways scroll to `to`, unless `from` is only echoing a copy made the other way. */
function copyScroll(from: HTMLElement, to: HTMLElement, echo: RefObject<HTMLElement | null>) {
  if (echo.current === from) {
    echo.current = null;
    return;
  }
  if (to.scrollLeft === from.scrollLeft) return;
  echo.current = to;
  to.scrollLeft = from.scrollLeft;
}
