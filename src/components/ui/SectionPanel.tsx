import type { ReactNode } from 'react';
import { cn } from './cn';
import { panelLabelClassName, sectionTitleClassName } from './typography';

/**
 * A panel of the organiser screens: a header strip with a small caps label (and, at the right, a hint or actions)
 * over a body. `large` sets the title as a section title (running Admin) instead of a small caps label. `padded` gives the body its padding and spacing; turn it off for a body made of full-width rows.
 */
export function SectionPanel({
  actions,
  children,
  className,
  hint,
  label,
  large = false,
  padded = true,
  title,
}: {
  /** Controls at the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Muted text at the right of the header ("37 players · 2 reserves"). */
  hint?: ReactNode;
  /** The accessible name when it differs from the title. */
  label?: string;
  large?: boolean;
  padded?: boolean;
  title: string;
}) {
  return (
    <section
      aria-label={label ?? title}
      className={cn('min-w-0 rounded-md border border-surface-hover bg-surface', className)}
    >
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-t-[5px] border-b border-surface-hover bg-surface-low',
          large ? 'px-5 py-4' : 'px-4.5 py-3',
        )}
      >
        <h2 className={large ? sectionTitleClassName : panelLabelClassName}>{title}</h2>
        {hint ? <div className={large ? 'text-sm text-muted' : 'text-[13px] text-muted'}>{hint}</div> : null}
        {actions}
      </div>
      {padded ? <div className='flex flex-col gap-4 p-4.5'>{children}</div> : children}
    </section>
  );
}
