import type { ReactNode } from 'react';
import { Button, SectionPanel, cn } from '../../components/ui';

/** A panel of the Organiser tools block: the shared section panel, with an optional muted count and orange note at the right of its header. */
export function ToolPanel({
  children,
  className,
  count,
  label,
  note,
  title,
}: {
  children: ReactNode;
  className?: string;
  count?: string;
  /** The accessible name when it differs from the title. */
  label?: string;
  note?: ReactNode;
  title: string;
}) {
  return (
    <SectionPanel
      actions={
        count || note ? (
          <div className='flex flex-wrap items-center justify-end gap-x-3 text-[13px]'>
            {count ? <span className='text-muted'>{count}</span> : null}
            {note ? <span className='text-cfp-orange-text'>{note}</span> : null}
          </div>
        ) : null
      }
      className={className}
      label={label}
      padded={false}
      title={title}
    >
      {children}
    </SectionPanel>
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
        'flex min-h-11 items-center gap-2 border-b border-surface-hover px-4.5 py-1 last:border-b-0',
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
