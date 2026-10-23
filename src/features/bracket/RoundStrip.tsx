import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../../components/ui';
import { hiddenScrollbarClass } from './StickyScrollbar';
import type { RoundStripItem, StripPick } from './round-strip';

const tabClassName =
  'flex h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xs bg-cfp-game-fold px-3 text-[13px] font-extrabold tracking-[0.02em] whitespace-nowrap text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
/** How much of the next tab stays showing when the strip scrolls to a tab. */
const TAB_PEEK = 12;

const selectedTabClassName = 'bg-cfp-game-frame text-white shadow-[inset_0_0_0_2px_var(--app-primary)]';

function StripTab({
  item,
  onClick,
  open,
  selected,
}: {
  item: RoundStripItem;
  onClick: () => void;
  open: boolean;
  selected: boolean;
}) {
  const isGroup = item.kind === 'group';
  return (
    <button
      aria-expanded={isGroup ? open : undefined}
      aria-haspopup={isGroup ? 'menu' : undefined}
      aria-selected={selected}
      className={cn(tabClassName, selected && selectedTabClassName)}
      data-strip-key={item.key}
      onClick={onClick}
      role='tab'
    >
      {item.label}
      {item.done ? (
        <>
          <span aria-hidden='true' className='text-cfp-green'>
            ✓
          </span>
          <span className='sr-only'>done</span>
        </>
      ) : null}
      {item.now ? (
        <>
          <span aria-hidden='true' className='size-2 rounded-full bg-cfp-violet' />
          <span className='sr-only'>now</span>
        </>
      ) : null}
    </button>
  );
}

/**
 * The list a group item ("R1–3 ✓") opens: the boxes it folds, by their own titles. Escape and a click outside
 * close it; the arrow keys move between its items.
 */
function GroupMenu({
  boxLabels,
  boxes,
  onClose,
  onPick,
}: {
  boxLabels: readonly string[];
  boxes: readonly number[];
  onClose: () => void;
  onPick: (index: number) => void;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
    event.preventDefault();
  };
  return (
    <div
      className='absolute top-full left-0 z-20 mt-1 min-w-44 rounded-md border border-surface-hover bg-surface p-1 shadow-[0_10px_30px_var(--shadow-floating)]'
      onKeyDown={move}
      role='menu'
    >
      {boxes.map((index, position) => (
        <button
          autoFocus={position === 0}
          className='flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-3 text-left text-sm font-bold text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary'
          key={index}
          onClick={() => {
            onPick(index);
            onClose();
          }}
          role='menuitem'
        >
          {boxLabels[index]}
          <span aria-hidden='true' className='text-cfp-green'>
            ✓
          </span>
          <span className='sr-only'>done</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The Bracket's round strip on a phone (hidden above 700 px): one tab per item of `roundStrip`, the selected one
 * kept in view by scrolling the strip itself. A group tab opens a menu of the boxes it folds instead of selecting.
 */
export function RoundStrip({
  boxLabels,
  items,
  onSelect,
  selectedKey,
}: {
  boxLabels: readonly string[];
  items: readonly RoundStripItem[];
  onSelect: (pick: StripPick) => void;
  selectedKey: string | undefined;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const group = items.find((item) => item.kind === 'group');

  useEffect(() => {
    const element = strip.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    // The least scrolling that brings the tab into view, with a little of its neighbour showing.
    const left = tab.offsetLeft - TAB_PEEK;
    const right = tab.offsetLeft + tab.offsetWidth + TAB_PEEK;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (right > element.scrollLeft + element.clientWidth)
      element.scrollLeft = right - element.clientWidth;
  }, [selectedKey]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      strip.current?.querySelector<HTMLElement>('[data-strip-key="group"]')?.focus();
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <div className='relative mb-3 min-[701px]:hidden' ref={container}>
      <div
        aria-label='Rounds'
        className={cn('relative flex gap-1.5 overflow-x-auto', hiddenScrollbarClass)}
        ref={strip}
        role='tablist'
      >
        {items.map((item) => (
          <StripTab
            item={item}
            key={item.key}
            onClick={() => {
              if (item.kind === 'group') setMenuOpen((open) => !open);
              else {
                setMenuOpen(false);
                onSelect(
                  item.kind === 'standings' ? { kind: 'standings' } : { kind: 'box', index: item.boxes[0] },
                );
              }
            }}
            open={menuOpen}
            selected={item.key === selectedKey}
          />
        ))}
      </div>
      {menuOpen && group ? (
        <GroupMenu
          boxLabels={boxLabels}
          boxes={group.boxes}
          onClose={() => setMenuOpen(false)}
          onPick={(index) => onSelect({ kind: 'box', index })}
        />
      ) : null}
    </div>
  );
}
