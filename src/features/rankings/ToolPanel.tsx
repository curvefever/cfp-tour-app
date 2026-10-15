import type { ReactNode } from 'react';
import { Button, cn, panelLabelClassName } from '../../components/ui';

/** A middle-look panel of the Organiser tools block: a small title bar (with an optional note at the right) over the body. */
export function ToolPanel({
  children,
  className,
  label,
  note,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** The accessible name when it differs from the title. */
  label?: string;
  note?: ReactNode;
  title: string;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={cn('min-w-0 overflow-hidden rounded-md border border-surface-hover bg-surface', className)}
    >
      <div className='flex flex-wrap items-center justify-between gap-2 border-b border-surface-hover bg-surface-low px-4 py-3'>
        <h3 className={panelLabelClassName}>{title}</h3>
        {note ? <div className='text-[13px] text-cfp-orange-text'>{note}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** One line of a tool panel: the name (or anything else) takes the space, the controls sit at the right. */
export function ToolRow({
  children,
  controls,
  className,
}: {
  children: ReactNode;
  controls?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-11 items-center gap-2 border-b border-surface-hover px-4 py-1 last:border-b-0',
        className,
      )}
    >
      <div className='min-w-0 flex-1 truncate text-[15px] font-semibold'>{children}</div>
      {controls ? <div className='flex shrink-0 items-center gap-2'>{controls}</div> : null}
    </div>
  );
}

/** A small icon button (✎ ⇄ ✕): the title shows on hover, the label is what a screen reader hears. */
export function ToolIconButton({
  danger = false,
  disabled = false,
  glyph,
  label,
  onClick,
  title,
}: {
  danger?: boolean;
  disabled?: boolean;
  glyph: string;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <Button
      aria-label={label}
      className='w-8.5 px-0'
      disabled={disabled}
      onClick={onClick}
      size='sm'
      title={title}
      variant={danger ? 'danger' : 'secondary'}
    >
      {glyph}
    </Button>
  );
}
