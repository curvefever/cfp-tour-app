import type { ReactNode } from 'react';
import { cn } from './cn';
import { pageTitleClassName, viewLabelClassName } from './typography';

/** The heading of a page: its title (h1), the view's name in small caps underneath, and actions at the right. */
export function PageHeading({
  actions,
  className,
  label,
  title,
}: {
  actions?: ReactNode;
  className?: string;
  label?: string;
  title: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className='flex min-w-0 flex-col gap-1'>
        <h1 className={pageTitleClassName}>{title}</h1>
        {label ? <div className={viewLabelClassName}>{label}</div> : null}
      </div>
      {actions}
    </div>
  );
}
