import { type CSSProperties, type RefCallback, useCallback, useState } from 'react';

/** The CSS variable holding the room the admin's sticky Next Round panel takes at the bottom of the screen. */
const PANEL_SPACE_VARIABLE = '--next-round-panel-space';

/**
 * Measures the sticky Next Round panel: its height plus the gap it keeps from the screen's bottom, kept current as
 * the panel's height changes. `panelRef` goes on the panel; `style` on an ancestor of both the panel and the sticky
 * scrollbar, which sits above the panel through `bottom-[var(--next-round-panel-space,0px)]`. Without a panel (a
 * viewer) the variable is not set and the bar keeps the bottom of the screen.
 */
export function usePanelSpace(): { panelRef: RefCallback<HTMLElement>; style: CSSProperties | undefined } {
  const [space, setSpace] = useState(0);
  const panelRef = useCallback((panel: HTMLElement | null) => {
    if (!panel) return;
    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(panel).bottom) || 0;
      setSpace(Math.round(panel.offsetHeight + gap));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      setSpace(0);
    };
  }, []);
  const style = space > 0 ? ({ [PANEL_SPACE_VARIABLE]: `${space}px` } as CSSProperties) : undefined;
  return { panelRef, style };
}
